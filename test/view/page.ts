import type { AvailableModel, SurfaceContext } from '../../../application';
import { registration as host } from '../../host.ts';
import { registration as surface } from '../../surface.ts';
import translations from '../../translations.json';
import { type FakeSession, FakeInstall } from '../fake-install.ts';

const install = new FakeInstall();
install.clock = Date.now();
install.host = host;
const pending: { session: FakeSession; turnId: string }[] = [];
install.agent = (session, turnId) => {
  pending.push({ session, turnId });
  session.emit({ type: 'thinking', id: `${turnId}-think`, delta: 'Reading the test file first.', partial: true, text: null, timestamp: install.now() });
};
const models: AvailableModel[] = [
  { label: 'Claude Opus', versions: [{ id: 'opus', label: 'Opus 5.5', contextWindow: 200000, settings: [{ type: 'select', key: 'effort', label: 'Effort', description: 'How hard the model thinks before it answers.', choices: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] }] }] },
  { label: 'Claude Sonnet', versions: [{ id: 'sonnet', label: 'Sonnet 5.5', contextWindow: 200000, settings: [] }] },
  { label: 'DeepSeek', versions: [{ id: 'deepseek-v4-flash', label: 'V4 Flash', contextWindow: 128000, settings: [] }, { id: 'deepseek-v4-flash-thinking', label: 'V4 Flash, thinking', contextWindow: 128000, settings: [] }, { id: 'deepseek-v4-pro', label: 'V4 Pro', contextWindow: 128000, settings: [] }] },
];
install.workers.push({ id: 'w1', title: 'Laptop', connected: true }, { id: 'w2', title: 'Build server', connected: true });
install.addRuntime('github.com/frontierengineer/application-claude-code', 'Claude Code', ['w1', 'w2'], models);
install.addRuntime('github.com/frontierengineer/application-opencode', 'OpenCode', ['w1']);
install.runtimes[1]!.reports.w2 = { ready: false, reason: 'OpenCode is not installed on this worker yet. It is installed automatically.', models: [] };
install.provisioners.push({ id: 'git-1', title: 'frontier on Laptop', workerId: 'w1', total: 4 });

function live(): { session: FakeSession; turnId: string } | undefined {
  while (pending.length > 0 && pending[0]!.session.turn?.turnId !== pending[0]!.turnId) pending.shift();
  return pending[0];
}

const preferences = new Map<string, unknown>();
const clipboard: string[] = [];
const modalAnswers: unknown[] = [];
const valueHandlers: ((values: Record<string, unknown>) => void)[] = [];

function surfaceContext(type: 'workstation' | 'touch', panelId: string, values: Record<string, unknown> = {}): SurfaceContext & { lifecycle: unknown } {
  const ok = { ok: true as const, value: undefined };
  return {
    ...install.context(translations.en),
    currentSurface: { id: 'surface-1', title: () => 'Work laptop', type, language: () => 'en-US', inputs: () => (type === 'touch' ? ['touch'] : ['pointer', 'keyboard']) },
    surfacePreferences: {
      get: (key: string, fallback?: unknown) => (preferences.has(key) ? structuredClone(preferences.get(key)) : fallback ?? null),
      set: (key: string, value: unknown) => void preferences.set(key, structuredClone(value)),
      delete: (key: string) => void preferences.delete(key),
    },
    clipboard: { copy: async (text: string) => { clipboard.push(text); return ok; } },
    cursor: { insertText: async () => ok },
    panels: { reveal: async () => ok, update: async () => ok },
    instance: { panelId, instanceId: `instance-${panelId}`, values: () => values, onValuesChanged: (handler: (values: Record<string, unknown>) => void) => { valueHandlers.push(handler); return { unsubscribe() {} }; } },
    badges: { update: async () => ok },
    modals: {
      open: async () => ok,
      close: async () => ok,
      prompt: async () => ({ ok: true, value: modalAnswers.shift() ?? null }),
      confirm: async () => ({ ok: true, value: (modalAnswers.shift() ?? true) as boolean }),
      busy: async () => ({ ok: true, value: { dismiss: async () => ok } }),
    },
    actions: { invoke: async () => ok },
    artifacts: {}, scheduler: {}, notifications: {},
    lifecycle: { onFocus: () => ({ unsubscribe() {} }), onBlur: () => ({ unsubscribe() {} }), isFocused: () => true, onUnmount: () => ({ unsubscribe() {} }) },
  } as unknown as SurfaceContext & { lifecycle: unknown };
}

Object.assign(window, {
  install,
  surfacePreferences: { get: (key: string) => preferences.get(key) ?? null },
  clipboard,
  modalAnswers,
  setPanelValues: (values: Record<string, unknown>) => { for (const handler of valueHandlers) handler(values); },
  // A deck holding the Chats panel beside a Chat panel on one Surface, each its own view; or the compact panel alone.
  mountView: async (layout: 'deck' | 'compact', values: Record<string, unknown> = {}) => {
    if (layout === 'compact') {
      await surface.panels['chat-compact'].mount(surfaceContext('touch', 'chat-compact', values) as never);
      return;
    }
    const style = document.createElement('style');
    style.textContent = 'body { display: grid; grid-template-columns: 300px minmax(0, 1fr); }';
    document.head.append(style);
    await surface.panels.chats.mount(surfaceContext('workstation', 'chats') as never);
    await surface.panels.chat.mount(surfaceContext('workstation', 'chat', values) as never);
  },
  stream: (text: string) => {
    const turn = live();
    if (!turn) return false;
    turn.session.emit({ type: 'thinking', id: `${turn.turnId}-think`, delta: '', partial: false, text: 'Reading the test file first.', timestamp: install.now() });
    turn.session.emit({ type: 'tool_call', callId: `${turn.turnId}-read`, name: 'Read', input: { file_path: '/repo/test/login.test.ts' }, partial: false, toolKind: 'read', status: 'in_progress', locations: [{ path: '/repo/test/login.test.ts', line: null }], content: [], timestamp: install.now() });
    turn.session.emit({ type: 'tool_result', callId: `${turn.turnId}-read`, output: 'it("logs in", async () => { ... })', isError: false, durationMilliseconds: 840, timestamp: install.now() });
    turn.session.emit({ type: 'tool_call', callId: `${turn.turnId}-edit`, name: 'Edit', input: { file_path: '/repo/test/login.test.ts' }, partial: false, toolKind: 'edit', status: 'completed', locations: [{ path: '/repo/test/login.test.ts', line: 12 }], content: [{ type: 'diff', path: '/repo/test/login.test.ts', oldText: 'await page.click(login);\nexpect(user).toBe(1);', newText: 'await page.click(login);\nawait page.waitForURL("/home");\nexpect(user).toBe(1);' }], timestamp: install.now() });
    turn.session.emit({ type: 'plan', entries: [{ content: 'Find the race', priority: 'high', status: 'completed' }, { content: 'Wait for navigation', priority: 'high', status: 'completed' }, { content: 'Run the suite', priority: 'medium', status: 'in_progress' }], timestamp: install.now() });
    turn.session.emit({ type: 'text', id: `${turn.turnId}-answer`, delta: text.slice(0, 20), partial: true, text: null, timestamp: install.now() });
    turn.session.emit({ type: 'text', id: `${turn.turnId}-answer`, delta: text.slice(20), partial: true, text: null, timestamp: install.now() });
    return true;
  },
  finish: () => {
    const turn = live();
    if (!turn) return false;
    pending.shift();
    const answer = turn.session.history.filter((event) => event.type === 'text' && event.id === `${turn.turnId}-answer`).map((event) => (event.type === 'text' ? event.delta : '')).join('');
    turn.session.emit({ type: 'text', id: `${turn.turnId}-answer`, delta: '', partial: false, text: answer, timestamp: install.now() });
    turn.session.finish(turn.turnId);
    return true;
  },
});
