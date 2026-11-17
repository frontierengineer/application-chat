import type { AttachmentPart, ToolContentPart, ToolKind } from '../../../application';
import { fill, h } from './dom.ts';
import { bytes, tokens } from './format.ts';
import { renderMarkdown } from './markdown.ts';
import { type Item, trimDiff } from './transcript-model.ts';

export interface RenderEnvironment {
  t(token: string, values?: Record<string, string | number>): string;
  language: string;
  copy(text: string): Promise<boolean>;
}

const glyphs: Record<ToolKind, string> = {
  read: '◱',
  edit: '✎',
  delete: '⌫',
  move: '⇄',
  search: '⌕',
  execute: '›_',
  think: '◌',
  fetch: '↓',
  switch_mode: '↻',
  other: '•',
};

function blobUrl(data: Uint8Array, mimeType: string): string {
  return URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
}

export function attachmentElement(part: AttachmentPart, environment: RenderEnvironment): HTMLElement {
  switch (part.type) {
    case 'image':
      return h('span', { class: 'attachment' }, h('img', { src: part.uri && /^https?:/.test(part.uri) ? part.uri : blobUrl(part.data, part.mimeType), alt: environment.t('transcript.image') }));
    case 'audio':
      return h('span', { class: 'attachment' }, h('audio', { controls: true, src: blobUrl(part.data, part.mimeType) }));
    case 'resource_link':
      return h('span', { class: 'attachment' }, /^https?:/.test(part.uri) ? h('a', { href: part.uri, target: '_blank', rel: 'noopener noreferrer' }, part.name) : `${part.name}`);
    case 'resource_blob':
      return h('span', { class: 'attachment' }, `${part.uri.split('/').pop() ?? part.uri} · ${bytes(part.blob.length, environment.language)}`);
  }
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function summaryOf(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input.split('\n')[0] ?? '';
  if (typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description']) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value.split('\n')[0] ?? '';
    }
  }
  return stringify(input).replace(/\s+/g, ' ').slice(0, 120);
}

function contentPart(part: ToolContentPart, environment: RenderEnvironment): HTMLElement {
  switch (part.type) {
    case 'diff':
      return h('div', { class: 'diff', role: 'group', 'aria-label': environment.t(part.oldText === null ? 'transcript.new_file' : 'transcript.edited_file', { path: part.path }) },
        h('div', { class: 'path' }, `${environment.t(part.oldText === null ? 'transcript.new_file' : 'transcript.edited_file', { path: part.path })}`),
        ...trimDiff(part.oldText, part.newText).map((line) => h('div', { class: 'line', 'data-sign': line.sign }, line.sign === '…' ? '…' : `${line.sign} ${line.line}`)),
      );
    case 'terminal':
      return h('p', {}, environment.t('transcript.terminal', { id: part.terminalId }));
    case 'text':
      return h('pre', {}, part.text);
    case 'resource_text':
      return h('pre', { 'aria-label': part.uri }, part.text);
    default:
      return attachmentElement(part, environment);
  }
}

function addCopyButtons(container: HTMLElement, environment: RenderEnvironment): void {
  for (const pre of container.querySelectorAll('pre')) {
    const button = h('button', { type: 'button', class: 'copy', 'data-size': 'small' }, environment.t('transcript.copy_code'));
    button.addEventListener('click', async () => {
      const copied = await environment.copy(pre.querySelector('code')?.textContent ?? pre.textContent ?? '');
      button.textContent = environment.t(copied ? 'transcript.copied' : 'transcript.copy_failed');
      window.setTimeout(() => (button.textContent = environment.t('transcript.copy_code')), 2000);
    });
    pre.append(button);
  }
}

function typing(label: string): HTMLElement {
  return h('span', { class: 'typing', role: 'status' }, h('span', {}), h('span', {}), h('span', {}), h('span', { class: 'visually-hidden' }, label));
}

export function stopReasonText(reason: string | null, environment: RenderEnvironment): string {
  switch (reason) {
    case 'end_turn': return environment.t('turn.end_turn');
    case 'cancelled': return environment.t('turn.cancelled');
    case 'max_tokens': return environment.t('turn.max_tokens');
    case 'max_turn_requests': return environment.t('turn.max_turn_requests');
    case 'refusal': return environment.t('turn.refusal');
    default: return environment.t('turn.failed');
  }
}

export function renderItem(item: Item, environment: RenderEnvironment, existing?: HTMLElement): HTMLElement {
  switch (item.kind) {
    case 'user': {
      const element = existing ?? h('div', { class: 'message-user' });
      fill(element,
        h('span', { class: 'visually-hidden' }, environment.t('transcript.you_said')),
        item.text,
        item.attachments.length > 0 ? h('div', { class: 'attachments' }, ...item.attachments.map((part) => attachmentElement(part, environment))) : null,
      );
      return element;
    }
    case 'text': {
      const element = existing ?? h('div', { class: 'message-agent' });
      if (item.text === '' && item.partial) {
        element.replaceChildren(typing(environment.t('transcript.responding')));
      } else {
        element.replaceChildren(renderMarkdown(item.text));
        if (!item.partial) addCopyButtons(element, environment);
      }
      element.setAttribute('aria-busy', String(item.partial));
      return element;
    }
    case 'thinking': {
      const element = (existing as HTMLDetailsElement | undefined) ?? h('details', { class: 'thinking' }, h('summary', {}), h('div', { class: 'body' }));
      const summary = element.querySelector('summary')!;
      summary.replaceChildren(item.partial ? typing(environment.t('transcript.thinking')) : environment.t('transcript.thought'), item.partial ? environment.t('transcript.thinking') : '');
      element.querySelector('.body')!.textContent = item.text;
      return element;
    }
    case 'tool': {
      const element = (existing as HTMLDetailsElement | undefined) ?? h('details', { class: 'tool' }, h('summary', {}), h('div', { class: 'body' }));
      const statusText = environment.t(`tool.${item.status}`);
      element.querySelector('summary')!.replaceChildren(
        h('span', { class: 'glyph', 'aria-hidden': 'true' }, glyphs[item.toolKind] ?? '•'),
        h('span', { class: 'name' }, item.name),
        h('span', { class: 'summary-input' }, item.locations[0]?.path ?? summaryOf(item.input)),
        h('span', { class: 'tool-state', 'data-status': item.status }, statusText),
      );
      const body = element.querySelector('.body')!;
      const parts: (HTMLElement | null)[] = [];
      if (item.locations.length > 0) {
        parts.push(h('h3', {}, environment.t('tool.locations')));
        parts.push(h('ul', {}, ...item.locations.map((location) => h('li', {}, h('code', {}, location.line === null ? location.path : `${location.path}:${location.line}`)))));
      }
      if (item.input !== null && item.input !== undefined && stringify(item.input) !== '') {
        parts.push(h('h3', {}, environment.t('tool.input')));
        parts.push(h('pre', {}, stringify(item.input)));
      }
      if (item.content.length > 0) {
        parts.push(h('h3', {}, environment.t('tool.produced')));
        parts.push(...item.content.map((part) => contentPart(part, environment)));
      }
      if (item.result) {
        parts.push(h('h3', {}, item.result.isError ? environment.t('tool.error') : environment.t('tool.result', { seconds: (item.result.durationMilliseconds / 1000).toFixed(1) })));
        const output = stringify(item.result.output);
        parts.push(h('pre', { 'data-error': String(item.result.isError) }, output === '' ? environment.t('tool.no_output') : output.length > 20_000 ? `${output.slice(0, 20_000)}\n…` : output));
      }
      body.replaceChildren(...parts.filter((part): part is HTMLElement => part !== null));
      return element;
    }
    case 'attachment': {
      const element = existing ?? h('div', {});
      element.replaceChildren(attachmentElement(item.content, environment));
      return element;
    }
    case 'plan': {
      const element = existing ?? h('section', { class: 'plan' });
      element.replaceChildren(
        h('h3', {}, environment.t('transcript.plan')),
        h('ol', {}, ...item.entries.map((entry) => h('li', { 'data-status': entry.status },
          entry.content,
          h('span', { class: 'priority' }, environment.t(`plan.${entry.status}`)),
        ))),
      );
      return element;
    }
    case 'mode': {
      const element = existing ?? h('p', { class: 'event-line' });
      element.textContent = environment.t('transcript.mode', { mode: item.modeId });
      return element;
    }
    case 'error': {
      const element = existing ?? h('div', { class: 'event-error', role: 'alert' });
      element.replaceChildren(h('strong', {}, environment.t(item.recoverable ? 'transcript.error_recoverable' : 'transcript.error')), h('p', {}, item.message));
      return element;
    }
    case 'done': {
      const element = existing ?? h('p', { class: 'event-line' });
      const reason = stopReasonText(item.stopReason, environment);
      element.textContent = item.usage && item.usage.contextWindow > 0
        ? environment.t('transcript.done_usage', { reason, used: tokens(item.usage.contextUsed, environment.language), window: tokens(item.usage.contextWindow, environment.language) })
        : reason;
      return element;
    }
  }
}
