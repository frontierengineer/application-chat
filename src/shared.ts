import type { PromptContentPart, RuntimeModelSelection } from '../../application';

export const applicationId = 'github.com/frontierengineer/application-chat';

export interface ChatWorkspace {
  workspaceId: string;
  title: string;
  mountedByChat: boolean;
}

export interface ChatRecord {
  id: string;
  title: string;
  runtimeId: string;
  workerId: string;
  workspace: ChatWorkspace | null;
  model: RuntimeModelSelection | null;
  agentDefinitionId: string | null;
  personaId: string | null;
  sessionId: string | null;
  agentSessionId: string | null;
  createdAt: number;
  lastPromptAt: number | null;
  releasedAt: number | null;
  // While the agent starts in the background, since when and the prompt it is to be sent; null once it runs or failed.
  starting?: { since: number; prompt: ChatPrompt | null } | null;
  // Why the agent last failed to start, in the runtime's or Frontier's words; null when it started.
  startFailure?: string | null;
}

export type ChatPrompt = string | readonly PromptContentPart[];

export type WorkspaceChoice =
  | { workspaceId: string }
  | { workspaceProvisionerId: string; name?: string; base?: string };

export interface CreateChatInput {
  runtimeId: string;
  workerId: string;
  title?: string;
  model?: RuntimeModelSelection;
  agentDefinitionId?: string;
  personaId?: string;
  workspace?: WorkspaceChoice;
  prompt?: ChatPrompt;
  // false answers once the chat is recorded and starts its agent in the background.
  wait?: boolean;
}

export type CreateChatOutput = {
  chatId: string;
  // null when the agent is still starting (wait: false).
  sessionId: string | null;
  turn: { turnId: string; queued: boolean } | null;
};

export interface PromptChatInput {
  chatId: string;
  prompt: ChatPrompt;
}

export type PromptChatOutput = {
  // null, with turnId, when the chat's agent is starting again in the background (wait: false).
  sessionId: string | null;
  turnId: string | null;
  queued: boolean;
};

export function chatKey(chatId: string): string {
  return `chats/${chatId}`;
}

// Written while a view shows the chat to a person, so its finished turns need no notification.
export function seenKey(chatId: string): string {
  return `seen/${chatId}`;
}

// How long a view's mark that it shows a chat holds; a view writes it again well within this.
export const SEEN_MILLISECONDS = 30_000;

// A request to a Chat panel on the Surface to show a chat, taken once by the panel that shows it.
export function openKey(surfaceId: string): string {
  return `open/${surfaceId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

// What a Chat panel on the Surface shows, so the Chats panel there marks it.
export function shownKey(surfaceId: string): string {
  return `shown/${surfaceId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

export function promptText(prompt: ChatPrompt): string {
  if (typeof prompt === 'string') return prompt;
  return prompt.map((part) => (part.type === 'text' ? part.text : '')).join('\n').trim();
}

export function titleFrom(prompt: ChatPrompt | undefined, fallback: string): string {
  const line = prompt === undefined ? '' : promptText(prompt).split('\n').map((text) => text.trim()).find((text) => text.length > 0) ?? '';
  if (line === '') return fallback;
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line;
}

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
