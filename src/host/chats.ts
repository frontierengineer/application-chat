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

async function liveSession(context: MethodCallContext, chatId: unknown): Promise<Answer<{ chat: ChatRecord; session: Session }>> {
  const loaded = await loadChat(context, chatId);
  if ('ok' in loaded) return loaded;
  const live = await sessionOf(context, loaded.chat);
  if (live && !live.ok) return live;
  if (live && live.ok) return { chat: loaded.chat, session: live.value };
  return startSession(context, loaded.chat, loaded.revision);
}

async function send(context: MethodCallContext, chat: ChatRecord, session: Session, prompt: ChatPrompt): Promise<Answer<PromptChatOutput>> {
  const receipt = await session.prompt({ prompt });
  if (!receipt.ok) return receipt;
  await update(context, chat.id, (current) => ({
    ...current,
    lastPromptAt: Date.now(),
    agentSessionId: agentSessionOf(session, current.agentSessionId),
  }));
  return { sessionId: session.id, turnId: receipt.value.turnId, queued: receipt.value.queued };
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
  if (workspace && 'workspaceId' in workspace) {
    const found = await context.workspaces.get(workspace.workspaceId);
    if (!found.ok) return found.unavailable ? found : failure(t(context, 'error.no_such_workspace'), false, 'workspace');
    if (found.value.workerId !== workerId) return failure(t(context, 'error.workspace_elsewhere'), false, 'workspace');
    chatWorkspace = { workspaceId: found.value.id, title: found.value.name, mountedByChat: false };
  } else if (workspace) {
    const provisioner = await context.workspaces.workspaceProvisioners.get(workspace.workspaceProvisionerId);
    if (!provisioner.ok) return provisioner.unavailable ? provisioner : failure(t(context, 'error.no_such_provisioner'), false, 'workspace');
    if (provisioner.value.workerId !== workerId) return failure(t(context, 'error.provisioner_elsewhere', { provisioner: provisioner.value.title }), false, 'workspace');
    const mounted = await context.workspaces.mount({
      workspaceProvisionerId: workspace.workspaceProvisionerId,
      ...(workspace.name ? { name: workspace.name } : {}),
      ...(workspace.base ? { base: workspace.base } : {}),
    });
    if (!mounted.ok) return mounted;
    const details = await context.workspaces.get(mounted.value.workspaceId);
    chatWorkspace = {
      workspaceId: mounted.value.workspaceId,
      title: details.ok ? details.value.name : workspace.name ?? provisioner.value.title,
      mountedByChat: true,
    };
  }

  const options: SessionCreateOptions = { runtimeId, workerId };
  if (chatWorkspace) options.workspaceId = chatWorkspace.workspaceId;
  if (agentDefinitionId) options.agentDefinitionId = agentDefinitionId;
  if (personaId) options.personaId = personaId;
  if (model) options.model = model;
  const created = await context.sessions.create(options);
  if (!created.ok) {
    if (chatWorkspace?.mountedByChat) await context.workspaces.unmount(chatWorkspace.workspaceId);
    return created;
  }
  const session = created.value;
  const chat: ChatRecord = {
    id: newId(),
    title: title ?? titleFrom(prompt, t(context, 'chat.untitled', { runtime: runtime.value.title })),
    runtimeId,
    workerId,
    workspace: chatWorkspace,
    model: model ?? null,
    agentDefinitionId: agentDefinitionId ?? null,
    personaId: personaId ?? null,
    sessionId: session.id,
    agentSessionId: session.agentSessionId(),
    createdAt: Date.now(),
    lastPromptAt: null,
    releasedAt: null,
  };
  const saved = await save(context, chat, null);
  if (!saved.ok) {
    await context.sessions.release(session.id);
    if (chatWorkspace?.mountedByChat) await context.workspaces.unmount(chatWorkspace.workspaceId);
    return saved;
  }
  if (prompt === undefined) return { chatId: chat.id, sessionId: session.id, turn: null };
  const sent = await send(context, chat, session, prompt);
  if ('ok' in sent) return sent;
  return { chatId: chat.id, sessionId: session.id, turn: { turnId: sent.turnId, queued: sent.queued } };
}

export async function promptChat(context: MethodCallContext, input: Record<string, unknown>): Promise<Answer<PromptChatOutput>> {
  const prompt = readPrompt(input.prompt);
  if (prompt === null) return bad(context, 'prompt', 'error.prompt_shape');
  const live = await liveSession(context, input.chatId);
  if ('ok' in live) return live;
  return send(context, live.chat, live.session, prompt);
}

export async function resumeChat(context: MethodCallContext, input: Record<string, unknown>): Promise<Answer<{ sessionId: string }>> {
  const live = await liveSession(context, input.chatId);
  if ('ok' in live) return live;
  return { sessionId: live.session.id };
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
