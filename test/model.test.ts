import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/view/attachments.ts';
import { titleFrom } from '../src/shared.ts';
import { TranscriptModel, trimDiff } from '../src/view/transcript-model.ts';

test('streamed text grows by its deltas and takes the final text, and a tool call meets its result', () => {
  const model = new TranscriptModel();
  model.apply({ type: 'turn_start', userPrompt: 'hi', turnId: 't1', timestamp: 1 });
  model.apply({ type: 'attachment', channel: 'user', content: { type: 'resource_link', uri: 'https://x/y', name: 'y', mimeType: null }, timestamp: 1 });
  model.apply({ type: 'thinking', id: 'a', delta: 'Let me ', partial: true, text: null, timestamp: 2 });
  model.apply({ type: 'thinking', id: 'a', delta: 'look.', partial: true, text: null, timestamp: 2 });
  model.apply({ type: 'tool_call', callId: 'c1', name: 'Read', input: { file_path: '/a.ts' }, partial: true, toolKind: 'read', status: 'pending', locations: [], content: [], timestamp: 3 });
  model.apply({ type: 'tool_call', callId: 'c1', name: 'Read', input: null, partial: false, toolKind: 'read', status: 'in_progress', locations: [{ path: '/a.ts', line: 3 }], content: [], timestamp: 3 });
  model.apply({ type: 'tool_result', callId: 'c1', output: 'contents', isError: false, durationMilliseconds: 120, timestamp: 4 });
  model.apply({ type: 'text', id: 'b', delta: 'Hel', partial: true, text: null, timestamp: 5 });
  model.apply({ type: 'text', id: 'b', delta: 'lo', partial: true, text: null, timestamp: 5 });
  model.apply({ type: 'plan', entries: [{ content: 'Read', priority: 'high', status: 'completed' }], timestamp: 5 });
  model.apply({ type: 'plan', entries: [{ content: 'Read', priority: 'high', status: 'completed' }, { content: 'Fix', priority: 'medium', status: 'in_progress' }], timestamp: 6 });
  model.apply({ type: 'text', id: 'b', delta: '', partial: false, text: 'Hello there.', timestamp: 6 });
  model.apply({ type: 'commands', commands: [{ name: 'review', description: 'Review' }], timestamp: 6 });
  model.apply({ type: 'done', stopReason: 'end_turn', usage: { contextUsed: 10, contextWindow: 100, costAmount: null, costCurrency: null }, timestamp: 7 });
  assert.deepEqual(model.items.map((item) => item.kind), ['user', 'thinking', 'tool', 'text', 'plan', 'done']);
  const [user, thinking, tool, text, plan] = model.items;
  assert.equal(user?.kind === 'user' && user.attachments.length, 1);
  assert.equal(thinking?.kind === 'thinking' && thinking.text, 'Let me look.');
  assert.equal(thinking?.kind === 'thinking' && thinking.partial, false);
  assert.ok(tool?.kind === 'tool');
  assert.deepEqual(tool.input, { file_path: '/a.ts' });
  assert.equal(tool.status, 'completed');
  assert.deepEqual(tool.result, { output: 'contents', isError: false, durationMilliseconds: 120 });
  assert.equal(text?.kind === 'text' && text.text, 'Hello there.');
  assert.equal(plan?.kind === 'plan' && plan.entries.length, 2);
  assert.equal(model.usage?.contextUsed, 10);
  assert.deepEqual(model.commands, [{ name: 'review', description: 'Review' }]);
  model.reset([{ type: 'turn_start', userPrompt: 'again', turnId: null, timestamp: null }]);
  assert.equal(model.items.length, 1);
});

test('a failed tool result marks the call failed, and a result with no call still shows', () => {
  const model = new TranscriptModel();
  model.apply({ type: 'tool_result', callId: 'lost', output: { error: 'boom' }, isError: true, durationMilliseconds: 5, timestamp: null });
  assert.equal(model.items[0]?.kind === 'tool' && model.items[0].status, 'failed');
});

test('a diff keeps the changed lines with a little context', () => {
  const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n');
  const after = ['a', 'b', 'c', 'd', 'E', 'f', 'g', 'h'].join('\n');
  assert.deepEqual(trimDiff(before, after, 1), [
    { line: '', sign: '…' },
    { line: 'd', sign: ' ' },
    { line: 'e', sign: '-' },
    { line: 'E', sign: '+' },
    { line: 'f', sign: ' ' },
    { line: '', sign: '…' },
  ]);
  assert.deepEqual(trimDiff(null, 'new'), [{ line: 'new', sign: '+' }]);
});

test('attachments become the content parts the agent takes, and the rest is refused by name', () => {
  const encoder = new TextEncoder();
  const image = { name: 'shot.png', type: 'image/png', data: new Uint8Array([137, 80]) };
  const notes = { name: 'notes.md', type: 'text/markdown', data: encoder.encode('# Notes') };
  const binary = { name: 'blob.bin', type: 'application/octet-stream', data: new Uint8Array([0, 1, 2]) };
  const all = { image: true, audio: true, embeddedContext: true };
  const built = buildPrompt('Look', [image, notes, binary], all);
  assert.ok(built.ok);
  assert.deepEqual((built.prompt as readonly { type: string }[]).map((part) => part.type), ['text', 'image', 'resource_text', 'resource_blob']);
  const plain = buildPrompt('Look', [notes], { image: false, audio: false, embeddedContext: false });
  assert.deepEqual(plain, { ok: true, prompt: [{ type: 'text', text: 'Look\n\nnotes.md:\n```\n# Notes\n```' }] });
  assert.deepEqual(buildPrompt('Look', [image, binary], { image: false, audio: false, embeddedContext: false }), { ok: false, refused: ['shot.png', 'blob.bin'], kinds: ['image', 'file'] });
  assert.deepEqual(buildPrompt('only text', [], all), { ok: true, prompt: 'only text' });
});

test('a chat is titled from the first line of its prompt', () => {
  assert.equal(titleFrom('\n  Fix the build  \nmore', 'x'), 'Fix the build');
  assert.equal(titleFrom(undefined, 'Chat with OpenCode'), 'Chat with OpenCode');
  assert.equal(titleFrom('y'.repeat(80), 'x').length, 60);
});
