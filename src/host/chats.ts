import type {
  Failure,
  MethodCallContext,
  PromptContentPart,
  Result,
  RuntimeModelSelection,
  Session,
  SessionCreateOptions,
  Unavailable,
} from '../../../application';
import {
  type ChatPrompt,
  type ChatRecord,
  type CreateChatOutput,
  type PromptChatOutput,
  type WorkspaceChoice,
  chatKey,
  newId,
  titleFrom,
} from '../shared.ts';
import { failure, text } from '../text.ts';

type Answer<T> = T | Failure | Unavailable;

const partTypes = new Set(['text', 'image', 'audio', 'resource_link', 'resource_text', 'resource_blob']);

function t(context: MethodCallContext, token: string, values: Record<string, string | number> = {}): string {
  return text(context, token, values);
}

function bad(context: MethodCallContext, field: string, token: string): Failure {
  return failure(t(context, token), false, field);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined | null {
  const value = input[key];
  if (value === undefined || value === null || value === '') return undefined;
  return typeof value === 'string' ? value : null;
}

function requiredString(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function readPrompt(value: unknown): ChatPrompt | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  if (!Array.isArray(value) || value.length === 0) return null;
  for (const part of value) {
    if (!part || typeof part !== 'object' || !partTypes.has((part as { type?: string }).type ?? '')) return null;
  }
  return value as PromptContentPart[];
}

function readModel(value: unknown): RuntimeModelSelection | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return null;
  const model = value as { modelId?: unknown; settings?: unknown };
  if (typeof model.modelId !== 'string' || model.modelId === '') return null;
  if (model.settings !== undefined && (model.settings === null || typeof model.settings !== 'object')) return null;
  return model.settings === undefined ? { modelId: model.modelId } : { modelId: model.modelId, settings: model.settings as RuntimeModelSelection['settings'] };
}

function readWorkspace(value: unknown): WorkspaceChoice | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object') return null;
  const choice = value as Record<string, unknown>;
  if (typeof choice.workspaceId === 'string' && choice.workspaceId !== '') return { workspaceId: choice.workspaceId };
  if (typeof choice.workspaceProvisionerId === 'string' && choice.workspaceProvisionerId !== '') {
    const name = optionalString(choice, 'name');
    const base = optionalString(choice, 'base');
    if (name === null || base === null) return null;
    return {
      workspaceProvisionerId: choice.workspaceProvisionerId,
      ...(name === undefined ? {} : { name }),
      ...(base === undefined ? {} : { base }),
    };
  }
  return null;
}

async function loadChat(context: MethodCallContext, chatId: unknown): Promise<Answer<{ chat: ChatRecord; revision: string }>> {
  if (typeof chatId !== 'string' || chatId === '') return bad(context, 'chatId', 'error.chat_id_required');
  const entry = await context.store.getJsonEntry<ChatRecord>(chatKey(chatId));
  if (!entry.ok) return entry;
  if (entry.value === null) return failure(t(context, 'error.no_such_chat', { chatId }), false, 'chatId');
  return { chat: entry.value.value, revision: entry.value.revision };
}

async function save(context: MethodCallContext, chat: ChatRecord, revision: string | null): Promise<Result<{ revision: string }>> {
  return context.store.putJsonEntry({ key: chatKey(chat.id), value: chat, revision });
}

async function update(context: MethodCallContext, chatId: string, change: (chat: ChatRecord) => ChatRecord): Promise<Result<ChatRecord>> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const loaded = await loadChat(context, chatId);
    if ('ok' in loaded) return loaded;
    const next = change(loaded.chat);
    const saved = await save(context, next, loaded.revision);
    if (saved.ok) return { ok: true, value: next };
    if (saved.unavailable || !saved.retriable) return saved;
  }
  return failure(t(context, 'error.busy_chat'), true);
}

function agentSessionOf(session: Session, previous: string | null): string | null {
  return session.agentSessionId() ?? previous;
}

async function sessionOf(context: MethodCallContext, chat: ChatRecord): Promise<Result<Session> | null> {
  if (chat.sessionId === null) return null;
  const got = await context.sessions.get(chat.sessionId);
  if (got.ok || got.unavailable || got.retriable) return got;
  return null;
}

async function startSession(context: MethodCallContext, chat: ChatRecord, revision: string): Promise<Answer<{ chat: ChatRecord; session: Session }>> {
  const options: SessionCreateOptions = { runtimeId: chat.runtimeId, workerId: chat.workerId };
  if (chat.workspace) options.workspaceId = chat.workspace.workspaceId;
  if (chat.agentDefinitionId) options.agentDefinitionId = chat.agentDefinitionId;
  if (chat.agentSessionId) options.agentSessionId = chat.agentSessionId;
  else if (chat.personaId) options.personaId = chat.personaId;
  if (chat.model) options.model = chat.model;
  const created = await context.sessions.create(options);
  if (!created.ok) return created;
  const next: ChatRecord = {
    ...chat,
    sessionId: created.value.id,
    releasedAt: null,
    agentSessionId: agentSessionOf(created.value, chat.agentSessionId),
  };
  const saved = await save(context, next, revision);
  if (saved.ok) return { chat: next, session: created.value };
  await context.sessions.release(created.value.id);
  if (saved.unavailable || !saved.retriable) return saved;
  const again = await loadChat(context, chat.id);
  if ('ok' in again) return again;
  const live = await sessionOf(context, again.chat);
  if (live && live.ok) return { chat: again.chat, session: live.value };
  return failure(t(context, 'error.busy_chat'), true);
}

async function send(context: MethodCallContext, chat: ChatRecord, session: Session, prompt: ChatPrompt): Promise<Answer<PromptChatOutput>> {
  const receipt = await session.prompt({ prompt });
  if (!receipt.ok) return receipt;
  await update(context, chat.id, (current) => ({
    ...current,
    lastPromptAt: Date.now(),
    agentSessionId: agentSessionOf(session, current.agentSessionId),
    starting: null,
    startFailure: null,
  }));
  return { sessionId: session.id, turnId: receipt.value.turnId, queued: receipt.value.queued };
}

// A start that has run for ten minutes is taken as lost, as when the Host restarted under it, and may be made again.
function stillStarting(chat: ChatRecord): boolean {
  return Boolean(chat.starting) && Date.now() - (chat.starting?.since ?? 0) < 600_000;
}

function wantsWait(input: Record<string, unknown>): boolean {
  return input.wait !== false;
}

export async function createChat(context: MethodCallContext, input: Record<string, unknown>): Promise<Answer<CreateChatOutput>> {
  const runtimeId = requiredString(input, 'runtimeId');
  if (runtimeId === null) return bad(context, 'runtimeId', 'error.runtime_required');
  const workerId = requiredString(input, 'workerId');
  if (workerId === null) return bad(context, 'workerId', 'error.worker_required');
  const title = optionalString(input, 'title');
  if (title === null) return bad(context, 'title', 'error.title_text');
  const agentDefinitionId = optionalString(input, 'agentDefinitionId');
  if (agentDefinitionId === null) return bad(context, 'agentDefinitionId', 'error.id_text');
  const personaId = optionalString(input, 'personaId');
  if (personaId === null) return bad(context, 'personaId', 'error.id_text');
  const model = readModel(input.model);
  if (model === null) return bad(context, 'model', 'error.model_shape');
  const workspace = readWorkspace(input.workspace);
  if (workspace === null) return bad(context, 'workspace', 'error.workspace_shape');
  const prompt = input.prompt === undefined || input.prompt === '' ? undefined : readPrompt(input.prompt);
  if (prompt === null) return bad(context, 'prompt', 'error.prompt_shape');

  const runtime = await context.runtimes.get(runtimeId);
  if (!runtime.ok) return runtime.unavailable ? runtime : failure(t(context, 'error.no_such_runtime', { runtimeId }), false, 'runtimeId');

  let chatWorkspace: ChatRecord['workspace'] = null;
  let provisioned: { workspaceProvisionerId: string; name?: string; base?: string; title: string } | null = null;
  if (workspace && 'workspaceId' in workspace) {
    const found = await context.workspaces.get(workspace.workspaceId);
    if (!found.ok) return found.unavailable ? found : failure(t(context, 'error.no_such_workspace'), false, 'workspace');
    if (found.value.workerId !== workerId) return failure(t(context, 'error.workspace_elsewhere'), false, 'workspace');
    chatWorkspace = { workspaceId: found.value.id, title: found.value.name, mountedByChat: false };
  } else if (workspace) {
    const provisioner = await context.workspaces.workspaceProvisioners.get(workspace.workspaceProvisionerId);
    if (!provisioner.ok) return provisioner.unavailable ? provisioner : failure(t(context, 'error.no_such_provisioner'), false, 'workspace');
    if (provisioner.value.workerId !== workerId) return failure(t(context, 'error.provisioner_elsewhere', { provisioner: provisioner.value.title }), false, 'workspace');
    provisioned = { ...workspace, title: workspace.name ?? provisioner.value.title };
  }

  const chat: ChatRecord = {
    id: newId(),
    title: title ?? titleFrom(prompt, t(context, 'chat.untitled', { runtime: runtime.value.title })),
    runtimeId,
    workerId,
    workspace: chatWorkspace,
    model: model ?? null,
    agentDefinitionId: agentDefinitionId ?? null,
    personaId: personaId ?? null,
    sessionId: null,
    agentSessionId: null,
    createdAt: Date.now(),
    lastPromptAt: null,
    releasedAt: null,
    starting: { since: Date.now(), prompt: prompt ?? null },
    startFailure: null,
  };
  const saved = await save(context, chat, null);
  if (!saved.ok) return saved;
  const started = firstStart(context, chat, provisioned, prompt);
  if (!wantsWait(input)) {
    void started;
    return { chatId: chat.id, sessionId: null, turn: null };
  }
  const outcome = await started;
  if ('ok' in outcome) {
    // A caller that waited hears the failure itself, so nothing is left behind for it.
    await context.store.delete(chatKey(chat.id));
    return outcome;
  }
  return { chatId: chat.id, ...outcome };
}

// Mounts the chat's new workspace, starts its session and sends its first prompt, keeping each step on the record,
// so a view that did not wait follows it there; a step that fails is kept on the record as the start's failure.
async function firstStart(
  context: MethodCallContext,
  chat: ChatRecord,
  provisioned: { workspaceProvisionerId: string; name?: string; base?: string; title: string } | null,
  prompt: ChatPrompt | undefined,
): Promise<Answer<{ sessionId: string; turn: { turnId: string; queued: boolean } | null }>> {
  let workspace = chat.workspace;
  if (provisioned) {
    const mounted = await context.workspaces.mount({
      workspaceProvisionerId: provisioned.workspaceProvisionerId,
      ...(provisioned.name ? { name: provisioned.name } : {}),
      ...(provisioned.base ? { base: provisioned.base } : {}),
    });
    if (!mounted.ok) return startFailed(context, chat.id, mounted);
    const details = await context.workspaces.get(mounted.value.workspaceId);
    workspace = { workspaceId: mounted.value.workspaceId, title: details.ok ? details.value.name : provisioned.title, mountedByChat: true };
    const kept = await update(context, chat.id, (current) => ({ ...current, workspace }));
    if (!kept.ok) {
      await context.workspaces.unmount(mounted.value.workspaceId);
      return startFailed(context, chat.id, kept);
    }
  }
  const options: SessionCreateOptions = { runtimeId: chat.runtimeId, workerId: chat.workerId };
  if (workspace) options.workspaceId = workspace.workspaceId;
  if (chat.agentDefinitionId) options.agentDefinitionId = chat.agentDefinitionId;
  if (chat.personaId) options.personaId = chat.personaId;
  if (chat.model) options.model = chat.model;
  const created = await context.sessions.create(options);
  if (!created.ok) {
    if (workspace?.mountedByChat) {
      await context.workspaces.unmount(workspace.workspaceId);
      await update(context, chat.id, (current) => ({ ...current, workspace: current.workspace ? { ...current.workspace, mountedByChat: false } : null }));
    }
    return startFailed(context, chat.id, created);
  }
  const session = created.value;
  const recorded = await update(context, chat.id, (current) => ({
    ...current,
    sessionId: session.id,
    agentSessionId: agentSessionOf(session, current.agentSessionId),
    starting: prompt === undefined ? null : current.starting,
    startFailure: null,
  }));
  if (!recorded.ok) {
    await context.sessions.release(session.id);
    if (workspace?.mountedByChat) await context.workspaces.unmount(workspace.workspaceId);
    return startFailed(context, chat.id, recorded);
  }
  if (prompt === undefined) return { sessionId: session.id, turn: null };
  const sent = await send(context, recorded.value, session, prompt);
  if ('ok' in sent) return startFailed(context, chat.id, sent);
  return { sessionId: session.id, turn: { turnId: sent.turnId as string, queued: sent.queued } };
}

async function startFailed<F extends Failure | Unavailable>(context: MethodCallContext, chatId: string, failed: F): Promise<F> {
  const kept = await update(context, chatId, (current) => ({ ...current, starting: null, startFailure: failed.message }));
  if (!kept.ok) void context.logger.warn('A chat did not start, and that could not be kept on it', { chatId, reason: failed.message, keeping: kept.message });
  return failed;
}

export async function promptChat(context: MethodCallContext, input: Record<string, unknown>): Promise<Answer<PromptChatOutput>> {
  const prompt = readPrompt(input.prompt);
  if (prompt === null) return bad(context, 'prompt', 'error.prompt_shape');
  const loaded = await loadChat(context, input.chatId);
  if ('ok' in loaded) return loaded;
  const live = await sessionOf(context, loaded.chat);
  if (live && !live.ok) return live;
  if (live && live.ok) return send(context, loaded.chat, live.value, prompt);
  if (stillStarting(loaded.chat)) return failure(t(context, 'error.starting'), true);
  const started = restart(context, loaded.chat.id, prompt);
  if (!wantsWait(input)) {
    void started;
    return { sessionId: null, turnId: null, queued: true };
  }
  return started;
}

// Starts a released chat again on a fresh session that continues its conversation, then sends the prompt, if any;
// the record says it is starting meanwhile, and keeps why when it does not.
async function restart(context: MethodCallContext, chatId: string, prompt: ChatPrompt | null): Promise<Answer<PromptChatOutput>> {
  const marked = await update(context, chatId, (current) => ({ ...current, starting: { since: Date.now(), prompt }, startFailure: null }));
  if (!marked.ok) return marked;
  const loaded = await loadChat(context, chatId);
  if ('ok' in loaded) return startFailed(context, chatId, loaded);
  const live = await sessionOf(context, loaded.chat);
  const started = live && live.ok ? { chat: loaded.chat, session: live.value } : await startSession(context, loaded.chat, loaded.revision);
  if ('ok' in started) return startFailed(context, chatId, started);
  if (prompt === null) {
    const done = await update(context, chatId, (current) => ({ ...current, starting: null }));
    if (!done.ok) return done;
    return { sessionId: started.session.id, turnId: null, queued: false };
  }
  const sent = await send(context, started.chat, started.session, prompt);
  if ('ok' in sent) return startFailed(context, chatId, sent);
  return sent;
}

export async function resumeChat(context: MethodCallContext, input: Record<string, unknown>): Promise<Answer<{ sessionId: string | null }>> {
  const loaded = await loadChat(context, input.chatId);
  if ('ok' in loaded) return loaded;
  const live = await sessionOf(context, loaded.chat);
  if (live && !live.ok) return live;
  if (live && live.ok) return { sessionId: live.value.id };
  if (stillStarting(loaded.chat)) return failure(t(context, 'error.starting'), true);
  const started = restart(context, loaded.chat.id, null);
  if (!wantsWait(input)) {
    void started;
    return { sessionId: null };
  }
  const outcome = await started;
  if ('ok' in outcome) return outcome;
  return { sessionId: outcome.sessionId };
}

export async function releaseChat(context: MethodCallContext, input: Record<string, unknown>): Promise<Answer<{ released: boolean }>> {
  const loaded = await loadChat(context, input.chatId);
  if ('ok' in loaded) return loaded;
  const chat = loaded.chat;
  let agentSessionId = chat.agentSessionId;
  if (chat.sessionId !== null) {
    const live = await sessionOf(context, chat);
    if (live && live.ok) agentSessionId = agentSessionOf(live.value, agentSessionId);
    if (live && !live.ok) return live;
    if (live && live.ok) {
      const released = await context.sessions.release(chat.sessionId);
      if (!released.ok) return released;
    }
  }
  let workspace = chat.workspace;
  if (workspace?.mountedByChat) {
    const unmounted = await context.workspaces.unmount(workspace.workspaceId);
    if (unmounted.ok) workspace = { ...workspace, mountedByChat: false };
    else void context.logger.warn('The chat workspace stayed mounted', { workspaceId: workspace.workspaceId, reason: unmounted.message });
  }
  const updated = await update(context, chat.id, (current) => ({
    ...current,
    sessionId: null,
    agentSessionId,
    workspace,
    releasedAt: current.releasedAt ?? Date.now(),
    starting: null,
  }));
  if (!updated.ok) return updated;
  return { released: chat.sessionId !== null };
}

export async function removeChat(context: MethodCallContext, input: Record<string, unknown>): Promise<Answer<{ removed: boolean }>> {
  const released = await releaseChat(context, input);
  if (released && 'ok' in released) return released;
  const removed = await context.store.delete(chatKey(input.chatId as string));
  if (!removed.ok) return removed;
  return { removed: true };
}

export async function listChats(context: MethodCallContext): Promise<Answer<{ chats: ChatRecord[] }>> {
  const keys = await context.store.list('chats/');
  if (!keys.ok) return keys;
  const chats: ChatRecord[] = [];
  for (const key of keys.value) {
    const chat = await context.store.getJson<ChatRecord>(key);
    if (!chat.ok) return chat;
    if (chat.value) chats.push(chat.value);
  }
  chats.sort((a, b) => (b.lastPromptAt ?? b.createdAt) - (a.lastPromptAt ?? a.createdAt));
  return { chats };
}
