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
}

export type CreateChatOutput = {
  chatId: string;
  sessionId: string;
  turn: { turnId: string; queued: boolean } | null;
};

export interface PromptChatInput {
  chatId: string;
  prompt: ChatPrompt;
}

export type PromptChatOutput = {
  sessionId: string;
  turnId: string;
  queued: boolean;
};

export function chatKey(chatId: string): string {
  return `chats/${chatId}`;
}

export function openKey(surfaceId: string): string {
  return `open/${surfaceId.replace(/[^A-Za-z0-9._-]/g, '-')}`;
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
