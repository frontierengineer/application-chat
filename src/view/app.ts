import type {
  DesktopContext,
  PanelContext,
  Result,
  Runtime,
  Session,
  Worker,
} from '../../../application';
import { type ChatPrompt, type ChatRecord, type PromptChatOutput, applicationId, chatKey, openKey } from '../shared.ts';
import { failure, text } from '../text.ts';
import { type ChatHandle, Conversation, type ConversationHost } from './conversation.ts';
import { ds, h, icon, style } from './dom.ts';
import { ago } from './format.ts';
import { NewChatForm, type NewChatDefaults } from './new-chat.ts';
import { css } from './styles.ts';

export type Layout = 'desktop' | 'panel';
type Selection = { kind: 'chat'; id: string } | { kind: 'session'; id: string } | { kind: 'new' } | null;

export class ChatApp {
  private readonly context: DesktopContext | PanelContext;
  private readonly layout: Layout;
  private readonly chats = new Map<string, ChatRecord>();
  private readonly sessions = new Map<string, Session>();
  private runtimes: Runtime[] = [];
  private workers: Worker[] = [];
  private selection: Selection = null;
  private filter = '';
  private conversation: Conversation | null = null;
  private form: NewChatForm | null = null;
  private loaded = false;
  private redrawQueued = false;
  private readonly list = h('div', { class: 'chat-list' });
  private readonly sidebar: HTMLElement;
  private readonly root: HTMLElement;
  private readonly pending = new Map<string, string>();
  private runtimesAsked = 0;
  private drafts: Record<string, string>;
  private draftTimer = 0;

  constructor(context: DesktopContext | PanelContext, layout: Layout) {
    this.context = context;
    this.layout = layout;
    this.drafts = context.surfacePreferences.get<Record<string, string>>('drafts', {});
    const t = this.t;
    const search = h('input', { type: 'search', placeholder: t('list.search'), 'aria-label': t('list.search') });
    search.addEventListener('input', () => {
      this.filter = search.value.trim().toLowerCase();
      this.drawList();
    });
    this.list.setAttribute('aria-label', t('list.label'));
    const width = context.surfacePreferences.get<number | null>('listWidth', null);
    this.sidebar = h('nav', { class: 'list-pane', 'aria-label': t('list.label'), 'data-size': width ? `${width}px` : '300px', 'data-min': '220px', 'data-max': '480px' },
      ds('frontier-stack', { fill: true, gap: '0' },
        ds('frontier-row', { padding: '3' },
          h('h1', {}, t('list.heading')),
          ds('frontier-spacer'),
          h('button', { type: 'button', 'data-variant': 'primary', 'data-size': 'small', title: t('list.new_help'), onclick: () => this.select({ kind: 'new' }) }, icon('plus'), t('list.new')),
        ),
        ds('frontier-row', { padding: '3', style: 'padding-block-start: 0' }, search),
        ds('frontier-scroll', {}, ds('frontier-stack', { padding: '2', gap: '1' }, this.list)),
      ),
    );
    this.root = layout === 'desktop' ? ds('frontier-split', { class: 'chat desktop' }) : h('div', { class: 'chat panel' });
    this.root.addEventListener('frontier-resize', (event) => {
      const size = (event as CustomEvent<{ size: number }>).detail?.size;
      if (typeof size === 'number' && size > 0) context.surfacePreferences.set('listWidth', Math.round(size));
    });
    const saved = context.surfacePreferences.get<Selection>('selection', null);
    this.selection = saved;
  }

  readonly t = (token: string, values: Record<string, string | number> = {}): string => text(this.context, token, values);

  private get language(): string {
    return this.context.currentSurface.language();
  }

  async start(): Promise<void> {
    document.documentElement.lang = this.language;
    document.body.append(style(css), this.root);
    this.root.append(h('p', { role: 'status', 'aria-busy': 'true' }, this.t('app.loading')));
    document.addEventListener('keydown', (event) => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        this.select({ kind: 'new' });
      }
    });
    this.context.store.watch('chats/', (change) => void this.reloadChat(change.key, change.kind));
    this.context.store.watch('open/', (change) => {
      if (change.kind === 'written' && change.key === openKey(this.context.currentSurface.id)) void this.readOpenRequest();
    });
    this.context.sessions.onChanged((change) => void this.reloadSession(change.id, change.kind));
    this.context.runtimes.onChanged(() => void this.reloadRuntimes().then(() => this.form?.load()));
    this.context.workers.onChanged(() => void this.reloadWorkers().then(() => this.form?.load()));
    this.context.lifecycle.onFocus(() => this.conversation?.focus());
    this.context.lifecycle.onUnmount(() => {
      this.conversation?.dispose();
      this.flushDrafts();
    });
    await Promise.all([this.loadChats(), this.loadSessions(), this.reloadRuntimes(), this.reloadWorkers()]);
    this.loaded = true;
    if (this.selection?.kind === 'chat' && !this.chats.has(this.selection.id)) this.selection = null;
    if (this.selection?.kind === 'session' && !this.sessions.has(this.selection.id)) this.selection = null;
    if (this.selection === null && this.layout === 'desktop') this.selection = this.firstChat() ?? { kind: 'new' };
    await this.readOpenRequest();
    this.drawAll();
  }

  private firstChat(): Selection {
    const first = this.sortedChats()[0];
    return first ? { kind: 'chat', id: first.id } : null;
  }

  private async loadChats(): Promise<void> {
    const keys = await this.context.store.list('chats/');
    if (!keys.ok) return;
    await Promise.all(keys.value.map((key) => this.reloadChat(key, 'written', false)));
  }

  private async reloadChat(key: string, kind: 'written' | 'deleted', draw = true): Promise<void> {
    const id = key.slice('chats/'.length);
    if (kind === 'deleted') this.chats.delete(id);
    else {
      const chat = await this.context.store.getJson<ChatRecord>(key);
      if (chat.ok && chat.value) this.chats.set(id, chat.value);
      else if (chat.ok) this.chats.delete(id);
    }
    if (draw) this.queueRedraw();
  }

  private async loadSessions(): Promise<void> {
    const sessions = await this.context.sessions.list();
    if (!sessions.ok) return;
    this.sessions.clear();
    for (const session of sessions.value) this.sessions.set(session.id, session);
  }

  private async reloadSession(id: string, kind: 'added' | 'changed' | 'removed'): Promise<void> {
    if (kind === 'removed') this.sessions.delete(id);
    else {
      const session = await this.context.sessions.get(id);
      if (session.ok) this.sessions.set(id, session.value);
    }
    this.queueRedraw();
  }

  private async reloadRuntimes(): Promise<void> {
    this.runtimesAsked = Date.now();
    const runtimes = await this.context.runtimes.list();
    if (runtimes.ok) this.runtimes = runtimes.value;
    this.queueRedraw();
  }

  private async reloadWorkers(): Promise<void> {
    const workers = await this.context.workers.list();
    if (workers.ok) this.workers = workers.value;
    this.queueRedraw();
  }

  private async readOpenRequest(): Promise<void> {
    const key = openKey(this.context.currentSurface.id);
    const request = await this.context.store.getJson<{ target: string }>(key);
    if (!request.ok || request.value === null) return;
    await this.context.store.delete(key);
    if (request.value.target === 'new') this.select({ kind: 'new' });
    else {
      if (!this.chats.has(request.value.target)) await this.reloadChat(chatKey(request.value.target), 'written', false);
      this.select({ kind: 'chat', id: request.value.target });
    }
  }

  private queueRedraw(): void {
    if (!this.loaded || this.redrawQueued) return;
    this.redrawQueued = true;
    queueMicrotask(() => {
      this.redrawQueued = false;
      this.drawList();
      this.refreshMain();
    });
  }

  private select(selection: Selection): void {
    const same = JSON.stringify(selection) === JSON.stringify(this.selection);
    this.selection = selection;
    this.context.surfacePreferences.set('selection', selection);
    if (!this.loaded) return;
    if (!same || !this.conversation && !this.form) this.drawAll();
    if (selection?.kind === 'new') this.form?.focus();
    else this.conversation?.focus();
  }

  private sortedChats(): ChatRecord[] {
    return [...this.chats.values()].sort((a, b) => (b.lastPromptAt ?? b.createdAt) - (a.lastPromptAt ?? a.createdAt));
  }

  private runtimeTitle(id: string): string {
    const runtime = this.runtimes.find((entry) => entry.id === id);
    if (runtime) return runtime.title;
    // A runtime offered after this view loaded its list: ask again, at most every ten seconds.
    if (Date.now() - this.runtimesAsked > 10_000) {
      this.runtimesAsked = Date.now();
      void this.reloadRuntimes();
    }
    return this.t('app.unknown_runtime');
  }

  private workerTitle(id: string): string {
    return this.workers.find((worker) => worker.id === id)?.title() ?? this.t('app.unknown_worker');
  }

  private stateOf(session: Session | null, chat: ChatRecord | null): State {
    return stateOf(session, chat, this.t);
  }

  private drawList(): void {
    const t = this.t;
    const now = Date.now();
    const matches = (value: string) => this.filter === '' || value.toLowerCase().includes(this.filter);
    const chats = this.sortedChats().filter((chat) => matches(`${chat.title} ${this.runtimeTitle(chat.runtimeId)} ${chat.workspace?.title ?? ''}`));
    const chatSessions = new Set([...this.chats.values()].map((chat) => chat.sessionId).filter(Boolean));
    const others = [...this.sessions.values()].filter((session) => !chatSessions.has(session.id) && session.visibility === 'public' && matches(this.runtimeTitle(session.runtimeId)));
    const entry = (selection: Selection, title: string, meta: string, state: State) => {
      const current = JSON.stringify(selection) === JSON.stringify(this.selection);
      return h('li', {}, h('button', { type: 'button', class: 'entry', 'aria-current': current ? 'true' : undefined, onclick: () => this.select(selection) },
        h('span', { class: 'entry-title' }, title),
        stateBadge(state),
        h('span', { class: 'entry-meta' }, meta),
      ));
    };
    const children: HTMLElement[] = [];
    if (chats.length === 0 && others.length === 0) {
      children.push(h('p', { class: 'list-empty' }, this.filter === '' ? t('list.empty') : t('list.no_match')));
    }
    if (chats.length > 0) {
      children.push(h('ul', { role: 'list' }, ...chats.map((chat) => {
        const session = chat.sessionId ? this.sessions.get(chat.sessionId) ?? null : null;
        const meta = [this.runtimeTitle(chat.runtimeId), chat.workspace?.title, ago(chat.lastPromptAt ?? chat.createdAt, now, this.language)].filter(Boolean).join(' · ');
        return entry({ kind: 'chat', id: chat.id }, chat.title, meta, this.stateOf(session, chat));
      })));
    }
    if (others.length > 0) {
      children.push(h('h2', {}, t('list.other_sessions')));
      children.push(h('ul', { role: 'list' }, ...others.map((session) =>
        entry({ kind: 'session', id: session.id }, t('list.session_title', { runtime: this.runtimeTitle(session.runtimeId) }),
          [this.workerTitle(session.workerId), ago(session.createdAt, now, this.language)].join(' · '), this.stateOf(session, null)))));
    }
    this.list.replaceChildren(...children);
  }

  private conversationHost(): ConversationHost {
    return {
      t: this.t,
      language: this.language,
      layout: this.layout,
      copy: async (value) => (await this.context.clipboard.copy(value)).ok,
      back: () => this.select(null),
      pending: (key) => this.pending.get(key) ?? null,
      settled: (key) => void this.pending.delete(key),
      runtimeTitle: (id) => this.runtimeTitle(id),
      draft: (key) => this.drafts[key] ?? '',
      saveDraft: (key, value) => {
        if (value === '') delete this.drafts[key];
        else this.drafts[key] = value;
        window.clearTimeout(this.draftTimer);
        this.draftTimer = window.setTimeout(() => this.flushDrafts(), 500);
      },
      promptName: async (title, value) => {
        const answer = await this.context.modals.prompt({ title, fields: [{ type: 'text', key: 'title', label: this.t('conversation.title_field'), default: value, required: true }], submitLabel: this.t('conversation.rename_submit') });
        return answer.ok && answer.value ? String(answer.value.title ?? '') : null;
      },
      confirm: async (title, message, label) => {
        const answer = await this.context.modals.confirm({ title, message, confirmLabel: label, danger: true });
        return answer.ok && answer.value === true;
      },
    };
  }

  private flushDrafts(): void {
    this.context.surfacePreferences.set('drafts', this.drafts);
  }

  private call<T>(methodId: string, input: Record<string, unknown>): Promise<Result<T>> {
    return this.context.methods.call<T>(applicationId, methodId, input);
  }

  private handleFor(selection: Selection): ChatHandle | null {
    if (selection?.kind === 'chat') {
      const chat = this.chats.get(selection.id);
      if (!chat) return null;
      const session = () => (chat.sessionId ? this.sessions.get(chat.sessionId) ?? null : null);
      return {
        key: `chat:${chat.id}`,
        record: chat,
        title: () => chat.title,
        runtimeId: chat.runtimeId,
        workerId: chat.workerId,
        meta: () => [this.t('conversation.on_worker', { runtime: this.runtimeTitle(chat.runtimeId), worker: this.workerTitle(chat.workerId) }), chat.workspace?.title ?? this.t('conversation.no_workspace')].join(' · '),
        session,
        models: () => this.runtimes.find((runtime) => runtime.id === chat.runtimeId)?.on(chat.workerId)?.models ?? [],
        prompt: async (prompt: ChatPrompt) => {
          const answer = await this.call<PromptChatOutput>('prompt-chat', { chatId: chat.id, prompt: prompt as unknown, wait: false });
          if (answer.ok && answer.value.sessionId !== null && !this.sessions.has(answer.value.sessionId)) await this.reloadSession(answer.value.sessionId, 'added');
          return answer;
        },
        release: async () => this.call('release-chat', { chatId: chat.id }),
        resume: async () => {
          const answer = await this.call<{ sessionId: string | null }>('resume-chat', { chatId: chat.id, wait: false });
          if (answer.ok && answer.value.sessionId !== null) await this.reloadSession(answer.value.sessionId, 'added');
          return answer.ok ? { ok: true, value: undefined } : answer;
        },
        rename: async (title: string) => {
          const entry = await this.context.store.getJsonEntry<ChatRecord>(chatKey(chat.id));
          if (!entry.ok) return entry;
          if (!entry.value) return failure(this.t('app.chat_gone'), false);
          const saved = await this.context.store.putJsonEntry({ key: chatKey(chat.id), value: { ...entry.value.value, title }, revision: entry.value.revision });
          return saved.ok ? { ok: true, value: undefined } : saved;
        },
        remove: async () => {
          const answer = await this.call('remove-chat', { chatId: chat.id });
          if (answer.ok) this.select(this.layout === 'desktop' ? { kind: 'new' } : null);
          return answer.ok ? { ok: true, value: undefined } : answer;
        },
      };
    }
    if (selection?.kind === 'session') {
      const id = selection.id;
      const session = () => this.sessions.get(id) ?? null;
      const first = session();
      if (!first) return null;
      return {
        key: `session:${id}`,
        record: null,
        title: () => this.t('list.session_title', { runtime: this.runtimeTitle(first.runtimeId) }),
        runtimeId: first.runtimeId,
        workerId: first.workerId,
        meta: () => this.t('conversation.on_worker', { runtime: this.runtimeTitle(first.runtimeId), worker: this.workerTitle(first.workerId) }),
        session,
        models: () => this.runtimes.find((runtime) => runtime.id === first.runtimeId)?.on(first.workerId)?.models ?? [],
        prompt: async (prompt: ChatPrompt) => {
          const live = session();
          if (!live) return failure(this.t('app.session_gone'), false);
          return live.prompt({ prompt });
        },
        release: async () => {
          const confirmed = await this.conversationHost().confirm(this.t('conversation.release_session_title'), this.t('conversation.release_session_message'), this.t('conversation.release'));
          if (!confirmed) return { ok: true, value: undefined };
          return this.context.sessions.release(id);
        },
        resume: null,
        rename: null,
        remove: null,
      };
    }
    return null;
  }

  private refreshMain(): void {
    if (this.selection?.kind === 'chat' || this.selection?.kind === 'session') {
      const handle = this.handleFor(this.selection);
      if (!handle) {
        this.selection = this.layout === 'desktop' ? this.firstChat() ?? { kind: 'new' } : null;
        this.drawAll();
        return;
      }
      this.conversation?.update(handle);
    }
  }

  private drawAll(): void {
    this.conversation?.dispose();
    this.conversation = null;
    this.form = null;
    this.drawList();
    let main: HTMLElement;
    const handle = this.handleFor(this.selection);
    if (handle) {
      this.conversation = new Conversation(this.conversationHost(), handle);
      main = this.conversation.element;
    } else if (this.selection?.kind === 'new') {
      const defaults = (): NewChatDefaults => this.context.surfacePreferences.get<NewChatDefaults>('defaults', {});
      this.form = new NewChatForm({
        t: this.t,
        language: this.language,
        copy: async (value) => (await this.context.clipboard.copy(value)).ok,
        context: this.context,
        layout: this.layout,
        defaults,
        saveDefaults: (value) => this.context.surfacePreferences.set('defaults', value),
        runtimesListed: (runtimes) => {
          this.runtimes = runtimes;
          this.runtimesAsked = Date.now();
          this.queueRedraw();
        },
        created: (chatId, prompt) => {
          this.pending.set(`chat:${chatId}`, prompt);
          void this.reloadChat(chatKey(chatId), 'written', false).then(async () => {
            await this.loadSessions();
            this.select({ kind: 'chat', id: chatId });
          });
        },
        cancel: this.chats.size > 0 || this.layout === 'panel' ? () => this.select(this.layout === 'desktop' ? this.firstChat() : null) : null,
      });
      main = this.form.element;
    } else {
      main = h('main', { class: 'main' }, ds('frontier-stack', { fill: true, justify: 'center' }, ds('frontier-empty', {},
        icon('chat'),
        h('h2', {}, this.t('app.empty_heading')),
        h('p', {}, this.t('app.empty')),
        h('button', { type: 'button', 'data-variant': 'primary', onclick: () => this.select({ kind: 'new' }) }, icon('plus'), this.t('list.new')),
      )));
    }
    main.setAttribute('data-min', '360px');
    if (this.layout === 'panel') this.root.replaceChildren(this.selection === null ? this.sidebar : main);
    else this.root.replaceChildren(this.sidebar, h('hr'), main);
  }
}

export function mountChat(context: DesktopContext | PanelContext, layout: Layout): Promise<void> {
  return new ChatApp(context, layout).start();
}

export type State = { state: 'running' | 'queued' | 'idle' | 'inactive' | 'released' | 'starting' | 'failed'; label: string };

export function stateOf(session: Session | null, chat: ChatRecord | null, t: (token: string) => string): State {
  if (chat?.starting) return { state: 'starting', label: t('state.starting') };
  if (!session && chat?.startFailure) return { state: 'failed', label: t('state.failed') };
  if (!session) return chat?.releasedAt ? { state: 'released', label: t('state.released') } : { state: 'released', label: t('state.ended') };
  if (!session.isActive()) return { state: 'inactive', label: t('state.inactive') };
  const turn = session.currentTurn();
  if (turn && turn.startedAt !== null) return { state: 'running', label: t('state.running') };
  if (turn) return { state: 'queued', label: t('state.queued') };
  return { state: 'idle', label: t('state.idle') };
}

const tones: Record<State['state'], string> = { running: 'success', queued: 'warning', inactive: 'warning', idle: 'muted', released: 'muted', starting: 'accent', failed: 'danger' };

export function stateBadge(state: State): HTMLElement {
  return ds('frontier-badge', { 'data-tone': tones[state.state], 'data-state': state.state }, state.label);
}
