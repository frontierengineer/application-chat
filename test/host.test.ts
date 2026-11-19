import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Failure, MethodCallContext } from '../../application';
import { registration } from '../host.ts';
import type { ChatRecord, CreateChatOutput, PromptChatOutput } from '../src/shared.ts';
import { FakeInstall } from './fake-install.ts';

const translations = (JSON.parse(readFileSync(new URL('../translations.json', import.meta.url), 'utf8')) as { en: Record<string, string> }).en;

function setup() {
  const install = new FakeInstall();
  install.host = registration;
  install.workers.push({ id: 'w1', title: 'Laptop', connected: true }, { id: 'w2', title: 'Build server', connected: true });
  install.addRuntime('claude', 'Claude Code', ['w1', 'w2']);
  install.provisioners.push({ id: 'git-1', title: 'project on Laptop', workerId: 'w1', total: 4 });
  const context = install.context(translations) as unknown as MethodCallContext;
  const call = async <T>(method: string, input: Record<string, unknown>): Promise<T | Failure> =>
    (await (registration.methods[method as keyof typeof registration.methods] as { call: (context: MethodCallContext, input: Record<string, unknown>) => Promise<unknown> }).call(context, input)) as T | Failure;
  return { install, call };
}

function value<T>(answer: T | Failure | { ok: false; unavailable: true; message: string }): T {
  assert.ok(!(answer && typeof answer === 'object' && 'ok' in answer), `expected a value, got ${JSON.stringify(answer)}`);
  return answer as T;
}

function failureOf(answer: unknown): Failure {
  assert.ok(answer && typeof answer === 'object' && 'ok' in answer && (answer as Failure).ok === false && !(answer as { unavailable?: boolean }).unavailable, `expected a failure, got ${JSON.stringify(answer)}`);
  return answer as Failure;
}

test('create-chat starts a public session, records the chat and sends the first prompt', async () => {
  const { install, call } = setup();
  const created = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w2', prompt: 'Fix the flaky test in ci.yml\nand explain why', personaId: 'calm', agentDefinitionId: 'reviewer', model: { modelId: 'opus', settings: { effort: 'high' } } }));
  assert.equal(created.sessionId, 'session-1');
  assert.deepEqual(created.turn, { turnId: 'session-1-turn-1', queued: false });
  assert.deepEqual(install.createOptions[0], { runtimeId: 'claude', workerId: 'w2', agentDefinitionId: 'reviewer', personaId: 'calm', model: { modelId: 'opus', settings: { effort: 'high' } } });
  const chat = install.store.peek(`chats/${created.chatId}`) as ChatRecord;
  assert.equal(chat.title, 'Fix the flaky test in ci.yml');
  assert.equal(chat.sessionId, 'session-1');
  assert.equal(chat.agentSessionId, 'agent-session-1');
  assert.equal(chat.workspace, null);
  assert.ok(chat.lastPromptAt);
  assert.deepEqual(install.sessionMap.get('session-1')?.prompts, ['Fix the flaky test in ci.yml\nand explain why']);
});

test('create-chat mounts a new workspace for the chat, and release unmounts it and keeps the conversation to resume', async () => {
  const { install, call } = setup();
  const created = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', workspace: { workspaceProvisionerId: 'git-1', name: 'fix-login', base: 'main' } }));
  assert.deepEqual(install.mounted, [{ workspaceProvisionerId: 'git-1', name: 'fix-login', base: 'main' }]);
  assert.equal(install.createOptions[0]?.workspaceId, 'workspace-1');
  assert.equal(created.turn, null);
  let chat = install.store.peek(`chats/${created.chatId}`) as ChatRecord;
  assert.deepEqual(chat.workspace, { workspaceId: 'workspace-1', title: 'fix-login', mountedByChat: true });
  assert.equal(chat.title, 'Chat with Claude Code');

  assert.deepEqual(value(await call('release-chat', { chatId: created.chatId })), { released: true });
  assert.deepEqual(install.released, ['session-2']);
  assert.deepEqual(install.unmounted, ['workspace-1']);
  chat = install.store.peek(`chats/${created.chatId}`) as ChatRecord;
  assert.equal(chat.sessionId, null);
  assert.ok(chat.releasedAt);
  assert.equal(chat.workspace?.mountedByChat, false);
  assert.equal(chat.agentSessionId, 'agent-session-2');

  const sent = value(await call<PromptChatOutput>('prompt-chat', { chatId: created.chatId, prompt: 'carry on' }));
  assert.equal(sent.sessionId, 'session-3');
  assert.deepEqual(install.createOptions[1], { runtimeId: 'claude', workerId: 'w1', workspaceId: 'workspace-1', agentSessionId: 'agent-session-2' });
  chat = install.store.peek(`chats/${created.chatId}`) as ChatRecord;
  assert.equal(chat.sessionId, 'session-3');
  assert.equal(chat.releasedAt, null);
  assert.deepEqual(value(await call('release-chat', { chatId: created.chatId })), { released: true });
  assert.deepEqual(install.unmounted, ['workspace-1'], 'a workspace the session mounted is unmounted by the platform, not again by Chat');
  assert.deepEqual(value(await call('release-chat', { chatId: created.chatId })), { released: false });
});

test('a chat whose session ended elsewhere is resumed by its next prompt, with the persona not sent again', async () => {
  const { install, call } = setup();
  const created = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', personaId: 'calm', prompt: 'hello' }));
  install.sessionMap.delete(created.sessionId as string);
  const sent = value(await call<PromptChatOutput>('prompt-chat', { chatId: created.chatId, prompt: [{ type: 'text', text: 'again' }] }));
  assert.equal(sent.sessionId, 'session-2');
  assert.deepEqual(install.createOptions[1], { runtimeId: 'claude', workerId: 'w1', agentSessionId: 'agent-session-1' });
  assert.deepEqual(value(await call<{ sessionId: string }>('resume-chat', { chatId: created.chatId })), { sessionId: 'session-2' });
});

test('a prompt sent while a turn runs is queued', async () => {
  const { install, call } = setup();
  install.agent = () => undefined;
  const created = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', prompt: 'long task' }));
  const second = value(await call<PromptChatOutput>('prompt-chat', { chatId: created.chatId, prompt: 'and then this' }));
  assert.equal(second.queued, true);
});

test('create-chat refuses bad input by field and runs nothing', async () => {
  const { install, call } = setup();
  assert.equal(failureOf(await call('create-chat', { workerId: 'w1' })).field, 'runtimeId');
  assert.equal(failureOf(await call('create-chat', { runtimeId: 'claude' })).field, 'workerId');
  assert.equal(failureOf(await call('create-chat', { runtimeId: 'claude', workerId: 'w1', prompt: [{ type: 'video' }] })).field, 'prompt');
  assert.equal(failureOf(await call('create-chat', { runtimeId: 'claude', workerId: 'w1', model: { settings: {} } })).field, 'model');
  assert.equal(failureOf(await call('create-chat', { runtimeId: 'claude', workerId: 'w1', workspace: 'here' })).field, 'workspace');
  assert.equal(failureOf(await call('create-chat', { runtimeId: 'nope', workerId: 'w1' })).message, 'There is no runtime with the id nope. Install it first.');
  assert.equal(failureOf(await call('create-chat', { runtimeId: 'claude', workerId: 'w2', workspace: { workspaceProvisionerId: 'git-1' } })).message, "project on Laptop serves another worker. Choose a provisioner on the chat's worker.");
  assert.equal(install.createOptions.length, 0);
  assert.equal(install.mounted.length, 0);
  const missing = failureOf(await call('prompt-chat', { chatId: 'nope', prompt: 'x' }));
  assert.equal(missing.field, 'chatId');
  assert.equal(failureOf(await call('prompt-chat', { chatId: 'nope' })).field, 'prompt');
});

test('a session that cannot start answers as the platform did and leaves no workspace mounted', async () => {
  const { install, call } = setup();
  install.runtimes[0]!.reports.w1 = { ready: false, reason: 'Not signed in.', models: [] };
  const answer = await call('create-chat', { runtimeId: 'claude', workerId: 'w1', workspace: { workspaceProvisionerId: 'git-1', name: 'x' } });
  assert.deepEqual(answer, { ok: false, unavailable: true, message: 'Claude Code is not ready on this worker.' });
  assert.deepEqual(install.unmounted, ['workspace-1']);
  assert.deepEqual(value(await call<{ chats: ChatRecord[] }>('list-chats', {})).chats, []);
});

test('list-chats answers the most recently prompted first, and remove-chat releases and forgets a chat', async () => {
  const { install, call } = setup();
  const first = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', title: 'First' }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  const second = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', title: 'Second' }));
  await new Promise((resolve) => setTimeout(resolve, 5));
  value(await call('prompt-chat', { chatId: first.chatId, prompt: 'bump' }));
  assert.deepEqual(value(await call<{ chats: ChatRecord[] }>('list-chats', {})).chats.map((chat) => chat.title), ['First', 'Second']);
  assert.deepEqual(value(await call('remove-chat', { chatId: second.chatId })), { removed: true });
  assert.ok(install.released.includes(second.sessionId as string));
  assert.deepEqual(value(await call<{ chats: ChatRecord[] }>('list-chats', {})).chats.map((chat) => chat.title), ['First']);
});

async function until(check: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 100 && !check(); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check(), `timed out waiting for ${what}`);
}

test('create-chat with wait false answers once the chat is recorded as starting, and the record follows the start to the first prompt', async () => {
  const { install, call } = setup();
  const created = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', prompt: 'Tidy the README', wait: false }));
  assert.deepEqual([created.sessionId, created.turn], [null, null]);
  const at = `chats/${created.chatId}`;
  const first = install.store.peek(at) as ChatRecord;
  assert.equal(first.sessionId, null);
  assert.equal(first.starting?.prompt, 'Tidy the README');
  await until(() => (install.store.peek(at) as ChatRecord).starting === null, 'the start to finish');
  const chat = install.store.peek(at) as ChatRecord;
  assert.equal(chat.sessionId, 'session-1');
  assert.equal(chat.startFailure, null);
  assert.deepEqual(install.sessionMap.get('session-1')?.prompts, ['Tidy the README']);
});

test('a chat that does not start in the background keeps why, and prompt-chat with wait false starts it again and sends the prompt', async () => {
  const { install, call } = setup();
  install.runtimes[0]!.reports.w1 = { ready: false, reason: 'Not signed in.', models: [] };
  const created = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', prompt: 'Hello', wait: false }));
  const at = `chats/${created.chatId}`;
  await until(() => (install.store.peek(at) as ChatRecord).startFailure !== null, 'the failure to be kept');
  assert.equal((install.store.peek(at) as ChatRecord).startFailure, 'Claude Code is not ready on this worker.');
  install.runtimes[0]!.reports.w1 = { ready: true, reason: null, models: [] };
  assert.deepEqual(value(await call<PromptChatOutput>('prompt-chat', { chatId: created.chatId, prompt: 'Hello again', wait: false })), { sessionId: null, turnId: null, queued: true });
  await until(() => (install.store.peek(at) as ChatRecord).sessionId !== null && (install.store.peek(at) as ChatRecord).starting === null, 'the chat to start again');
  const chat = install.store.peek(at) as ChatRecord;
  assert.equal(chat.startFailure, null);
  assert.deepEqual(install.sessionMap.get(chat.sessionId as string)?.prompts, ['Hello again']);
});

test('a turn that ends while no view shows its chat raises a notification; one that ends while a view shows it raises none', async () => {
  const { install, call } = setup();
  const created = value(await call<CreateChatOutput>('create-chat', { runtimeId: 'claude', workerId: 'w1', title: 'Tidy', prompt: 'Tidy the README' }));
  const session = install.sessionMap.get(created.sessionId as string)!;
  session.finish(created.turn!.turnId);
  await until(() => install.notified.length === 1, 'the notification');
  assert.deepEqual(install.notified[0], { title: 'Tidy: the agent finished', body: 'It waits for your next prompt in Chat.', priority: 'normal' });
  await install.store.putJson({ key: `seen/${created.chatId}`, value: { at: Date.now() } });
  const sent = value(await call<PromptChatOutput>('prompt-chat', { chatId: created.chatId, prompt: 'And the changelog' }));
  session.finish(sent.turnId as string);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(install.notified.length, 1, 'a chat on screen is not notified');
});
