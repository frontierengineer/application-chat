import type {
  AgentDefinitionSummary,
  AvailableModelVersion,
  Field,
  FieldValues,
  PersonaSummary,
  Runtime,
  SurfaceContext,
  Worker,
  Workspace,
  WorkspaceProvisioner,
} from '../../../application';
import { type CreateChatInput, type CreateChatOutput, applicationId } from '../shared.ts';
import { ds, fill, h, icon } from './dom.ts';
import type { RenderEnvironment } from './render-items.ts';

export interface NewChatDefaults {
  runtimeId?: string;
  workerId?: string;
}

export interface NewChatHost extends RenderEnvironment {
  context: SurfaceContext;
  layout: 'desktop' | 'panel';
  defaults(): NewChatDefaults;
  saveDefaults(defaults: NewChatDefaults): void;
  created(chatId: string, prompt: string): void;
  // The runtimes as this form last listed them, so the list beside it names them too.
  runtimesListed(runtimes: Runtime[]): void;
  cancel: (() => void) | null;
}

interface Data {
  runtimes: Runtime[];
  workers: Worker[];
  workspaces: Workspace[];
  provisioners: WorkspaceProvisioner[];
  definitions: AgentDefinitionSummary[];
  personas: PersonaSummary[];
}

function settingInput(field: Field, value: string | number | boolean | undefined): HTMLElement {
  if (field.type === 'select' && Array.isArray(field.choices)) {
    return h('select', { name: field.key },
      ...(field.choices as readonly { value: string; label?: string }[]).map((choice) => h('option', { value: choice.value, selected: choice.value === (value ?? field.default) }, choice.label ?? choice.value)));
  }
  if (field.type === 'boolean') return h('input', { type: 'checkbox', name: field.key, checked: Boolean(value ?? field.default) });
  if (field.type === 'number') return h('input', { type: 'number', name: field.key, value: String(value ?? field.default ?? '') });
  return h('input', { type: 'text', name: field.key, value: String(value ?? field.default ?? '') });
}

let fieldCounter = 0;

function field(label: string, control: HTMLElement, help?: string | null): HTMLElement {
  fieldCounter += 1;
  const id = control.id || `field-${fieldCounter}`;
  control.id = id;
  const helpElement = help ? h('small', { id: `${id}-help` }, help) : null;
  if (helpElement) control.setAttribute('aria-describedby', helpElement.id);
  else control.removeAttribute('aria-describedby');
  return h('div', { class: 'field' }, h('label', { for: id }, label), control, helpElement);
}

export class NewChatForm {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly host: NewChatHost;
  private data: Data = { runtimes: [], workers: [], workspaces: [], provisioners: [], definitions: [], personas: [] };
  private runtimeId = '';
  private workerId = '';
  private modelId = '';
  private settings: FieldValues = {};
  private workspaceMode: 'none' | 'existing' | 'new' = 'none';
  private busy = false;
  private readonly prompt = h('textarea', { name: 'prompt', rows: '5' });
  private readonly title = h('input', { type: 'text', name: 'title' });
  private readonly readiness = h('div', { class: 'message', 'data-tone': 'warning', role: 'status' });
  private readonly problem = h('div', { class: 'message', 'data-tone': 'danger', role: 'alert' });
  private readonly summaryText = h('span', { class: 'summary-text' });
  private readonly options = h('details', { class: 'options' });
  private readonly optionsBody = h('div', { class: 'grid' });
  private readonly workspaceBody = h('fieldset', {});
  private readonly start = h('button', { type: 'submit', 'data-variant': 'primary' });
  private readonly form: HTMLFormElement;
  private readonly existingWorkspace = h('select', { name: 'workspace' });
  private readonly provisioner = h('select', { name: 'provisioner' });
  private readonly workspaceName = h('input', { type: 'text', name: 'workspaceName' });
  private readonly workspaceBase = h('input', { type: 'text', name: 'workspaceBase' });
  private readonly definition = h('select', { name: 'agentDefinition' });
  private readonly persona = h('select', { name: 'persona' });

  constructor(host: NewChatHost) {
    this.host = host;
    const t = host.t;
    this.prompt.placeholder = t('new.prompt_placeholder');
    this.title.placeholder = t('new.title_placeholder');
    this.workspaceName.placeholder = t('new.workspace_name_placeholder');
    this.workspaceBase.placeholder = t('new.workspace_base_placeholder');
    this.start.textContent = t('new.start');
    this.options.append(h('summary', {}, h('strong', {}, t('new.options')), this.summaryText), this.optionsBody, this.workspaceBody);
    this.form = h('form', { 'aria-labelledby': 'new-chat-heading' },
      h('h2', { id: 'new-chat-heading' }, t('new.heading')),
      h('p', { class: 'lead' }, t('new.lead')),
      field(t('new.prompt'), this.prompt),
      this.readiness,
      this.options,
      this.problem,
      ds('frontier-row', { justify: 'end' },
        host.cancel ? h('button', { type: 'button', 'data-variant': 'ghost', onclick: () => host.cancel?.() }, t('new.cancel')) : null,
        this.start,
      ),
    );
    this.body = ds('frontier-scroll', {}, this.form);
    this.element = h('main', { class: 'main new-chat' }, ds('frontier-stack', { fill: true, gap: '0' }, this.body));
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.submit();
      }
    });
    this.form.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && host.cancel) {
        event.preventDefault();
        host.cancel();
      }
    });
    void this.load();
  }

  focus(): void {
    this.prompt.focus();
  }

  async load(): Promise<void> {
    const context = this.host.context;
    const [runtimes, workers, workspaces, provisioners, definitions, personas] = await Promise.all([
      context.runtimes.list(),
      context.workers.list(),
      context.workspaces.list(),
      context.workspaces.workspaceProvisioners.list(),
      context.agentDefinitions.list(),
      context.personas.list(),
    ]);
    this.data = {
      runtimes: runtimes.ok ? runtimes.value : [],
      workers: workers.ok ? workers.value : [],
      workspaces: workspaces.ok ? workspaces.value : [],
      provisioners: provisioners.ok ? provisioners.value : [],
      definitions: definitions.ok ? definitions.value : [],
      personas: personas.ok ? personas.value : [],
    };
    if (runtimes.ok) this.host.runtimesListed(runtimes.value);
    const failed = [runtimes, workers].find((answer) => !answer.ok);
    this.problem.textContent = failed && !failed.ok ? failed.message : '';
    this.chooseDefaults();
    this.draw();
  }

  private readyOn(runtime: Runtime, workerId: string): boolean {
    return runtime.on(workerId)?.ready ?? false;
  }

  private chooseDefaults(): void {
    const saved = this.host.defaults();
    const connected = this.data.workers.filter((worker) => worker.isConnected());
    const known = (id: string | undefined, list: readonly { id: string }[]) => (id && list.some((item) => item.id === id) ? id : '');
    const runtimeId = known(this.runtimeId, this.data.runtimes) || known(saved.runtimeId, this.data.runtimes);
    const workerId = known(this.workerId, this.data.workers) || known(saved.workerId, this.data.workers);
    const ready = (runtime: Runtime, worker: Worker) => worker.isConnected() && this.readyOn(runtime, worker.id);
    const remembered = this.data.runtimes.find((runtime) => runtime.id === runtimeId);
    const rememberedWorker = this.data.workers.find((worker) => worker.id === workerId);
    if (remembered && rememberedWorker && ready(remembered, rememberedWorker)) {
      this.runtimeId = remembered.id;
      this.workerId = rememberedWorker.id;
      return;
    }
    const order = remembered ? [remembered, ...this.data.runtimes.filter((runtime) => runtime !== remembered)] : this.data.runtimes;
    const workers = rememberedWorker ? [rememberedWorker, ...connected.filter((worker) => worker !== rememberedWorker)] : connected;
    for (const runtime of order) {
      const worker = workers.find((candidate) => ready(runtime, candidate));
      if (worker) {
        this.runtimeId = runtime.id;
        this.workerId = worker.id;
        return;
      }
    }
    this.runtimeId = runtimeId || this.data.runtimes[0]?.id || '';
    this.workerId = workerId || connected[0]?.id || this.data.workers[0]?.id || '';
  }

  private runtime(): Runtime | null {
    return this.data.runtimes.find((runtime) => runtime.id === this.runtimeId) ?? null;
  }

  private worker(): Worker | null {
    return this.data.workers.find((worker) => worker.id === this.workerId) ?? null;
  }

  private versions(): { label: string; versions: AvailableModelVersion[] }[] {
    return this.runtime()?.on(this.workerId)?.models ?? [];
  }

  private draw(): void {
    const t = this.host.t;
    if (this.data.runtimes.length === 0 || this.data.workers.length === 0) {
      const runtimesMissing = this.data.runtimes.length === 0;
      this.body.replaceChildren(ds('frontier-stack', { fill: true, justify: 'center' }, ds('frontier-empty', {},
        icon('chat'),
        h('h2', {}, t(runtimesMissing ? 'new.no_runtimes_heading' : 'new.no_workers_heading')),
        h('p', {}, t(runtimesMissing ? 'new.no_runtimes' : 'new.no_workers')),
        h('button', { type: 'button', 'data-variant': 'primary', onclick: () => void this.load() }, t('new.check_again')),
      )));
      return;
    }
    if (!this.body.contains(this.form)) this.body.replaceChildren(this.form);
    const runtime = this.runtime();
    const worker = this.worker();
    const report = runtime?.on(this.workerId) ?? null;
    const runtimeSelect = h('select', { name: 'runtime' },
      ...this.data.runtimes.map((entry) => {
        const state = entry.on(this.workerId);
        const suffix = state === null ? t('new.state_unknown') : state.ready ? t('new.state_ready') : t('new.state_not_ready');
        return h('option', { value: entry.id, selected: entry.id === this.runtimeId }, `${entry.title} · ${suffix}`);
      }));
    runtimeSelect.addEventListener('change', () => {
      this.runtimeId = runtimeSelect.value;
      this.modelId = '';
      this.settings = {};
      this.draw();
    });
    const workerSelect = h('select', { name: 'worker' },
      ...this.data.workers.map((entry) => h('option', { value: entry.id, selected: entry.id === this.workerId },
        entry.isConnected() ? entry.title() : t('new.worker_offline', { worker: entry.title() }))));
    workerSelect.addEventListener('change', () => {
      this.workerId = workerSelect.value;
      this.modelId = '';
      this.settings = {};
      this.draw();
    });
    const groups = this.versions();
    const modelSelect = h('select', { name: 'model' },
      h('option', { value: '', selected: this.modelId === '' }, t('new.default_model')),
      ...groups.map((group) => h('optgroup', { label: group.label },
        ...group.versions.map((version) => h('option', { value: version.id, selected: version.id === this.modelId }, version.label)))));
    modelSelect.addEventListener('change', () => {
      this.modelId = modelSelect.value;
      this.settings = {};
      this.draw();
    });
    const version = groups.flatMap((group) => group.versions).find((entry) => entry.id === this.modelId);
    const settingFields = (version?.settings ?? []).map((setting) => {
      const input = settingInput(setting, this.settings[setting.key]);
      input.addEventListener('change', () => {
        const target = input as HTMLInputElement | HTMLSelectElement;
        this.settings[setting.key] = target instanceof HTMLInputElement && target.type === 'checkbox' ? target.checked : target instanceof HTMLInputElement && target.type === 'number' ? Number(target.value) : target.value;
      });
      // A Runtime's own words about its setting are not shown: the label names it.
      return field(setting.label, input);
    });
    this.definition.replaceChildren(
      h('option', { value: '' }, t('new.default_definition')),
      ...this.data.definitions.filter((entry) => entry.id !== 'default').map((entry) => h('option', { value: entry.id }, entry.title)));
    this.persona.replaceChildren(
      h('option', { value: '' }, t('new.no_persona')),
      ...this.data.personas.map((entry) => h('option', { value: entry.id }, entry.title)));
    this.optionsBody.replaceChildren(
      field(t('new.runtime'), runtimeSelect),
      field(t('new.worker'), workerSelect),
      field(t('new.model'), modelSelect, groups.length === 0 ? t('new.no_models') : null),
      ...settingFields,
      field(t('new.definition'), this.definition),
      field(t('new.persona'), this.persona),
      field(t('new.title'), this.title),
    );
    this.drawWorkspace();
    const ready = report?.ready ?? false;
    this.readiness.replaceChildren();
    if (runtime && worker && !worker.isConnected()) {
      this.readiness.append(t('new.worker_disconnected', { worker: worker.title() }));
    } else if (runtime && worker && report && !report.ready) {
      this.readiness.append(t('new.not_ready', { runtime: runtime.title, worker: worker.title(), reason: report.reason ?? '' }));
    } else if (runtime && worker && !report) {
      this.readiness.append(t('new.not_reported', { runtime: runtime.title, worker: worker.title() }));
    }
    if (!ready) this.options.open = true;
    this.summaryText.textContent = t('new.summary', {
      runtime: runtime?.title ?? '',
      worker: worker?.title() ?? '',
      model: version?.label ?? t('new.default_model'),
      workspace: this.workspaceMode === 'none' ? t('new.no_workspace') : this.workspaceMode === 'existing' ? t('new.existing_workspace') : t('new.new_workspace'),
    });
    this.start.disabled = this.busy || !ready || !worker?.isConnected();
    this.start.setAttribute('aria-busy', String(this.busy));
  }

  private drawWorkspace(): void {
    const t = this.host.t;
    const workspaces = this.data.workspaces.filter((workspace) => workspace.workerId === this.workerId);
    const provisioners = this.data.provisioners.filter((provisioner) => provisioner.workerId === this.workerId);
    const provisionerTitle = (id: string) => this.data.provisioners.find((provisioner) => provisioner.id === id)?.title ?? '';
    this.existingWorkspace.replaceChildren(...workspaces.map((workspace) => h('option', { value: workspace.id },
      `${workspace.name} · ${provisionerTitle(workspace.workspaceProvisionerId)}${workspace.isMounted() ? ` · ${t('new.mounted')}` : ''}`)));
    this.provisioner.replaceChildren(...provisioners.map((provisioner) => {
      const slots = provisioner.slots();
      const free = slots.available === null ? t('new.slots_unbounded') : t('new.slots_free', { free: slots.available, total: slots.total });
      return h('option', { value: provisioner.id, disabled: slots.available === 0 }, `${provisioner.title} · ${free}`);
    }));
    const radio = (mode: 'none' | 'existing' | 'new', label: string, disabled: boolean) => {
      const input = h('input', { type: 'radio', name: 'workspaceMode', value: mode, checked: this.workspaceMode === mode, disabled });
      input.addEventListener('change', () => {
        this.workspaceMode = mode;
        this.draw();
      });
      return h('label', {}, input, ` ${label}`);
    };
    if (this.workspaceMode === 'existing' && workspaces.length === 0) this.workspaceMode = 'none';
    if (this.workspaceMode === 'new' && provisioners.length === 0) this.workspaceMode = 'none';
    fill(this.workspaceBody,
      h('legend', {}, t('new.workspace')),
      h('div', { class: 'choices' },
        radio('none', t('new.no_workspace'), false),
        radio('existing', t('new.existing_workspace'), workspaces.length === 0),
        radio('new', t('new.new_workspace'), provisioners.length === 0),
      ),
      this.workspaceMode === 'existing' ? field(t('new.workspace'), this.existingWorkspace) : null,
      this.workspaceMode === 'new' ? h('div', { class: 'grid' },
        field(t('new.provisioner'), this.provisioner),
        field(t('new.workspace_name'), this.workspaceName, t('new.workspace_name_help')),
        field(t('new.workspace_base'), this.workspaceBase, t('new.workspace_base_help')),
      ) : null,
      provisioners.length === 0 && workspaces.length === 0 ? h('small', {}, t('new.no_provisioners')) : null,
    );
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const t = this.host.t;
    if (this.prompt.value.trim() === '') {
      this.problem.textContent = t('new.prompt_required');
      this.prompt.focus();
      return;
    }
    const prompt = this.prompt.value;
    const input: CreateChatInput = { runtimeId: this.runtimeId, workerId: this.workerId, prompt, wait: false };
    if (this.title.value.trim() !== '') input.title = this.title.value.trim();
    if (this.modelId !== '') input.model = { modelId: this.modelId, settings: this.settings };
    if (this.definition.value !== '') input.agentDefinitionId = this.definition.value;
    if (this.persona.value !== '') input.personaId = this.persona.value;
    if (this.workspaceMode === 'existing' && this.existingWorkspace.value !== '') input.workspace = { workspaceId: this.existingWorkspace.value };
    if (this.workspaceMode === 'new' && this.provisioner.value !== '') {
      input.workspace = {
        workspaceProvisionerId: this.provisioner.value,
        ...(this.workspaceName.value.trim() ? { name: this.workspaceName.value.trim() } : {}),
        ...(this.workspaceBase.value.trim() ? { base: this.workspaceBase.value.trim() } : {}),
      };
    }
    this.busy = true;
    this.problem.textContent = '';
    this.draw();
    const answer = await this.host.context.methods.call<CreateChatOutput>(applicationId, 'create-chat', input as unknown as Record<string, unknown>);
    this.busy = false;
    if (answer.ok) {
      this.host.saveDefaults({ runtimeId: this.runtimeId, workerId: this.workerId });
      this.prompt.value = '';
      this.title.value = '';
      this.host.created(answer.value.chatId, prompt);
    } else {
      this.problem.textContent = answer.message;
    }
    this.draw();
  }
}
