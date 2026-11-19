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
  getAttribute(name: string): Promise<string | null>;
  inputValue(): Promise<string>;
  allTextContents(): Promise<string[]>;
  isVisible(): Promise<boolean>;
  isDisabled(): Promise<boolean>;
  selectOption(value: string | { label: string }): Promise<unknown>;
  setInputFiles(files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void>;
  waitFor(options?: { state?: string; timeout?: number }): Promise<void>;
  first(): Locator;
  nth(index: number): Locator;
  locator(selector: string): Locator;
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

async function open(layout: 'wide' | 'compact', size = { width: 1180, height: 760 }, setup = ''): Promise<Page> {
  const page = await browser!.newPage({ viewport: size, colorScheme: 'light' });
  await page.setContent('<!doctype html><html data-mode="light"><head><meta charset="utf-8"></head><body></body></html>');
  await page.addScriptTag({ content: designSystem, type: 'module' });
  await page.waitForFunction('customElements.get("frontier-split") !== undefined');
  await page.addScriptTag({ content: bundle });
  if (setup) await page.evaluate(setup);
  await page.evaluate(`window.mountView(${JSON.stringify(layout)})`);
  return page;
}

async function shot(page: Page, name: string): Promise<void> {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
}

async function eventually(check: () => Promise<boolean>, what: string, attempts = 50): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('a first chat starts from one prompt, streams its turn, queues, cancels, switches mode and model, attaches, releases and resumes', {}, async () => {
  const page = await open('wide');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  assert.match((await page.locator('.summary-text').textContent()) ?? '', /^Claude Code on Laptop · Agent's default · No workspace$/);
  await shot(page, 'wide-new-chat');

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
  await shot(page, 'wide-streaming');

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

  assert.equal(await page.getByLabel('Mode', { exact: true }).inputValue(), 'default', 'the mode in use is chosen');
  await page.getByLabel('Mode', { exact: true }).selectOption('plan');
  await page.getByText('Switched to plan mode').waitFor();
  await page.getByLabel('Model', { exact: true }).selectOption('opus');
  await eventually(async () => (await page.evaluate<string | null>("window.install.sessionMap.get('session-1')?.modelState?.modelId ?? null")) === 'opus', 'the model change');
  await page.getByLabel('Effort', { exact: true }).selectOption('high');
  await eventually(async () => (await page.evaluate<string | null>("window.install.sessionMap.get('session-1')?.modelState?.settings?.effort ?? null")) === 'high', 'the setting change');

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
  await shot(page, 'wide-resumed');
  await page.close();
});

test('the new chat form says why a runtime is not ready, and starts a chat in a new workspace', {}, async () => {
  const page = await open('wide');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.getByText('Options').click();
  await page.getByLabel('Worker', { exact: true }).selectOption('w2');
  await page.getByLabel('Runtime', { exact: true }).selectOption('github.com/frontierengineer/application-opencode');
  await page.getByText('OpenCode is not ready on Build server: OpenCode is not installed on this worker yet.', { exact: false }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Start chat' }).isDisabled(), true);
  await shot(page, 'wide-not-ready');
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

test('a chat whose agent takes long to start shows at once as starting, with its prompt, then runs', {}, async () => {
  const page = await open('wide');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.evaluate('window.install.createDelay = 3000');
  await page.getByLabel('Prompt', { exact: true }).fill('Review the open pull request');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.getByText('Starting the agent.').waitFor({ timeout: 1000 });
  assert.equal(await page.locator('form[aria-label="Send a prompt"] button[type="submit"]').isDisabled(), true, 'nothing more is sent while the agent starts');
  assert.equal(await page.locator('.chat-list frontier-badge').first().textContent(), 'Starting');
  assert.deepEqual(await page.locator('.you').allTextContents(), ['You said:Review the open pull request'], 'the prompt shows while the agent starts');
  await shot(page, 'wide-starting');
  await eventually(async () => (await page.locator('.chat-list frontier-badge').first().textContent()) === 'Running', 'the agent to start and run the prompt', 150);
  assert.equal(await page.locator('.you').count(), 1);
  await page.close();
});

test('a chat whose agent is not open shows what it can, and the whole conversation once the agent opens again', {}, async () => {
  const page = await open('wide');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.getByLabel('Prompt', { exact: true }).fill('Summarize the changelog');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.locator('.you').first().waitFor();
  await page.evaluate("window.stream('The changelog lists three fixes.')");
  await page.evaluate('window.finish()');
  await page.getByText('The changelog lists three fixes.').waitFor();
  await page.evaluate("(() => { const session = window.install.sessionMap.get('session-1'); session.active = false; session.reason = 'Its worker restarted.'; window.install.changed('session', 'session-1'); })()");
  await page.getByText('The agent is not running').waitFor();
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.locator('.chat-list button.entry').first().click();
  await new Promise((resolve) => setTimeout(resolve, 6000));
  assert.equal(await page.getByText('Only the live conversation shows').count(), 0, 'an agent that is not open is not taken as one that cannot replay');
  await page.evaluate("(() => { const session = window.install.sessionMap.get('session-1'); session.active = true; session.reason = null; window.install.changed('session', 'session-1'); })()");
  await page.getByText('The changelog lists three fixes.').waitFor({ timeout: 2000 });
  assert.equal(await page.getByText('Only the live conversation shows').count(), 0);
  await page.close();
});

test('the mode select shows once the agent reports its modes, after the chat opened, and follows a mode the agent switched to itself', {}, async () => {
  const page = await open('wide');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.evaluate("window.install.reportDelay = 1500; window.install.agentModes = [{ id: 'default', name: 'Default', description: 'Asks before it edits.' }, { id: 'plan', name: 'Plan', description: 'Plans without editing.' }, { id: 'auto', name: 'Accept edits', description: 'Edits without asking.' }]");
  await page.getByLabel('Prompt', { exact: true }).fill('Plan the relay queue');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.locator('.you').first().waitFor();
  assert.equal(await page.getByLabel('Mode', { exact: true }).count(), 0, 'no modes before the agent reports them');
  const mode = page.getByLabel('Mode', { exact: true });
  await mode.waitFor({ timeout: 3000 });
  assert.deepEqual([await mode.locator('option').allTextContents(), await mode.inputValue()], [['Default', 'Plan', 'Accept edits'], 'default']);
  assert.deepEqual([await mode.getAttribute('data-size'), await mode.getAttribute('data-variant')], ['small', 'ghost'], "the Design System's small ghost select");
  await page.evaluate("window.install.sessionMap.get('session-1').switchMode('plan')");
  await eventually(async () => (await mode.inputValue()) === 'plan', 'the mode the agent switched to');
  await page.close();
});

test('the compact panel shows the list or one chat at a time, with a way back', {}, async () => {
  const page = await open('compact', { width: 390, height: 780 });
  await page.getByRole('heading', { name: 'Chats' }).waitFor();
  assert.equal(await page.getByText('No chats yet. Start one, and it shows here.').isVisible(), true);
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByLabel('Prompt', { exact: true }).fill('Check on the nightly build');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.locator('.you').first().waitFor();
  await page.evaluate("window.stream('The nightly build is green.')");
  await page.getByText('The nightly build is green.').waitFor();
  await page.evaluate("window.install.sessionMap.get('session-1').replay = false");
  await page.evaluate('window.finish()');
  await page.getByText('Only the live conversation shows').waitFor();
  assert.equal(await page.getByText('The nightly build is green.').count(), 1, 'what streamed in stays when the agent cannot replay');
  await shot(page, 'compact-chat');
  await page.getByRole('button', { name: 'Back to chats' }).click();
  await page.getByRole('heading', { name: 'Chats' }).waitFor();
  assert.equal(await page.locator('.chat-list .entry-title').first().textContent(), 'Check on the nightly build');
  await shot(page, 'compact-list');
  const chatId = await page.evaluate<string>("(async () => (await window.install.store.list('chats/')).value[0].slice('chats/'.length))()");
  await page.evaluate(`window.setPanelValues({ chat: 'not-a-chat' })`);
  assert.equal(await page.getByRole('heading', { name: 'Chats' }).isVisible(), true, 'a chat that Chat does not have is not followed');
  await page.evaluate(`window.setPanelValues({ chat: ${JSON.stringify(chatId)} })`);
  await page.getByRole('button', { name: 'Back to chats' }).waitFor();
  await page.close();
});

test('with no runtime installed, the new chat form says so and points to installing one', {}, async () => {
  const page = await open('wide', undefined, 'window.install.runtimes.length = 0');
  await page.getByRole('heading', { name: 'No runtime yet' }).waitFor();
  await page.getByText('Install an Application that offers one', { exact: false }).waitFor();
  await page.close();
});

test('a model setting\'s description is behind a question mark beside its label, not a caption under it', {}, async () => {
  const page = await open('wide');
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.getByText('Options').click();
  await page.getByLabel('Model', { exact: true }).selectOption('opus');
  await page.getByLabel('Effort', { exact: true }).waitFor();
  assert.equal(await page.getByText('How hard the model thinks', { exact: false }).isVisible(), false, 'no caption shows');
  const about = page.getByRole('button', { name: 'About Effort' });
  assert.equal(await about.getAttribute('title'), 'How hard the model thinks before it answers.', 'it shows on hover');
  await about.click();
  await page.getByText('How hard the model thinks', { exact: false }).waitFor({ state: 'visible' });
  await shot(page, 'wide-setting-about');
  await page.close();
});

test('a chat keeps a reading column or fills the width, as the Surface last chose', {}, async () => {
  const page = await open('wide', { width: 1600, height: 800 });
  await page.getByRole('heading', { name: 'New chat' }).waitFor();
  await page.getByLabel('Prompt', { exact: true }).fill('Explain the build');
  await page.getByLabel('Prompt', { exact: true }).press('Enter');
  await page.locator('.you').first().waitFor();
  await page.evaluate("window.stream('The build bundles each Interface on its own.')");
  await page.evaluate('window.finish()');
  await page.getByText('The build bundles each Interface on its own.').waitFor();
  const widths = () => page.evaluate<{ transcript: number; composer: number }>("({ transcript: document.querySelector('.transcript').getBoundingClientRect().width, composer: document.querySelector('.composer').getBoundingClientRect().width })");
  assert.ok((await widths()).transcript <= 860, 'a reading column at first');
  await shot(page, 'wide-width-column');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Fill the width' }).click();
  await eventually(async () => (await widths()).transcript > 1000 && (await widths()).composer > 1000, 'the transcript and composer to fill the width');
  assert.equal(await page.evaluate<string>("JSON.stringify(window.surfacePreferences.get('width'))"), '"fill"');
  await shot(page, 'wide-width-fill');
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.locator('.chat-list button.entry').first().click();
  await page.getByText('The build bundles each Interface on its own.').waitFor();
  assert.ok((await widths()).transcript > 1000, 'the choice is remembered');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Reading width' }).click();
  await eventually(async () => (await widths()).transcript <= 860, 'the reading column again');
  await page.close();
});
