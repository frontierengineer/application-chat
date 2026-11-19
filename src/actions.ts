import type { ActionContext, Failure, OptionSourceContext, SelectChoice, Unavailable } from '../../application';
import { type ChatRecord, type CreateChatOutput, applicationId, openKey } from './shared.ts';
import { failure, text } from './text.ts';

async function show(context: ActionContext, target: string): Promise<void | Failure | Unavailable> {
  const written = await context.store.putJson({ key: openKey(context.currentSurface.id), value: { target, at: Date.now() } });
  if (!written.ok) return written;
  const wide = await context.panels.reveal('chat');
  if (wide.ok) return;
  if (!wide.unavailable) return wide;
  const compact = await context.panels.reveal('chat-compact');
  if (!compact.ok && !compact.unavailable) return compact;
}

function required(context: ActionContext, input: Record<string, unknown>, key: string): string | Failure {
  const value = input[key];
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  return failure(text(context, `action.${key}_required`), false, key);
}

export async function newChat(context: ActionContext): Promise<void | Failure | Unavailable> {
  return show(context, 'new');
}

export async function startChat(context: ActionContext, input: Record<string, unknown>): Promise<void | Failure | Unavailable> {
  const runtimeId = required(context, input, 'runtime');
  if (typeof runtimeId !== 'string') return runtimeId;
  const workerId = required(context, input, 'worker');
  if (typeof workerId !== 'string') return workerId;
  const prompt = required(context, input, 'prompt');
  if (typeof prompt !== 'string') return prompt;
  const title = typeof input.title === 'string' && input.title.trim() !== '' ? input.title.trim() : undefined;
  const created = await context.methods.call<CreateChatOutput>(applicationId, 'create-chat', { runtimeId, workerId, prompt, ...(title ? { title } : {}) });
  if (!created.ok) return created;
  return show(context, created.value.chatId);
}

export async function openChat(context: ActionContext, input: Record<string, unknown>): Promise<void | Failure | Unavailable> {
  const chatId = required(context, input, 'chat');
  if (typeof chatId !== 'string') return chatId;
  return show(context, chatId);
}

export async function promptChat(context: ActionContext, input: Record<string, unknown>): Promise<void | Failure | Unavailable> {
  const chatId = required(context, input, 'chat');
  if (typeof chatId !== 'string') return chatId;
  const prompt = required(context, input, 'prompt');
  if (typeof prompt !== 'string') return prompt;
  const sent = await context.methods.call(applicationId, 'prompt-chat', { chatId, prompt });
  if (!sent.ok) return sent;
}

export async function releaseChat(context: ActionContext, input: Record<string, unknown>): Promise<void | Failure | Unavailable> {
  const chatId = required(context, input, 'chat');
  if (typeof chatId !== 'string') return chatId;
  const released = await context.methods.call(applicationId, 'release-chat', { chatId });
  if (!released.ok) return released;
}

export async function listChatChoices(context: OptionSourceContext): Promise<readonly SelectChoice[] | Failure | Unavailable> {
  const keys = await context.store.list('chats/');
  if (!keys.ok) return keys;
  const chats: ChatRecord[] = [];
  for (const key of keys.value) {
    const chat = await context.store.getJson<ChatRecord>(key);
    if (!chat.ok) return chat;
    if (chat.value) chats.push(chat.value);
  }
  return chats
    .sort((a, b) => (b.lastPromptAt ?? b.createdAt) - (a.lastPromptAt ?? a.createdAt))
    .map((chat) => ({ value: chat.id, label: chat.title, description: chat.releasedAt ? text(context, 'state.released') : chat.workspace?.title ?? text(context, 'conversation.no_workspace') }));
}
