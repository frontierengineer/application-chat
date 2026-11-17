import type {
  AvailableModelVersion,
  Field,
  Result,
  Session,
  Subscription,
  TranscriptEvent,
  TurnEvent,
  TurnFinishedEvent,
} from '../../../application';
import type { ChatPrompt, ChatRecord } from '../shared.ts';
import { type Attachment, buildPrompt } from './attachments.ts';
import { h } from './dom.ts';
import { bytes, clock, money, tokens } from './format.ts';
import { type RenderEnvironment, renderItem, stopReasonText } from './render-items.ts';
import { type Item, TranscriptModel } from './transcript-model.ts';

export interface ChatHandle {
  key: string;
  record: ChatRecord | null;
  title(): string;
  runtimeId: string;
  workerId: string;
  meta(): string;
  session(): Session | null;
  models(): { label: string; versions: AvailableModelVersion[] }[];
  prompt(prompt: ChatPrompt): Promise<Result<{ turnId: string; queued: boolean }>>;
  release(): Promise<Result>;
  resume: (() => Promise<Result>) | null;
  rename: ((title: string) => Promise<Result>) | null;
  remove: (() => Promise<Result>) | null;
}

export interface ConversationHost extends RenderEnvironment {
  layout: 'desktop' | 'panel';
  back(): void;
  draft(key: string): string;
  saveDraft(key: string, text: string): void;
  promptName(title: string, value: string): Promise<string | null>;
  confirm(title: string, message: string, label: string): Promise<boolean>;
}

type Notice = { tone: 'info' | 'warning' | 'danger'; title: string; text: string; action?: { label: string; run: () => void } } | null;

export class Conversation {
  readonly element: HTMLElement;
  private handle: ChatHandle;
  private readonly host: ConversationHost;
  private readonly model = new TranscriptModel();
  private readonly itemElements = new Map<string, HTMLElement>();
  private readonly dirty = new Set<Item>();
  private frame = 0;
  private subscriptions: Subscription[] = [];
  private boundSessionId: string | null = null;
  private replayUnavailable = false;
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
  private readonly metaElement = h('p', { class: 'meta' });
  private readonly controls = h('div', { class: 'controls' });
  private readonly notices = h('div', { role: 'status' });
  private readonly transcript = h('div', { class: 'transcript', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', tabindex: '0' });
  private readonly typing = h('div', { class: 'typing-row' });
  private readonly jump = h('button', { type: 'button', class: 'jump', 'data-variant': 'primary', hidden: true });
  private readonly textarea = h('textarea', { rows: '1' });
  private readonly chips = h('div', { class: 'chips' });
  private readonly status = h('span', { class: 'status', 'aria-live': 'polite' });
  private readonly sendButton = h('button', { type: 'submit', 'data-variant': 'primary' });
  private readonly stopButton = h('button', { type: 'button', 'data-variant': 'ghost', 'data-tone': 'danger' });
  private readonly attachButton = h('button', { type: 'button', 'data-variant': 'ghost' });
  private readonly fileInput = h('input', { type: 'file', multiple: true, class: 'visually-hidden', tabindex: '-1' });
  private readonly problem = h('p', { class: 'problem', role: 'alert' });
  private readonly hint = h('p', { class: 'hint' });
  private readonly composer: HTMLFormElement;

  constructor(host: ConversationHost, handle: ChatHandle) {
    this.host = host;
    this.handle = handle;
    const t = host.t;
    this.jump.textContent = t('conversation.jump');
    this.textarea.setAttribute('aria-label', t('composer.label'));
    this.textarea.placeholder = t('composer.placeholder');
    this.sendButton.textContent = t('composer.send');
    this.stopButton.textContent = t('composer.stop');
    this.attachButton.textContent = t('composer.attach');
    this.attachButton.setAttribute('aria-label', t('composer.attach_label'));
    this.composer = h('form', { class: 'composer', 'aria-label': t('composer.form') },
      h('div', { class: 'composer-box' },
        this.chips,
        this.textarea,
        h('div', { class: 'row' }, this.attachButton, this.fileInput, this.status, h('span', { class: 'spacer' }), this.stopButton, this.sendButton),
      ),
      this.problem,
      this.hint,
    );
    this.element = h('section', { class: 'main', 'aria-label': handle.title() },
      h('header', { class: 'conversation-header' },
        host.layout === 'panel' ? h('button', { type: 'button', 'data-variant': 'ghost', onclick: () => host.back() }, t('conversation.back')) : null,
        h('div', { class: 'titles' }, this.titleElement, this.metaElement),
        this.controls,
      ),
      this.notices,
      this.transcript,
      this.composer,
    );
    this.transcript.append(this.typing, this.jump);
    this.wire();
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
    this.transcript.addEventListener('scroll', () => {
      this.jump.hidden = this.nearEnd();
    });
  }

  focus(): void {
    this.textarea.focus();
  }

  update(handle: ChatHandle): void {
    this.handle = handle;
    const session = handle.session();
    if ((session?.id ?? null) !== this.boundSessionId) this.bind(session);
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
    cancelAnimationFrame(this.frame);
  }

  private bind(session: Session | null): void {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.subscriptions = [];
    this.boundSessionId = session?.id ?? null;
    this.lastFinished = null;
    this.queued = null;
    if (!session) {
      if (this.model.items.length === 0) this.drawAll();
      return;
    }
    this.subscriptions.push(session.transcript.follow((event) => this.onEvent(event)));
    this.subscriptions.push(session.watchTurns((event) => this.onTurn(event)));
    void this.loadHistory(session);
  }

  private async loadHistory(session: Session): Promise<void> {
    const history = await session.transcript.history();
    if (this.disposed || session.id !== this.boundSessionId) return;
    if (history.ok) {
      this.replayUnavailable = false;
      this.historyProblem = null;
      this.model.reset(history.value);
      this.drawAll();
      this.scrollToEnd();
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
      const session = this.handle.session();
      if (session && !this.replayUnavailable) void this.loadHistory(session);
    }, 400);
  }

  private onEvent(event: TranscriptEvent): void {
    const item = this.model.apply(event);
    if (item) this.markDirty(item);
    if (event.type === 'usage' || event.type === 'done') this.drawHeader();
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
    this.drawTyping();
  }

  private markDirty(item: Item): void {
    this.dirty.add(item);
    if (this.frame === 0) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        const stick = this.nearEnd();
        for (const dirty of this.dirty) this.drawItem(dirty);
        this.dirty.clear();
        this.drawTyping();
        if (stick) this.scrollToEnd();
        else this.jump.hidden = false;
      });
    }
  }

  private drawItem(item: Item): void {
    const existing = this.itemElements.get(item.key);
    const element = renderItem(item, this.host, existing);
    if (!existing) {
      this.itemElements.get('empty')?.remove();
      this.itemElements.delete('empty');
      this.itemElements.set(item.key, element);
      this.transcript.insertBefore(element, this.typing);
    }
  }

  private drawAll(): void {
    for (const element of this.itemElements.values()) element.remove();
    this.itemElements.clear();
    if (this.model.items.length === 0) {
      const empty = h('div', { class: 'empty' }, h('h2', {}, this.host.t('conversation.empty_heading')), h('p', {}, this.host.t('conversation.empty')));
      this.itemElements.set('empty', empty);
      this.transcript.insertBefore(empty, this.typing);
    }
    for (const item of this.model.items) this.drawItem(item);
    this.drawTyping();
  }

  private drawTyping(): void {
    const turn = this.handle.session()?.currentTurn() ?? null;
    const last = this.model.items[this.model.items.length - 1];
    const streaming = last && (last.kind === 'text' || last.kind === 'thinking') && last.partial;
    if (turn && turn.startedAt !== null && !streaming) {
      this.typing.replaceChildren(h('span', { class: 'typing' }, h('span', {}), h('span', {}), h('span', {}), ` ${this.host.t('conversation.working')}`));
    } else {
      this.typing.replaceChildren();
    }
  }

  private nearEnd(): boolean {
    return this.transcript.scrollHeight - this.transcript.scrollTop - this.transcript.clientHeight < 80;
  }

  private scrollToEnd(): void {
    this.transcript.scrollTop = this.transcript.scrollHeight;
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
    this.metaElement.textContent = this.handle.meta();
    const controls: HTMLElement[] = [];
    if (session) {
      const modes = session.modes();
      if (modes.available.length > 0) {
        const select = h('select', { 'aria-label': t('conversation.mode') },
          ...modes.available.map((mode) => h('option', { value: mode.id, selected: mode.id === modes.current, title: mode.description ?? undefined }, mode.name)));
        select.addEventListener('change', async () => {
          const answer = await session.setMode(select.value);
          this.reportAction(answer);
        });
        controls.push(h('label', { class: 'inline' }, t('conversation.mode'), select));
      }
      const groups = this.handle.models();
      if (groups.length > 0) {
        const current = session.model();
        const select = h('select', { 'aria-label': t('conversation.model') },
          h('option', { value: '', selected: current === null }, t('conversation.default_model')),
          ...groups.map((group) => h('optgroup', { label: group.label },
            ...group.versions.map((version) => h('option', { value: version.id, selected: current?.modelId === version.id }, version.label)))));
        select.addEventListener('change', async () => {
          if (select.value === '') return;
          const answer = await session.setModel({ modelId: select.value });
          this.reportAction(answer, t('conversation.model_unavailable'));
        });
        controls.push(h('label', { class: 'inline' }, t('conversation.model'), select));
        const version = groups.flatMap((group) => group.versions).find((entry) => entry.id === current?.modelId);
        for (const setting of version?.settings ?? []) controls.push(this.settingControl(session, setting, current?.settings ?? {}));
      }
    }
    const usage = this.model.usage;
    if (usage && usage.contextWindow > 0) {
      const share = Math.min(1, usage.contextUsed / usage.contextWindow);
      const label = t('conversation.context', { used: tokens(usage.contextUsed, this.host.language), window: tokens(usage.contextWindow, this.host.language) });
      controls.push(h('span', { class: 'usage', title: label },
        h('meter', { min: '0', max: '1', low: '0.7', high: '0.9', optimum: '0', value: String(share), 'aria-label': label }),
        `${Math.round(share * 100)}%`,
        usage.costAmount !== null && usage.costCurrency ? ` · ${money(usage.costAmount, usage.costCurrency, this.host.language)}` : '',
      ));
    }
    const actions: HTMLElement[] = [];
    if (this.handle.rename) actions.push(h('button', { type: 'button', 'data-variant': 'ghost', onclick: () => void this.rename() }, t('conversation.rename')));
    if (session) actions.push(h('button', { type: 'button', 'data-variant': 'ghost', onclick: () => void this.release() }, t('conversation.release')));
    else if (this.handle.resume) actions.push(h('button', { type: 'button', 'data-variant': 'ghost', onclick: () => void this.resume() }, t('conversation.resume')));
    if (this.handle.remove) actions.push(h('button', { type: 'button', 'data-variant': 'ghost', 'data-tone': 'danger', onclick: () => void this.remove() }, t('conversation.remove')));
    if (this.host.layout === 'panel' && actions.length > 0) {
      const more = h('details', { class: 'more' }, h('summary', {}, t('conversation.more')), h('div', { class: 'menu' }, ...actions));
      for (const action of actions) action.addEventListener('click', () => (more.open = false));
      controls.push(more);
    } else {
      controls.push(...actions);
    }
    this.controls.replaceChildren(...controls);
  }

  private settingControl(session: Session, field: Field, values: Record<string, string | number | boolean>): HTMLElement {
    const label = field.label;
    if (field.type !== 'select' || !Array.isArray(field.choices)) return h('span', {});
    const current = values[field.key] ?? field.default ?? '';
    const select = h('select', { 'aria-label': label },
      ...(field.choices as readonly { value: string; label?: string }[]).map((choice) => h('option', { value: choice.value, selected: choice.value === current }, choice.label ?? choice.value)));
    select.addEventListener('change', async () => {
      const model = session.model();
      if (!model) return;
      const answer = await session.setModel({ modelId: model.modelId, settings: { ...model.settings, [field.key]: select.value } });
      this.reportAction(answer, this.host.t('conversation.model_unavailable'));
    });
    return h('label', { class: 'inline' }, label, select);
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
    if (!session && this.handle.record?.releasedAt) {
      notices.push({ tone: 'info', title: t('notice.released_title'), text: t('notice.released'), ...(this.handle.resume ? { action: { label: t('conversation.resume'), run: () => void this.resume() } } : {}) });
    }
    if (session && !session.isActive()) notices.push({ tone: 'warning', title: t('notice.inactive_title'), text: session.inactiveReason() ?? t('notice.inactive') });
    if (this.replayUnavailable) notices.push({ tone: 'info', title: t('notice.no_replay_title'), text: t('notice.no_replay') });
    if (this.historyProblem) {
      notices.push({ tone: 'warning', title: t('notice.history_title'), text: this.historyProblem, action: { label: t('notice.try_again'), run: () => { const live = this.handle.session(); if (live) void this.loadHistory(live); } } });
    }
    if (this.actionProblem) notices.push({ tone: 'danger', title: t('notice.action_title'), text: this.actionProblem, action: { label: t('notice.dismiss'), run: () => { this.actionProblem = null; this.drawNotices(); } } });
    this.notices.replaceChildren(...notices.filter((notice): notice is NonNullable<Notice> => notice !== null).map((notice) => h('div', { class: 'notice', 'data-tone': notice.tone },
      h('p', {}, h('strong', {}, notice.title), notice.text),
      notice.action ? h('button', { type: 'button', onclick: notice.action.run }, notice.action.label) : null,
    )));
  }

  private drawComposer(): void {
    const t = this.host.t;
    const session = this.handle.session();
    const turn = session?.currentTurn() ?? null;
    window.clearInterval(this.ticker);
    const statusParts: (HTMLElement | string)[] = [];
    if (turn && turn.startedAt !== null) {
      const startedAt = turn.startedAt;
      const label = h('span', { class: 'state', 'data-state': 'running' }, t('turn.running', { time: clock(Date.now() - startedAt) }));
      this.ticker = window.setInterval(() => (label.textContent = t('turn.running', { time: clock(Date.now() - startedAt) })), 1000);
      statusParts.push(label);
    } else if (turn) {
      statusParts.push(h('span', { class: 'state', 'data-state': 'queued' }, t('turn.waiting')));
    } else if (this.lastFinished) {
      statusParts.push(this.lastFinished.error ? t('turn.failed_because', { error: this.lastFinished.error }) : stopReasonText(this.lastFinished.stopReason, this.host));
    }
    if (this.queued) {
      const queued = this.queued;
      statusParts.push(h('span', { class: 'state', 'data-state': 'queued', title: queued.text }, t('turn.queued')));
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
    const inactive = session !== null && !session.isActive();
    this.sendButton.disabled = this.sending || inactive;
    this.sendButton.setAttribute('aria-busy', String(this.sending));
    this.sendButton.textContent = turn ? t('composer.queue') : t('composer.send');
    this.hint.textContent = inactive
      ? t('composer.inactive_hint')
      : session && !this.handle.session()?.promptCapabilities().image && this.attachments.some((file) => file.type.startsWith('image/'))
        ? t('composer.no_images_hint')
        : turn ? t('composer.queue_hint') : '';
    this.chips.replaceChildren(...this.attachments.map((file, index) => h('span', { class: 'attachment' },
      `${file.name} · ${bytes(file.data.length, this.host.language)}`,
      h('button', { type: 'button', 'data-variant': 'ghost', 'data-size': 'small', 'aria-label': t('composer.remove_attachment', { name: file.name }), onclick: () => {
        this.attachments.splice(index, 1);
        this.drawComposer();
      } }, '×'),
    )));
    this.drawTyping();
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
      if (answer.value.queued) this.queued = { turnId: answer.value.turnId, text };
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
