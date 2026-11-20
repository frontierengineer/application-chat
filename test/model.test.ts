import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPrompt } from '../src/view/attachments.ts';
import { titleFrom } from '../src/shared.ts';

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
