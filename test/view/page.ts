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
  { label: 'Claude Opus', versions: [{ id: 'opus', label: 'Opus 5.5', contextWindow: 200000, settings: [{ type: 'select', key: 'effort', label: 'Effort', choices: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }] }] }] },
  { label: 'Claude Sonnet', versions: [{ id: 'sonnet', label: 'Sonnet 5.5', contextWindow: 200000, settings: [] }] },
];
install.workers.push({ id: 'w1', title: 'Laptop', connected: true }, { id: 'w2', title: 'Build server', connected: true });
install.addRuntime('github.com/frontierengineer/claude-code', 'Claude Code', ['w1', 'w2'], models);
install.addRuntime('github.com/frontierengineer/opencode', 'OpenCode', ['w1']);
install.runtimes[1]!.reports.w2 = { ready: false, reason: 'OpenCode is not installed on this worker yet. It is installed automatically.', models: [] };
install.provisioners.push({ id: 'git-1', title: 'frontier on Laptop', workerId: 'w1', total: 4 });

function live(): { session: FakeSession; turnId: string } | undefined {
  while (pending.length > 0 && pending[0]!.session.turn?.turnId !== pending[0]!.turnId) pending.shift();
  return pending[0];
}

const preferences = new Map<string, unknown>();
const clipboard: string[] = [];
const modalAnswers: unknown[] = [];

function surfaceContext(type: 'workstation' | 'panel'): SurfaceContext & { lifecycle: unknown } {
  const ok = { ok: true as const, value: undefined };
  return {
    ...install.context(translations.en),
    currentSurface: { id: 'surface-1', title: () => 'Work laptop', type, language: () => 'en-US', display: () => null },
    surfacePreferences: {
      get: (key: string, fallback?: unknown) => (preferences.has(key) ? structuredClone(preferences.get(key)) : fallback ?? null),
      set: (key: string, value: unknown) => void preferences.set(key, structuredClone(value)),
      delete: (key: string) => void preferences.delete(key),
    },
    clipboard: { copy: async (text: string) => { clipboard.push(text); return ok; } },
    cursor: { insertText: async () => ok },
    desktop: { update: async () => ok, activate: async () => ok, deactivate: async () => ok, focus: async () => ok, blur: async () => ok },
    panel: { open: async () => ok, close: async () => ok },
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
  clipboard,
  modalAnswers,
  mountView: async (layout: 'desktop' | 'panel') => {
    const context = surfaceContext(layout === 'desktop' ? 'workstation' : 'panel');
    if (layout === 'desktop') await surface.desktop.mount(context as never);
    else await surface.panel.mount(context as never);
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
