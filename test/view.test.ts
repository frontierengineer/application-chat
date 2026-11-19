import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const frontier = process.env.FRONTIER_REPO || join(root, '..', '..', 'frontier');
const playwrightEntry = join(frontier, 'node_modules', 'playwright', 'index.mjs');
const esbuildEntry = join(frontier, 'node_modules', 'esbuild', 'lib', 'main.js');
const shots = process.env.CHAT_SCREENSHOTS ?? '';
const designSystemEntry = join(frontier, 'modules', 'typescript', 'design_system', 'provider.ts');
const available = existsSync(playwrightEntry) && existsSync(esbuildEntry) && existsSync(designSystemEntry);

type Page = {
  setContent(html: string): Promise<void>;
  addScriptTag(options: { content: string; type?: string }): Promise<unknown>;
  waitForFunction(code: string): Promise<unknown>;
  evaluate<T>(code: string | ((...args: never[]) => T), ...args: unknown[]): Promise<T>;
  getByRole(role: string, options?: Record<string, unknown>): Locator;
  getByText(text: string | RegExp, options?: Record<string, unknown>): Locator;
  getByLabel(text: string | RegExp, options?: Record<string, unknown>): Locator;
  locator(selector: string, options?: { hasText?: string }): Locator;
  keyboard: { press(key: string): Promise<void> };
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  close(): Promise<void>;
};
type Locator = {
  click(): Promise<void>;
  fill(value: string): Promise<void>;
  press(key: string): Promise<void>;
  textContent(): Promise<string | null>;
  isVisible(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  selectOption(value: string | { label: string }): Promise<unknown>;
  setInputFiles(files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void>;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
  first(): Locator;
  nth(index: number): Locator;
  count(): Promise<number>;
  check(): Promise<void>;
};

let browser: { newPage(options?: Record<string, unknown>): Promise<Page>; close(): Promise<void> } | null = null;
let bundle = '';
let designSystem = '';

before(async () => {
  assert.ok(available, `the browser tests need Playwright, esbuild and the Design System from a Frontier checkout at ${frontier}; set FRONTIER_REPO`);
  const { buildSync } = (await import(esbuildEntry)) as { buildSync: (options: Record<string, unknown>) => { outputFiles: { text: string }[] } };
  bundle = buildSync({ entryPoints: [join(root, 'test', 'view', 'page.ts')], bundle: true, format: 'iife', platform: 'browser', target: 'chrome120', write: false, absWorkingDir: root }).outputFiles[0]!.text;
  // The view frame's Design System, as Frontier gives it: its stylesheet and its Behaviors, from the checkout.
  designSystem = buildSync({
    stdin: { contents: `import { designSystemProvider } from ${JSON.stringify(designSystemEntry)};\nconst system = await designSystemProvider.provide({});\nconst style = document.createElement('style');\nstyle.textContent = system.stylesheet;\ndocument.head.append(style);\nsystem.installBehaviors(window);`, resolveDir: frontier, loader: 'ts' },
    bundle: true, format: 'esm', platform: 'browser', target: 'chrome120', write: false, absWorkingDir: frontier,
  }).outputFiles[0]!.text;
  const { chromium } = (await import(playwrightEntry)) as { chromium: { launch(): Promise<typeof browser> } };
  browser = await chromium.launch();
  if (shots) mkdirSync(shots, { recursive: true });
});

after(async () => {
  await browser?.close();
});

async function open(layout: 'desktop' | 'panel', size = { width: 1180, height: 760 }): Promise<Page> {
  const page = await browser!.newPage({ viewport: size, colorScheme: 'light' });
  await page.setContent('<!doctype html><html data-mode="light"><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: designSystem, type: 'module' });
  await page.waitForFunction('customElements.get("frontier-split") !== undefined');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(`window.mountView(${JSON.stringify(layout)})`);
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

async function eventually(check: () => Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a first chat starts from one prompt, streams its turn, queues, cancels, switches mode and model, attaches, releases and resumes', {}, async () => {
  const page = await open('desktop');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  assert.match((await page.locator('.summary-text').textContent()) ?? '', /^Claude Code on Laptop · Agent's default · No workspace$/);
  await shot(page, 'desktop-new-chat');

  await page.getByLabel('Prompt', { exact: true }).fill('Fix the flaky login test');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.locator('.you').first().waitFor();
  assert.equal(await page.locator('.you').first().textContent(), 'You said:Fix the flaky login test', 'the first prompt shows at once, while the agent cannot yet replay');
  const created = await page.evaluate<{ method: string; input: Record<string, unknown> }[]>('window.install.calls');
  assert.equal(created[0]?.method, 'create-chat');
  assert.equal(created[0]?.input.runtimeId, 'github.com/frontierengineer/application-claude-code');
  assert.equal(created[0]?.input.workerId, 'w1');
  assert.equal(await page.locator('.chat-list .entry-title').first().textContent(), 'Fix the flaky login test');
  await eventually(async () => ((await page.locator('.composer .status').textContent()) ?? '').startsWith('Running'), 'the running clock');
  assert.equal(await page.locator('.chat-list frontier-badge').first().textContent(), 'Running');

  await page.evaluate("window.stream('The login test raced the redirect. I made it **wait** for the home page before it checks the user.')");
  await page.getByText('raced the redirect', { exact: false }).waitFor();
  assert.equal(await page.locator('details.tool').count(), 2);
  assert.equal(await page.locator('details.tool .name').first().textContent(), 'Read');
  await page.getByText('Wait for navigation').waitFor();
  await page.locator('details.tool').nth(1).click();
  await page.locator('.diff .line[data-sign="+"]').first().waitFor();
  await shot(page, 'desktop-streaming');

  await page.getByLabel('Prompt', { exact: true }).fill('Also run the whole suite');
  assert.equal(await page.getByRole('button', { name: 'Queue' }).isVisible(), true);
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.getByText('Prompt queued').waitFor();
  await page.evaluate('window.finish()');
  await page.getByText('Also run the whole suite').waitFor();
  assert.equal(await page.getByText('Only the live conversation shows').count(), 0, 'history asked for during a turn is asked for again, not taken as no replay');
  await eventually(async () => (await page.locator('.you', { hasText: 'Fix the flaky login test' }).count()) === 1 && (await page.locator('.you').count()) === 2, 'the shown prompt to give way to the transcript\'s own turn, once');
  await eventually(async () => !(await page.getByText('Prompt queued').isVisible()), 'the queued prompt to start');
  await eventually(async () => ((await page.locator('.composer .status').textContent()) ?? '').startsWith('Running'), 'the second turn to run');

  await page.getByRole('button', { name: 'Stop' }).click();
  await page.getByText('Canceled. What the agent did so far is kept.').first().waitFor();

  await page.getByLabel('Mode', { exact: true }).selectOption('plan');
  await page.getByText('Switched to plan mode').waitFor();
  await page.getByLabel('Model', { exact: true }).selectOption('opus');
  await eventually(async () => (await page.evaluate<string | null>("window.install.sessionMap.get('session-1')?.modelState?.modelId ?? null")) === 'opus', 'the model change');
  await page.getByLabel('Effort', { exact: true }).waitFor();

  await page.locator('input[type="file"]').setInputFiles([{ name: 'screen.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71]) }]);
  await page.getByText('screen.png', { exact: false }).waitFor();
  await page.getByLabel('Prompt', { exact: true }).fill('Does this look right?');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await eventually(async () => (await page.evaluate<number>("window.install.sessionMap.get('session-1').prompts.length")) === 3, 'the prompt with an image');
  const kinds = await page.evaluate<string[]>("window.install.sessionMap.get('session-1').prompts[2].map((part) => part.type)");
  assert.deepEqual(kinds, ['text', 'image']);
  await page.locator('.you .attachment img').first().waitFor();

  await page.evaluate('window.finish()');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Release', exact: true }).click();
  await page.getByText('Its agent is stopped and its workspace slot is free.', { exact: false }).waitFor();
  assert.equal(await page.locator('.chat-list frontier-badge').first().textContent(), 'Released');
  await page.getByLabel('Prompt', { exact: true }).fill('Carry on where you stopped');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await eventually(async () => (await page.locator('.chat-list frontier-badge').first().textContent()) === 'Running', 'the chat to resume');
  const options = await page.evaluate<{ agentSessionId?: string }[]>('window.install.createOptions');
  assert.equal(options[1]?.agentSessionId, 'agent-session-1');
  await page.evaluate("window.stream('Resumed, and the suite passes.')");
  await page.evaluate('window.finish()');
  await page.getByText('Resumed, and the suite passes.').waitFor();
  await shot(page, 'desktop-resumed');
  await page.close();
});

test('the new chat form says why a runtime is not ready, and starts a chat in a new workspace', {}, async () => {
  const page = await open('desktop');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.getByText('Options').click();
  await page.getByLabel('Worker', { exact: true }).selectOption('w2');
  await page.getByLabel('Runtime', { exact: true }).selectOption('github.com/frontierengineer/application-opencode');
  await page.getByText('OpenCode is not ready on Build server: OpenCode is not installed on this worker yet.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start chat' }).isDisabled(), true);
  await shot(page, 'desktop-not-ready');
  await page.getByLabel('Worker', { exact: true }).selectOption('w1');
  await page.getByLabel('New workspace', { exact: true }).check();
  await page.getByLabel('Name', { exact: true }).fill('fix-login');
  await page.getByLabel('Prompt', { exact: true }).fill('Start on the login fix');
  await page.getByRole('button', { name: 'Start chat' }).click();
  await page.locator('.you').first().waitFor();
  const calls = await page.evaluate<{ input: Record<string, unknown> }[]>('window.install.calls');
  assert.deepEqual(calls[0]?.input.workspace, { workspaceProvisionerId: 'git-1', name: 'fix-login' });
  assert.equal(calls[0]?.input.runtimeId, 'github.com/frontierengineer/application-opencode');
  assert.match((await page.locator('.conversation-header .meta').textContent()) ?? '', /OpenCode on Laptop · fix-login/);
  await page.close();
});

test('the panel shows the list or one chat at a time, with a way back', {}, async () => {
  const page = await open('panel', { width: 390, height: 780 });
  await page.getByRole('heading', { name: 'Chats' }).waitFor();
  assert.equal(await page.getByText('No chats yet. Start one, and it shows here.').isVisible(), true);
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('Check on the nightly build');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.locator('.you').first().waitFor();
  await page.evaluate("window.stream('The nightly build is green.')");
  await page.getByText('The nightly build is green.').waitFor();
  await shot(page, 'panel-chat');
  await page.getByRole('button', { name: 'Back to chats' }).click();
  await page.getByRole('heading', { name: 'Chats' }).waitFor();
  assert.equal(await page.locator('.chat-list .entry-title').first().textContent(), 'Check on the nightly build');
  await shot(page, 'panel-list');
  await page.close();
});
