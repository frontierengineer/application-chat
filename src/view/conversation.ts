import type {
  AvailableModelVersion,
  Field,
  Result,
  Session,
  Subscription,
  SessionMode,
  TranscriptEvent,
  TurnEvent,
  TurnFinishedEvent,
} from '../../../application';
import { type ChatPrompt, type ChatRecord, promptText } from '../shared.ts';
import { type Attachment, buildPrompt } from './attachments.ts';
import { stateBadge, stateOf } from './app.ts';
import { ds, h, icon } from './dom.ts';
import type { ViewEnvironment } from './environment.ts';
import { bytes, clock } from './format.ts';

// The Design System's frontier-transcript, as this view holds it: it draws every event it is fed.
interface TranscriptElement extends HTMLElement {
  apply(events: TranscriptEvent | readonly TranscriptEvent[]): void;
  replay(history: readonly TranscriptEvent[]): void;
  labels: Record<string, string>;
  modes: readonly SessionMode[];
}

// Every word the transcript draws, each a token of translations.json: copyMessage is transcript.copy_message.
const TRANSCRIPT_LABELS = [
  'you', 'agent', 'thought', 'thinking', 'working', 'copy', 'copied', 'copyMessage', 'input', 'output', 'raw', 'locations', 'plan',
  'mode', 'modeChanged', 'commands', 'context', 'created', 'noOutput', 'seconds', 'pending', 'in_progress', 'completed', 'failed',
  'cancelled', 'max_tokens', 'max_turn_requests', 'refusal', 'turnFailed', 'error', 'warning', 'diffApproximate', 'image', 'audio',
  'kind_read', 'kind_edit', 'kind_delete', 'kind_move', 'kind_search', 'kind_execute', 'kind_think', 'kind_fetch', 'kind_switch_mode', 'kind_other',
] as const;

export function transcriptLabels(t: (token: string) => string): Record<string, string> {
  return Object.fromEntries(TRANSCRIPT_LABELS.map((name) => [name, t(`transcript.${name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)}`)]));
}

export interface ChatHandle {
  key: string;
  record: ChatRecord | null;
  title(): string;
  runtimeId: string;
  workerId: string;
  meta(): string;
  session(): Session | null;
  models(): { label: string; versions: AvailableModelVersion[] }[];
  prompt(prompt: ChatPrompt): Promise<Result<{ turnId: string | null; queued: boolean }>>;
  release(): Promise<Result>;
  resume: (() => Promise<Result>) | null;
  rename: ((title: string) => Promise<Result>) | null;
  remove: (() => Promise<Result>) | null;
}

export interface ConversationHost extends ViewEnvironment {
  layout: 'wide' | 'compact';
  back(): void;
  newChat(): void;
  // The prompt a chat was started with, shown at once until the transcript holds it.
  pending(key: string): string | null;
  settled(key: string): void;
  runtimeTitle(runtimeId: string): string;
  draft(key: string): string;
  saveDraft(key: string, text: string): void;
  promptName(title: string, value: string): Promise<string | null>;
  // Whether a chat fills the view's width or keeps a reading column, as this Surface last chose.
  width(): Width;
  setWidth(width: Width): void;
  confirm(title: string, message: string, label: string): Promise<boolean>;
}

export type Width = 'column' | 'fill';

type Notice = { tone: 'info' | 'warning' | 'danger'; title: string; text: string; action?: { label: string; run: () => void } } | null;

export class Conversation {
  readonly element: HTMLElement;
  private handle: ChatHandle;
  private readonly host: ConversationHost;
  private subscriptions: Subscription[] = [];
  // undefined until the first bind, so a chat with no session yet is drawn too.
  private boundSessionId: string | null | undefined = undefined;
  private replayUnavailable = false;
  // History answered unavailable once; a second answer with no turn running means the agent cannot replay.
  private replayDoubted = false;
  private wasActive = false;
  private historyProblem: string | null = null;
  private actionProblem: string | null = null;
  private lastFinished: TurnFinishedEvent | null = null;
  private queued: { turnId: string; text: string } | null = null;
  private attachments: Attachment[] = [];
  private ticker = 0;
  private reloadTimer = 0;
  private sending = false;
  private disposed = false;

  private readonly titleElement = h('h2', {});
  private readonly badges = ds('frontier-row', { wrap: true, gap: '2' });
  private readonly metaElement = h('small', { class: 'meta' });
  private readonly menuSlot = h('span', {});
  private readonly controls = ds('frontier-row', { gap: '2', class: 'controls' }, this.menuSlot);
  private menu: HTMLElement | null = null;
  private menuItems = '';
  private choicesSignature = '';
  private modesSignature = '[]';
  private readonly notices = h('div', { class: 'notices' });
  private readonly scroller = ds('frontier-scroll', { role: 'region', tabindex: '0' });
  private readonly transcript = ds('frontier-transcript', {}) as TranscriptElement;
  private readonly empty: HTMLElement;
  private readonly column = ds('frontier-stack', { class: 'transcript', padding: '5', gap: '4' });
  // The prompt a chat was started with, drawn as its turn until the agent's own transcript holds it.
  private shownPrompt: string | null = null;
  private fed = false;
  private stuck = true;
  private readonly jump = h('button', { type: 'button', class: 'jump', 'data-size': 'small', hidden: true });
  private readonly textarea = h('textarea', { rows: '2' });
  private readonly chips = h('div', { class: 'chips' });
  private readonly choices = ds('frontier-row', { wrap: true, gap: '2' });
  private readonly status = h('span', { class: 'status', 'aria-live': 'polite' });
  private readonly sendButton = h('button', { type: 'submit', 'data-variant': 'primary' });
  private readonly stopButton = h('button', { type: 'button', 'data-variant': 'outline' });
  private readonly attachButton = h('button', { type: 'button', 'data-variant': 'ghost' });
  private readonly fileInput = h('input', { type: 'file', multiple: true, class: 'visually-hidden', tabindex: '-1' });
  private readonly problem = h('p', { class: 'problem', 'data-tone': 'danger', role: 'alert' });
  private readonly composer: HTMLFormElement;

  constructor(host: ConversationHost, handle: ChatHandle) {
    this.host = host;
    this.handle = handle;
    const t = host.t;
    this.jump.append(icon('down'), t('conversation.jump'));
    this.textarea.setAttribute('aria-label', t('composer.label'));
    this.textarea.placeholder = t('composer.placeholder');
    this.sendButton.setAttribute('aria-label', t('composer.send'));
    this.sendButton.append(icon('send'));
    this.stopButton.append(icon('stop'), t('composer.stop'));
    this.attachButton.setAttribute('aria-label', t('composer.attach_label'));
    this.attachButton.append(icon('attach'));
    this.scroller.setAttribute('aria-label', t('conversation.transcript'));
    this.transcript.setAttribute('label', t('conversation.transcript'));
    this.transcript.labels = transcriptLabels(t);
    this.empty = ds('frontier-empty', {}, icon('chat'), h('h2', {}, t('conversation.empty_heading')), h('p', {}, t('conversation.empty')));
    this.composer = h('form', { 'aria-label': t('composer.form') },
      ds('frontier-card', { class: 'composer' },
        ds('frontier-stack', { gap: '2' },
          this.chips,
          this.textarea,
          ds('frontier-row', { gap: '2' }, this.choices, this.status, ds('frontier-spacer'), this.attachButton, this.fileInput, this.stopButton, this.sendButton),
        ),
      ),
      h('div', { class: 'below-composer' }, this.problem),
    );
    this.element = h('main', { class: 'main', 'aria-label': handle.title() },
      ds('frontier-stack', { fill: true, gap: '0' },
        ds('frontier-row', { class: 'conversation-header', padding: '4', gap: '3', align: 'start' },
          host.layout === 'compact' ? h('button', { type: 'button', 'data-variant': 'ghost', 'aria-label': t('conversation.back'), onclick: () => host.back() }, icon('back')) : null,
          ds('frontier-stack', { gap: '1', class: 'titles' }, this.titleElement, this.badges),
          this.controls,
          host.layout === 'wide' ? h('button', { type: 'button', 'data-variant': 'ghost', 'aria-label': t('list.new'), title: t('list.new_help'), onclick: () => host.newChat() }, icon('plus')) : null,
        ),
        this.notices,
        this.scroller,
        this.composer,
      ),
    );
    this.element.dataset.width = host.width();
    this.column.append(this.empty, this.transcript, this.jump);
    this.scroller.append(this.column);
    this.wire();
    this.drawPending();
    this.textarea.value = host.draft(handle.key);
    this.autosize();
    this.update(handle);
  }

  private wire(): void {
    this.composer.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.send();
    });
    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    });
    this.textarea.addEventListener('input', () => {
      this.autosize();
      this.host.saveDraft(this.handle.key, this.textarea.value);
    });
    this.textarea.addEventListener('paste', (event) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.length > 0) {
        event.preventDefault();
        void this.addFiles(files);
      }
    });
    this.composer.addEventListener('dragover', (event) => {
      event.preventDefault();
      this.composer.classList.add('dragging');
    });
    this.composer.addEventListener('dragleave', () => this.composer.classList.remove('dragging'));
    this.composer.addEventListener('drop', (event) => {
      event.preventDefault();
      this.composer.classList.remove('dragging');
      void this.addFiles([...(event.dataTransfer?.files ?? [])]);
    });
    this.attachButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', () => {
      void this.addFiles([...(this.fileInput.files ?? [])]);
      this.fileInput.value = '';
    });
    this.stopButton.addEventListener('click', () => void this.stop());
    this.jump.addEventListener('click', () => this.scrollToEnd());
    this.scroller.addEventListener('scroll', () => {
      this.stuck = this.nearEnd();
      this.jump.hidden = this.stuck;
    });
    // The transcript draws on the next frame: a view that followed the end keeps following it as it grows.
    new ResizeObserver(() => {
      if (this.stuck) this.scrollToEnd();
      else if (this.fed) this.jump.hidden = false;
    }).observe(this.transcript);
    this.transcript.addEventListener('frontier-copy', (event) => void this.host.copy((event as CustomEvent<{ text: string }>).detail.text));
    this.transcript.addEventListener('frontier-link', (event) => {
      window.open((event as CustomEvent<{ href: string }>).detail.href, '_blank', 'noopener,noreferrer');
    });
    this.transcript.addEventListener('frontier-command', (event) => {
      const name = (event as CustomEvent<{ name: string }>).detail.name;
      this.textarea.value = `/${name} ${this.textarea.value.replace(/^\/\S*\s*/, '')}`;
      this.autosize();
      this.textarea.focus();
    });
  }

  focus(): void {
    this.textarea.focus();
  }

  update(handle: ChatHandle): void {
    this.handle = handle;
    const session = handle.session();
    const active = session?.isActive() ?? false;
    if ((session?.id ?? null) !== this.boundSessionId) this.bind(session);
    // An agent that opens again, as after its worker restarts, can replay what it could not while closed.
    else if (session && active && !this.wasActive && (this.replayUnavailable || this.historyProblem !== null || this.replayDoubted)) void this.loadHistory(session);
    this.wasActive = active;
    this.drawHeader();
    this.drawNotices();
    this.drawComposer();
  }

  dispose(): void {
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.subscriptions = [];
    window.clearInterval(this.ticker);
    window.clearTimeout(this.reloadTimer);
  }

  private bind(session: Session | null): void {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.subscriptions = [];
    this.boundSessionId = session?.id ?? null;
    this.lastFinished = null;
    this.queued = null;
    if (!session) return;
    this.subscriptions.push(session.transcript.follow((event) => this.onEvent(event)));
    this.subscriptions.push(session.watchTurns((event) => this.onTurn(event)));
    void this.loadHistory(session);
  }

  private async loadHistory(session: Session): Promise<void> {
    const turnRunning = session.currentTurn() !== null;
    const history = await session.transcript.history();
    if (this.disposed || session.id !== this.boundSessionId) return;
    if (history.ok) {
      this.replayUnavailable = false;
      this.replayDoubted = false;
      this.historyProblem = null;
      this.transcript.replay(history.value);
      this.fed = history.value.length > 0;
      this.drawPending();
    } else if (history.unavailable && (turnRunning || session.currentTurn() !== null || !session.isActive() || !this.replayDoubted)) {
      // An agent cannot replay while it runs a turn, and a turn may run that this view has not heard start: what
      // streams in is shown, and history is asked for again when a turn ends or, failing that, in a few seconds.
      this.replayDoubted = true;
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(() => {
        const live = this.handle.session();
        if (live && live.isActive() && live.currentTurn() === null) void this.loadHistory(live);
      }, 5000);
    } else if (history.unavailable) {
      this.replayUnavailable = true;
    } else {
      this.historyProblem = history.message;
    }
    this.drawNotices();
    this.drawHeader();
  }

  private scheduleReload(): void {
    window.clearTimeout(this.reloadTimer);
    this.reloadTimer = window.setTimeout(() => {
      // Asked again even after an answer of no replay: that answer may have come while a turn ran that this view had not heard start.
      const session = this.handle.session();
      if (session) void this.loadHistory(session);
    }, 400);
  }

  private onEvent(event: TranscriptEvent): void {
    // The prompt drawn while the chat started is this turn: the agent's own turn_start is not drawn twice.
    if (event.type === 'turn_start' && this.shownPrompt !== null && event.userPrompt.trim() === this.shownPrompt.trim()) {
      this.shownPrompt = null;
      this.host.settled(this.handle.key);
    } else {
      this.transcript.apply(event);
      this.fed = true;
    }
    this.empty.hidden = true;
    if (event.type === 'done') this.scheduleReload();
  }

  private onTurn(event: TurnEvent): void {
    if (event.type === 'turn.finished') {
      this.lastFinished = event;
      if (this.queued?.turnId === event.turnId) this.queued = null;
      this.scheduleReload();
    }
    if (event.type === 'turn.started' && this.queued?.turnId === event.turnId) this.queued = null;
    this.drawComposer();
  }

  // A chat's first prompt shows at once, before the agent's transcript holds it; with nothing to show, the empty state.
  private drawPending(): void {
    const starting = this.handle.record?.starting?.prompt ?? null;
    const pending = this.host.pending(this.handle.key) ?? (starting === null ? null : promptText(starting));
    this.shownPrompt = null;
    if (pending !== null && this.fed) {
      // The history holds this prompt once the agent took it, and then it is the history's own turn.
      this.host.settled(this.handle.key);
    } else if (pending !== null) {
      this.shownPrompt = pending;
      this.transcript.apply({ type: 'turn_start', userPrompt: pending, turnId: null, timestamp: null });
    }
    this.empty.hidden = this.fed || this.shownPrompt !== null;
  }

  private nearEnd(): boolean {
    return this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight < 80;
  }

  private scrollToEnd(): void {
    this.scroller.scrollTop = this.scroller.scrollHeight;
    this.stuck = true;
    this.jump.hidden = true;
  }

  private autosize(): void {
    this.textarea.style.height = 'auto';
    this.textarea.style.height = `${this.textarea.scrollHeight}px`;
  }

  private drawHeader(): void {
    const t = this.host.t;
    const session = this.handle.session();
    this.titleElement.textContent = this.handle.title();
    this.element.setAttribute('aria-label', this.handle.title());
    this.metaElement.textContent = this.handle.meta();
    this.badges.replaceChildren(stateBadge(stateOf(session, this.handle.record, t)), this.metaElement);
    const width = this.host.width() === 'fill' ? 'width-column' : 'width-fill';
    const values = [this.handle.rename ? 'rename' : '', session ? 'release' : this.handle.resume ? 'resume' : '', width, this.handle.remove ? 'remove' : ''].filter(Boolean);
    // The menu is drawn again only when its items change, so a redraw never closes it under the person's pointer.
    if (values.join(' ') !== this.menuItems || this.menu === null) {
      this.menuItems = values.join(' ');
      this.menu = this.drawMenu(values);
      this.menuSlot.replaceChildren(...(this.menu ? [this.menu] : []));
    }
    this.drawChoices();
  }

  private drawMenu(values: string[]): HTMLElement | null {
    const t = this.host.t;
    const items: HTMLElement[] = [];
    const item = (value: string, label: string, tone?: string) => h('li', {}, h('button', { type: 'button', 'data-value': value, 'data-tone': tone }, label));
    for (const value of values) {
      if (value === 'remove') items.push(h('li', {}, h('hr')), item('remove', t('conversation.remove'), 'danger'));
      else if (value.startsWith('width-')) items.push(h('li', {}, h('hr')), item(value, t(`conversation.${value.replace('-', '_')}`)));
      else items.push(item(value, t(`conversation.${value}`)));
    }
    if (items[0]?.firstElementChild?.localName === 'hr') items.shift();
    if (items.length > 0) {
      const menu = ds('frontier-menu', {},
        h('button', { type: 'button', 'data-variant': 'ghost' }, t('conversation.more'), icon('down')),
        h('menu', {}, ...items),
      );
      menu.addEventListener('frontier-select', (event) => {
        const value = (event as CustomEvent<{ value: string }>).detail?.value;
        if (value === 'rename') void this.rename();
        else if (value === 'release') void this.release();
        else if (value === 'resume') void this.resume();
        else if (value === 'remove') void this.remove();
        else if (value === 'width-fill' || value === 'width-column') this.setWidth(value === 'width-fill' ? 'fill' : 'column');
      });
      return menu;
    }
    return null;
  }

  // The runtime, and the model and mode where the agent lets them change, sit in the composer's bar.
  private drawChoices(): void {
    const t = this.host.t;
    const session = this.handle.session();
    // Drawn again only when what it shows changes, so an open select is never replaced under the person.
    const signature = JSON.stringify([this.host.runtimeTitle(this.handle.runtimeId), session?.id ?? null, session?.model() ?? null, session?.modes() ?? null, this.handle.models()]);
    if (signature === this.choicesSignature) return;
    this.choicesSignature = signature;
    // The transcript names a mode by the name the agent gives it; a new list redraws it, so it is set only when it changes.
    const modes = JSON.stringify(session?.modes().available ?? []);
    if (modes !== this.modesSignature) {
      this.modesSignature = modes;
      this.transcript.modes = session?.modes().available ?? [];
    }
    const choices: HTMLElement[] = [ds('frontier-badge', { title: this.handle.meta() }, this.host.runtimeTitle(this.handle.runtimeId))];
    if (session) {
      const groups = this.handle.models();
      if (groups.length > 0) {
        const current = session.model();
        const select = h('select', {},
          h('option', { value: '', selected: current === null }, t('conversation.default_model')),
          ...groups.map((group) => h('optgroup', { label: group.label },
            ...group.versions.map((version) => h('option', { value: version.id, selected: current?.modelId === version.id }, version.label)))));
        select.addEventListener('change', async () => {
          if (select.value === '') return;
          const answer = await session.setModel({ modelId: select.value });
          this.reportAction(answer, t('conversation.model_unavailable'));
        });
        // A runtime may list many models: typing filters them by any words of the model's name, version or group.
        choices.push(ds('frontier-combobox', { label: t('conversation.model'), placeholder: t('conversation.find_model'), empty: t('conversation.no_model'), 'data-size': 'small', 'data-variant': 'ghost' }, select));
        const version = groups.flatMap((group) => group.versions).find((entry) => entry.id === current?.modelId);
        for (const setting of version?.settings ?? []) choices.push(this.settingControl(session, setting, current?.settings ?? {}));
      } else {
        const model = session.model();
        if (model) choices.push(ds('frontier-badge', {}, model.modelId));
      }
      const modes = session.modes();
      if (modes.available.length > 0) {
        const select = h('select', { 'aria-label': t('conversation.mode'), 'data-size': 'small', 'data-variant': 'ghost' },
          ...modes.available.map((mode) => h('option', { value: mode.id, selected: mode.id === modes.current, title: mode.description ?? undefined }, mode.name)));
        select.addEventListener('change', async () => {
          const answer = await session.setMode(select.value);
          this.reportAction(answer);
        });
        choices.push(select);
      }
    }
    this.choices.replaceChildren(...choices);
  }

  private settingControl(session: Session, field: Field, values: Record<string, string | number | boolean>): HTMLElement {
    const label = field.label;
    if (field.type !== 'select' || !Array.isArray(field.choices)) return h('span', {});
    const current = values[field.key] ?? field.default ?? '';
    const select = h('select', { 'aria-label': label, 'data-size': 'small', 'data-variant': 'ghost' },
      ...(field.choices as readonly { value: string; label?: string }[]).map((choice) => h('option', { value: choice.value, selected: choice.value === current }, choice.label ?? choice.value)));
    select.addEventListener('change', async () => {
      const model = session.model();
      if (!model) return;
      const answer = await session.setModel({ modelId: model.modelId, settings: { ...model.settings, [field.key]: select.value } });
      this.reportAction(answer, this.host.t('conversation.model_unavailable'));
    });
    return select;
  }

  private setWidth(width: Width): void {
    this.host.setWidth(width);
    this.element.dataset.width = width;
    this.drawHeader();
  }

  private reportAction(answer: Result<unknown>, unavailableText?: string): void {
    this.actionProblem = answer.ok ? null : answer.unavailable && unavailableText ? unavailableText : answer.message;
    this.drawNotices();
    if (answer.ok) this.drawHeader();
  }

  private drawNotices(): void {
    const t = this.host.t;
    const session = this.handle.session();
    const notices: Notice[] = [];
    if (!session && this.handle.record?.startFailure && !this.handle.record.starting) {
      notices.push({ tone: 'danger', title: t('notice.start_failed_title'), text: this.handle.record.startFailure, ...(this.handle.resume ? { action: { label: t('notice.try_again'), run: () => void this.resume() } } : {}) });
    } else if (!session && this.handle.record?.releasedAt && !this.handle.record.starting) {
      notices.push({ tone: 'info', title: t('notice.released_title'), text: t('notice.released'), ...(this.handle.resume ? { action: { label: t('conversation.resume'), run: () => void this.resume() } } : {}) });
    }
    if (session && !session.isActive()) notices.push({ tone: 'warning', title: t('notice.inactive_title'), text: session.inactiveReason() ?? t('notice.inactive') });
    if (this.replayUnavailable) notices.push({ tone: 'info', title: t('notice.no_replay_title'), text: t('notice.no_replay') });
    if (this.historyProblem) {
      notices.push({ tone: 'warning', title: t('notice.history_title'), text: this.historyProblem, action: { label: t('notice.try_again'), run: () => { const live = this.handle.session(); if (live) void this.loadHistory(live); } } });
    }
    if (this.actionProblem) notices.push({ tone: 'danger', title: t('notice.action_title'), text: this.actionProblem, action: { label: t('notice.dismiss'), run: () => { this.actionProblem = null; this.drawNotices(); } } });
    this.notices.replaceChildren(...notices.filter((notice): notice is NonNullable<Notice> => notice !== null).map((notice) => h('div', { role: notice.tone === 'danger' ? 'alert' : 'status', 'data-tone': notice.tone },
      h('p', {}, h('strong', {}, notice.title), notice.text),
      notice.action ? h('button', { type: 'button', 'data-size': 'small', onclick: notice.action.run }, notice.action.label) : null,
    )));
  }

  private drawComposer(): void {
    const t = this.host.t;
    const session = this.handle.session();
    this.badges.replaceChildren(stateBadge(stateOf(session, this.handle.record, t)), this.metaElement);
    const turn = session?.currentTurn() ?? null;
    const inactive = session !== null && !session.isActive();
    const starting = Boolean(this.handle.record?.starting);
    window.clearInterval(this.ticker);
    // What the composer says sits in its own bar, so the composer never moves as a turn starts and ends.
    const statusParts: (HTMLElement | string)[] = [];
    if (starting) {
      statusParts.push(t('composer.starting_hint'));
    } else if (inactive) {
      statusParts.push(t('composer.inactive_hint'));
    } else if (turn && turn.startedAt !== null) {
      const startedAt = turn.startedAt;
      const label = ds('frontier-badge', { 'data-tone': 'success', 'data-state': 'running' }, t('turn.running', { time: clock(Date.now() - startedAt) }));
      this.ticker = window.setInterval(() => (label.textContent = t('turn.running', { time: clock(Date.now() - startedAt) })), 1000);
      statusParts.push(label);
    } else if (turn) {
      statusParts.push(ds('frontier-badge', { 'data-tone': 'warning' }, t('turn.waiting')));
    } else if (this.lastFinished?.error) {
      statusParts.push(t('turn.failed_because', { error: this.lastFinished.error }));
    }
    if (session && !session.promptCapabilities().image && this.attachments.some((file) => file.type.startsWith('image/'))) statusParts.push(t('composer.no_images_hint'));
    if (this.queued) {
      const queued = this.queued;
      statusParts.push(ds('frontier-badge', { 'data-tone': 'warning', title: queued.text }, t('turn.queued')));
      statusParts.push(h('button', { type: 'button', 'data-variant': 'ghost', 'data-size': 'small', onclick: async () => {
        const live = this.handle.session();
        if (!live) return;
        const answer = await live.cancel(queued.turnId);
        if (answer.ok) {
          this.queued = null;
          if (this.textarea.value === '') this.textarea.value = queued.text;
        }
        this.reportAction(answer);
        this.drawComposer();
      } }, t('turn.cancel_queued')));
    }
    this.status.replaceChildren(...statusParts);
    this.stopButton.hidden = !turn;
    this.sendButton.disabled = this.sending || inactive || starting;
    this.sendButton.setAttribute('aria-busy', String(this.sending));
    this.sendButton.setAttribute('aria-label', turn ? t('composer.queue') : t('composer.send'));
    this.sendButton.title = turn ? t('composer.queue') : t('composer.send');
    this.chips.replaceChildren(...this.attachments.map((file, index) => h('span', { class: 'attachment' },
      `${file.name} · ${bytes(file.data.length, this.host.language)}`,
      h('button', { type: 'button', 'data-variant': 'ghost', 'data-size': 'small', 'aria-label': t('composer.remove_attachment', { name: file.name }), onclick: () => {
        this.attachments.splice(index, 1);
        this.drawComposer();
      } }, icon('delete')),
    )));
  }

  private async addFiles(files: File[]): Promise<void> {
    for (const file of files) this.attachments.push({ name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) });
    this.problem.textContent = '';
    this.drawComposer();
  }

  private async send(): Promise<void> {
    const t = this.host.t;
    const text = this.textarea.value.trim();
    if (this.sending || (text === '' && this.attachments.length === 0)) return;
    const capabilities = this.handle.session()?.promptCapabilities() ?? { image: true, audio: true, embeddedContext: true };
    const built = buildPrompt(text, this.attachments, capabilities);
    if (!built.ok) {
      this.problem.textContent = t('composer.refused', { kinds: built.kinds.map((kind) => t(`composer.kind_${kind}`)).join(', '), names: built.refused.join(', ') });
      return;
    }
    this.sending = true;
    this.problem.textContent = '';
    this.drawComposer();
    const answer = await this.handle.prompt(built.prompt);
    this.sending = false;
    if (answer.ok) {
      if (answer.value.queued && answer.value.turnId !== null) this.queued = { turnId: answer.value.turnId, text };
      this.textarea.value = '';
      this.attachments = [];
      this.host.saveDraft(this.handle.key, '');
      this.autosize();
      this.scrollToEnd();
    } else {
      this.problem.textContent = answer.message;
    }
    this.drawComposer();
  }

  private async stop(): Promise<void> {
    const session = this.handle.session();
    const turn = session?.currentTurn();
    if (!session || !turn) return;
    this.stopButton.disabled = true;
    const answer = await session.cancel(turn.turnId);
    this.stopButton.disabled = false;
    this.reportAction(answer);
  }

  private async release(): Promise<void> {
    this.reportAction(await this.handle.release());
  }

  private async resume(): Promise<void> {
    if (this.handle.resume) this.reportAction(await this.handle.resume());
  }

  private async rename(): Promise<void> {
    if (!this.handle.rename) return;
    const title = await this.host.promptName(this.host.t('conversation.rename_title'), this.handle.title());
    if (title === null || title.trim() === '') return;
    this.reportAction(await this.handle.rename(title.trim()));
  }

  private async remove(): Promise<void> {
    if (!this.handle.remove) return;
    const confirmed = await this.host.confirm(this.host.t('conversation.remove_title'), this.host.t('conversation.remove_message', { title: this.handle.title() }), this.host.t('conversation.remove_confirm'));
    if (confirmed) this.reportAction(await this.handle.remove());
  }
}
