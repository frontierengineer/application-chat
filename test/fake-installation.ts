import type {
  AvailableModel,
  Failure,
  HostRegistration,
  PromptCapabilities,
  Result,
  RuntimeOnWorker,
  SessionCreateOptions,
  SessionMode,
  SessionModel,
  SessionPromptOptions,
  Subscription,
  TranscriptEvent,
  TurnEvent,
} from '../../application';

type Handler<T> = (value: T) => void;

function listeners<T>() {
  const set = new Set<Handler<T>>();
  return {
    add(handler: Handler<T>): Subscription {
      set.add(handler);
      return { unsubscribe: () => set.delete(handler) };
    },
    emit(value: T) {
      for (const handler of [...set]) handler(value);
    },
    get size() {
      return set.size;
    },
  };
}

const notFound = (message: string): Failure => ({ ok: false, message, retriable: false });

export class FakeStore {
  private readonly entries = new Map<string, { value: unknown; revision: string }>();
  private counter = 0;
  private readonly watchers = listeners<{ key: string; kind: 'written' | 'deleted' }>();

  private write(key: string, value: unknown): string {
    this.counter += 1;
    const revision = `r${this.counter}`;
    this.entries.set(key, { value: structuredClone(value), revision });
    queueMicrotask(() => this.watchers.emit({ key, kind: 'written' }));
    return revision;
  }

  async getJson<T>(key: string): Promise<Result<T | null>> {
    const entry = this.entries.get(key);
    return { ok: true, value: entry ? (structuredClone(entry.value) as T) : null };
  }
  async getString(key: string): Promise<Result<string | null>> {
    const entry = this.entries.get(key);
    return { ok: true, value: entry ? String(entry.value) : null };
  }
  async getJsonEntry<T>(key: string): Promise<Result<{ value: T; revision: string } | null>> {
    const entry = this.entries.get(key);
    return { ok: true, value: entry ? { value: structuredClone(entry.value) as T, revision: entry.revision } : null };
  }
  async putJson(options: { key: string; value: unknown }): Promise<Result> {
    this.write(options.key, options.value);
    return { ok: true, value: undefined };
  }
  async putJsonEntry(options: { key: string; value: unknown; revision: string | null }): Promise<Result<{ revision: string }>> {
    const current = this.entries.get(options.key)?.revision ?? null;
    if (current !== options.revision) return { ok: false, message: 'The key changed.', retriable: true, detail: { revision: current } };
    return { ok: true, value: { revision: this.write(options.key, options.value) } };
  }
  async delete(key: string): Promise<Result> {
    if (this.entries.delete(key)) queueMicrotask(() => this.watchers.emit({ key, kind: 'deleted' }));
    return { ok: true, value: undefined };
  }
  async list(prefix: string): Promise<Result<string[]>> {
    return { ok: true, value: [...this.entries.keys()].filter((key) => key.startsWith(prefix)).sort() };
  }
  watch(prefix: string, handler: Handler<{ key: string; kind: 'written' | 'deleted' }>): Subscription {
    return this.watchers.add((change) => {
      if (change.key.startsWith(prefix)) handler(change);
    });
  }
  peek(key: string): unknown {
    return this.entries.get(key)?.value;
  }
}

export type Agent = (session: FakeSession, turnId: string, prompt: SessionPromptOptions['prompt']) => Promise<void> | void;

export class FakeSession {
  readonly id: string;
  readonly runtimeId: string;
  readonly workerId: string;
  readonly visibility = 'public' as const;
  readonly createdAt: number;
  readonly workspace: { workspaceId: string; files: unknown } | null;
  readonly options: SessionCreateOptions;
  agentId: string | null;
  active = true;
  reason: string | null = null;
  // Empty until the agent reports its modes, which it does once it opens, after the session is created.
  modeState: { current: string | null; available: SessionMode[] } = { current: null, available: [] };
  modelState: SessionModel | null = null;
  capabilities: PromptCapabilities = { image: true, audio: false, embeddedContext: true };
  history: TranscriptEvent[] = [];
  replay = true;
  turn: { turnId: string; startedAt: number | null } | null = null;
  queued: { turnId: string; prompt: SessionPromptOptions['prompt'] } | null = null;
  prompts: SessionPromptOptions['prompt'][] = [];
  canceled: string[] = [];
  private turns = 0;
  readonly followers = listeners<TranscriptEvent>();
  readonly turnWatchers = listeners<TurnEvent>();
  private readonly installation: FakeInstallation;

  constructor(installation: FakeInstallation, id: string, options: SessionCreateOptions) {
    this.installation = installation;
    this.id = id;
    this.options = options;
    this.runtimeId = options.runtimeId;
    this.workerId = options.workerId;
    this.createdAt = installation.now();
    this.workspace = options.workspaceId ? { workspaceId: options.workspaceId, files: {} } : null;
    this.agentId = options.agentSessionId ?? `agent-${id}`;
  }

  model(): SessionModel | null { return this.modelState; }
  agentSessionId(): string | null { return this.agentId; }
  lastPromptAt(): number | null { return null; }
  currentTurn() { return this.turn ?? (this.queued ? { turnId: this.queued.turnId, startedAt: null } : null); }
  isActive(): boolean { return this.active; }
  inactiveReason(): string | null { return this.active ? null : this.reason; }
  modes() { return this.modeState; }
  commands() { return []; }
  promptCapabilities(): PromptCapabilities { return this.capabilities; }

  // The agent reporting itself as it opens, told through sessions.onChanged as the Application context tells it.
  report(available: SessionMode[], current: string | null): void {
    this.modeState = { current, available };
    this.installation.changed('session', this.id);
  }

  // The agent changing its own mode, as when it leaves plan mode.
  switchMode(modeId: string): void {
    this.modeState = { ...this.modeState, current: modeId };
    this.emit({ type: 'mode', modeId, timestamp: this.installation.now() });
    this.installation.changed('session', this.id);
  }

  emit(event: TranscriptEvent): void {
    this.history.push(event);
    this.followers.emit(event);
  }

  async prompt(options: SessionPromptOptions): Promise<Result<{ turnId: string; queued: boolean }>> {
    if (!this.active) return { ok: false, message: this.reason ?? 'The session is inactive.', retriable: true };
    this.turns += 1;
    const turnId = `${this.id}-turn-${this.turns}`;
    this.prompts.push(options.prompt);
    if (this.turn) {
      if (this.queued) this.canceled.push(this.queued.turnId);
      this.queued = { turnId, prompt: options.prompt };
      this.turnWatchers.emit({ type: 'turn.queued', sessionId: this.id, turnId, timestamp: this.installation.now() });
      this.installation.changed('session', this.id);
      return { ok: true, value: { turnId, queued: true } };
    }
    void this.run(turnId, options.prompt);
    return { ok: true, value: { turnId, queued: false } };
  }

  private async run(turnId: string, prompt: SessionPromptOptions['prompt']): Promise<void> {
    this.turn = { turnId, startedAt: this.installation.now() };
    this.turnWatchers.emit({ type: 'turn.started', sessionId: this.id, turnId, timestamp: this.installation.now() });
    this.installation.changed('session', this.id);
    const text = typeof prompt === 'string' ? prompt : prompt.map((part) => (part.type === 'text' ? part.text : '')).join('');
    this.emit({ type: 'turn_start', userPrompt: text, turnId, timestamp: this.installation.now() });
    if (typeof prompt !== 'string') {
      for (const part of prompt) if (part.type === 'image') this.emit({ type: 'attachment', channel: 'user', content: part, timestamp: null });
    }
    await this.installation.agent(this, turnId, prompt);
  }

  finish(turnId: string, stopReason: 'end_turn' | 'cancelled' = 'end_turn'): void {
    if (this.turn?.turnId !== turnId) return;
    const usage = { contextUsed: 1200 * this.turns, contextWindow: 200000, costAmount: 0.01 * this.turns, costCurrency: 'USD' };
    this.emit({ type: 'done', stopReason, usage, timestamp: this.installation.now() });
    this.turn = null;
    this.turnWatchers.emit({ type: 'turn.finished', sessionId: this.id, turnId, timestamp: this.installation.now(), stopReason, error: null, usage, tokens: null });
    this.installation.changed('session', this.id);
    const next = this.queued;
    this.queued = null;
    if (next) void this.run(next.turnId, next.prompt);
  }

  async cancel(turnId: string): Promise<Result> {
    this.canceled.push(turnId);
    if (this.queued?.turnId === turnId) {
      this.queued = null;
      this.installation.changed('session', this.id);
      return { ok: true, value: undefined };
    }
    if (this.turn?.turnId === turnId) {
      this.finish(turnId, 'cancelled');
      return { ok: true, value: undefined };
    }
    return notFound('There is no such turn.');
  }

  async setMode(modeId: string): Promise<Result> {
    this.modeState = { ...this.modeState, current: modeId };
    this.emit({ type: 'mode', modeId, timestamp: this.installation.now() });
    this.installation.changed('session', this.id);
    return { ok: true, value: undefined };
  }

  async setModel(model: { modelId: string; settings?: Record<string, string | number | boolean> }): Promise<Result> {
    if (this.runtimeId === 'runtime-fixed') return { ok: false, unavailable: true, message: 'No model changes.' };
    this.modelState = { modelId: model.modelId, settings: model.settings ?? {} };
    this.installation.changed('session', this.id);
    return { ok: true, value: undefined };
  }

  watchTurns(handler: Handler<TurnEvent>): Subscription {
    return this.turnWatchers.add(handler);
  }

  get transcript() {
    return {
      // As a Worker answers: an agent cannot replay while it runs a turn.
      history: async (): Promise<Result<TranscriptEvent[]>> => {
        if (!this.replay) return { ok: false, unavailable: true, message: 'This runtime cannot replay.' };
        if (this.turn !== null) return { ok: false, unavailable: true, message: 'The agent is running a turn.' };
        if (!this.active) return { ok: false, unavailable: true, message: 'The agent is not open on its worker.' };
        return { ok: true, value: [...this.history] };
      },
      follow: (handler: Handler<TranscriptEvent>) => this.followers.add(handler),
    };
  }
}

export interface FakeRuntime {
  id: string;
  title: string;
  reports: Record<string, Omit<RuntimeOnWorker, 'workerId'>>;
}

export class FakeInstallation {
  // How long sessions.create takes, as launching a real agent does.
  createDelay = 0;
  // How long after a session is created its agent reports the modes it offers.
  reportDelay = 0;
  agentModes: SessionMode[] = [{ id: 'default', name: 'Default', description: null }, { id: 'plan', name: 'Plan', description: 'Plans before it acts' }];
  notified: { title: string; body?: string; priority: string }[] = [];
  readonly store = new FakeStore();
  readonly sessionMap = new Map<string, FakeSession>();
  runtimes: FakeRuntime[] = [];
  workers: { id: string; title: string; connected: boolean }[] = [];
  workspaces: { id: string; name: string; workspaceProvisionerId: string; workerId: string; mounted: boolean; holders: number }[] = [];
  provisioners: { id: string; title: string; workerId: string; total: number }[] = [];
  readonly calls: { method: string; input: unknown }[] = [];
  readonly createOptions: SessionCreateOptions[] = [];
  readonly released: string[] = [];
  readonly mounted: unknown[] = [];
  readonly unmounted: string[] = [];
  createFailure: Failure | { ok: false; unavailable: true; message: string } | null = null;
  clock = Date.parse('2026-11-17T12:00:00Z');
  agent: Agent = (session, turnId) => {
    session.emit({ type: 'text', id: `${turnId}-text`, delta: 'Done.', partial: false, text: 'Done.', timestamp: this.now() });
    session.finish(turnId);
  };
  private counter = 0;
  readonly sessionChanges = listeners<{ id: string; kind: 'added' | 'changed' | 'removed' }>();
  readonly runtimeChanges = listeners<{ id: string; kind: 'added' | 'changed' | 'removed' }>();
  readonly workerChanges = listeners<{ id: string; kind: 'added' | 'changed' | 'removed' }>();
  host: HostRegistration | null = null;

  now(): number {
    this.clock += 1000;
    return this.clock;
  }

  changed(kind: 'session', id: string, change: 'added' | 'changed' | 'removed' = 'changed'): void {
    if (kind === 'session') queueMicrotask(() => this.sessionChanges.emit({ id, kind: change }));
  }

  private runtimeObject(runtime: FakeRuntime) {
    return {
      id: runtime.id,
      title: runtime.title,
      options: [],
      on: (workerId: string): RuntimeOnWorker | null => {
        const report = runtime.reports[workerId];
        return report ? { workerId, ...report } : null;
      },
    };
  }

  private workerObject(worker: { id: string; title: string; connected: boolean }) {
    return { id: worker.id, title: () => worker.title, isConnected: () => worker.connected };
  }

  private workspaceObject(workspace: FakeInstallation['workspaces'][number]) {
    return { id: workspace.id, name: workspace.name, workspaceProvisionerId: workspace.workspaceProvisionerId, workerId: workspace.workerId, isMounted: () => workspace.mounted };
  }

  context(translations: Record<string, string>, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const installation = this;
    const ok = <T>(value: T): Result<T> => ({ ok: true, value });
    return {
      applicationId: 'github.com/frontierengineer/application-chat',
      translate: (token: string) => translations[token] ?? token,
      store: this.store,
      logger: { debug: async () => {}, info: async () => {}, warn: async () => {}, error: async () => {} },
      notifications: { create: async (notification: { title: string; body?: string; priority: string }) => { installation.notified.push(notification); return ok({ id: `notification-${installation.notified.length}` }); } },
      sessions: {
        async create(options: SessionCreateOptions) {
          installation.createOptions.push(options);
          if (installation.createDelay > 0) await new Promise((resolve) => setTimeout(resolve, installation.createDelay));
          if (installation.createFailure) return installation.createFailure;
          const runtime = installation.runtimes.find((entry) => entry.id === options.runtimeId);
          if (!runtime?.reports[options.workerId]?.ready) return { ok: false, unavailable: true, message: `${runtime?.title ?? 'The runtime'} is not ready on this worker.` };
          installation.counter += 1;
          const session = new FakeSession(installation, `session-${installation.counter}`, options);
          installation.sessionMap.set(session.id, session);
          const workspace = installation.workspaces.find((entry) => entry.id === options.workspaceId);
          if (workspace) {
            workspace.mounted = true;
            workspace.holders += 1;
          }
          installation.changed('session', session.id, 'added');
          setTimeout(() => { if (installation.agentModes.length > 0) session.report(installation.agentModes, installation.agentModes[0]!.id); }, installation.reportDelay);
          return ok(session);
        },
        async list() { return ok([...installation.sessionMap.values()]); },
        async get(id: string) {
          const session = installation.sessionMap.get(id);
          return session ? ok(session) : notFound(`There is no session ${id}.`);
        },
        async release(id: string) {
          const session = installation.sessionMap.get(id);
          if (!session) return notFound(`There is no session ${id}.`);
          installation.sessionMap.delete(id);
          installation.released.push(id);
          const workspace = installation.workspaces.find((entry) => entry.id === session.workspace?.workspaceId);
          if (workspace) workspace.holders -= 1;
          installation.changed('session', id, 'removed');
          return ok(undefined);
        },
        onChanged: (handler: Handler<{ id: string; kind: 'added' | 'changed' | 'removed' }>) => installation.sessionChanges.add(handler),
      },
      runtimes: {
        async list() { return ok(installation.runtimes.map((runtime) => installation.runtimeObject(runtime))); },
        async get(id: string) {
          const runtime = installation.runtimes.find((entry) => entry.id === id);
          return runtime ? ok(installation.runtimeObject(runtime)) : notFound(`There is no runtime ${id}.`);
        },
        onChanged: (handler: Handler<{ id: string; kind: 'added' | 'changed' | 'removed' }>) => installation.runtimeChanges.add(handler),
      },
      workers: {
        async list() { return ok(installation.workers.map((worker) => installation.workerObject(worker))); },
        async get(id: string) {
          const worker = installation.workers.find((entry) => entry.id === id);
          return worker ? ok(installation.workerObject(worker)) : notFound('No such worker.');
        },
        onChanged: (handler: Handler<{ id: string; kind: 'added' | 'changed' | 'removed' }>) => installation.workerChanges.add(handler),
      },
      workspaces: {
        async mount(options: { workspaceProvisionerId: string; name?: string; base?: string }) {
          installation.mounted.push(options);
          const provisioner = installation.provisioners.find((entry) => entry.id === options.workspaceProvisionerId);
          if (!provisioner) return notFound('No such provisioner.');
          installation.counter += 1;
          const workspace = { id: `workspace-${installation.counter}`, name: options.name ?? `scratch-${installation.counter}`, workspaceProvisionerId: provisioner.id, workerId: provisioner.workerId, mounted: true, holders: 1 };
          installation.workspaces.push(workspace);
          return ok({ workspaceId: workspace.id, files: {} });
        },
        async unmount(id: string) {
          const workspace = installation.workspaces.find((entry) => entry.id === id);
          installation.unmounted.push(id);
          if (workspace) {
            workspace.holders -= 1;
            if (workspace.holders <= 0) workspace.mounted = false;
          }
          return ok(undefined);
        },
        async list() { return ok(installation.workspaces.map((workspace) => installation.workspaceObject(workspace))); },
        async get(id: string) {
          const workspace = installation.workspaces.find((entry) => entry.id === id);
          return workspace ? ok(installation.workspaceObject(workspace)) : notFound('No such workspace.');
        },
        workspaceProvisioners: {
          async list() {
            return ok(installation.provisioners.map((provisioner) => ({ ...provisioner, applicationId: 'github.com/frontierengineer/application-git-worktrees', description: null, slots: () => ({ total: provisioner.total, used: 0, available: provisioner.total }) })));
          },
          async get(id: string) {
            const provisioner = installation.provisioners.find((entry) => entry.id === id);
            return provisioner ? ok({ ...provisioner, applicationId: 'x', description: null, slots: () => ({ total: provisioner.total, used: 0, available: provisioner.total }) }) : notFound('No such provisioner.');
          },
          onChanged: () => ({ unsubscribe() {} }),
        },
        onChanged: () => ({ unsubscribe() {} }),
      },
      agentDefinitions: { async list() { return ok([{ id: 'default', title: 'Default' }, { id: 'reviewer', title: 'Reviewer' }]); } },
      personas: { async list() { return ok([{ id: 'calm', title: 'Calm', content: 'Be calm.' }]); } },
      methods: {
        async call(applicationId: string, methodId: string, input: Record<string, unknown>) {
          installation.calls.push({ method: methodId, input });
          const method = installation.host?.methods?.[methodId];
          if (!method || !('call' in method)) return { ok: false, unavailable: true, message: 'No such method.' };
          const answer = await method.call(installation.context(translations) as never, input);
          if (answer && typeof answer === 'object' && 'ok' in answer && answer.ok === false) return answer;
          return ok(answer);
        },
        async subscribe() { return { ok: false, unavailable: true, message: 'No subscriptions here.' }; },
      },
      ...extra,
    };
  }

  addRuntime(id: string, title: string, workerIds: string[], models: AvailableModel[] = []): void {
    this.runtimes.push({ id, title, reports: Object.fromEntries(workerIds.map((workerId) => [workerId, { ready: true, reason: null, models }])) });
  }
}
