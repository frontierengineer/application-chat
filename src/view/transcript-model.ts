import type {
  AttachmentPart,
  SessionUsage,
  ToolContentPart,
  ToolKind,
  ToolLocation,
  ToolStatus,
  TranscriptCommand,
  TranscriptEvent,
  TranscriptPlanEntry,
  TurnStopReason,
} from '../../../application';

export type Item =
  | { kind: 'user'; key: string; text: string; attachments: AttachmentPart[]; timestamp: number | null }
  | { kind: 'text'; key: string; text: string; partial: boolean; timestamp: number | null }
  | { kind: 'thinking'; key: string; text: string; partial: boolean; timestamp: number | null }
  | {
      kind: 'tool';
      key: string;
      name: string;
      toolKind: ToolKind;
      status: ToolStatus;
      input: unknown;
      locations: ToolLocation[];
      content: ToolContentPart[];
      result: { output: unknown; isError: boolean; durationMilliseconds: number } | null;
      timestamp: number | null;
    }
  | { kind: 'attachment'; key: string; content: AttachmentPart; timestamp: number | null }
  | { kind: 'plan'; key: string; entries: TranscriptPlanEntry[]; timestamp: number | null }
  | { kind: 'mode'; key: string; modeId: string; timestamp: number | null }
  | { kind: 'error'; key: string; code: string; message: string; recoverable: boolean; timestamp: number | null }
  | { kind: 'done'; key: string; stopReason: TurnStopReason | null; usage: SessionUsage | null; timestamp: number | null };

export class TranscriptModel {
  items: Item[] = [];
  usage: SessionUsage | null = null;
  commands: TranscriptCommand[] = [];
  private byKey = new Map<string, Item>();
  private counter = 0;
  private planKey: string | null = null;

  reset(events: readonly TranscriptEvent[]): void {
    this.items = [];
    this.byKey.clear();
    this.counter = 0;
    this.planKey = null;
    this.usage = null;
    this.commands = [];
    for (const event of events) this.apply(event);
  }

  private add(item: Item): Item {
    this.items.push(item);
    this.byKey.set(item.key, item);
    return item;
  }

  private next(prefix: string): string {
    this.counter += 1;
    return `${prefix}-${this.counter}`;
  }

  get lastUser(): Extract<Item, { kind: 'user' }> | null {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index]!;
      if (item.kind === 'user') return item;
    }
    return null;
  }

  apply(event: TranscriptEvent): Item | null {
    switch (event.type) {
      case 'turn_start': {
        this.planKey = null;
        return this.add({ kind: 'user', key: this.next('user'), text: event.userPrompt, attachments: [], timestamp: event.timestamp });
      }
      case 'text':
      case 'thinking': {
        const key = `${event.type}:${event.id}`;
        const existing = this.byKey.get(key);
        if (existing && (existing.kind === 'text' || existing.kind === 'thinking')) {
          existing.text = !event.partial && event.text !== null ? event.text : existing.text + event.delta;
          existing.partial = event.partial;
          return existing;
        }
        return this.add({ kind: event.type, key, text: !event.partial && event.text !== null ? event.text : event.delta, partial: event.partial, timestamp: event.timestamp });
      }
      case 'attachment': {
        const user = this.lastUser;
        if (event.channel === 'user' && user) {
          user.attachments.push(event.content);
          return user;
        }
        return this.add({ kind: 'attachment', key: this.next('attachment'), content: event.content, timestamp: event.timestamp });
      }
      case 'tool_call': {
        const key = `tool:${event.callId}`;
        const existing = this.byKey.get(key);
        if (existing && existing.kind === 'tool') {
          existing.name = event.name || existing.name;
          existing.toolKind = event.toolKind;
          existing.status = event.status;
          if (event.input !== undefined && event.input !== null) existing.input = event.input;
          if (event.locations.length > 0) existing.locations = event.locations;
          if (event.content.length > 0) existing.content = event.content;
          return existing;
        }
        return this.add({
          kind: 'tool',
          key,
          name: event.name,
          toolKind: event.toolKind,
          status: event.status,
          input: event.input,
          locations: event.locations,
          content: event.content,
          result: null,
          timestamp: event.timestamp,
        });
      }
      case 'tool_result': {
        const key = `tool:${event.callId}`;
        let tool = this.byKey.get(key);
        if (!tool || tool.kind !== 'tool') {
          tool = this.add({ kind: 'tool', key, name: event.callId, toolKind: 'other', status: 'completed', input: null, locations: [], content: [], result: null, timestamp: event.timestamp });
        }
        if (tool.kind !== 'tool') return null;
        tool.result = { output: event.output, isError: event.isError, durationMilliseconds: event.durationMilliseconds };
        tool.status = event.isError ? 'failed' : tool.status === 'pending' || tool.status === 'in_progress' ? 'completed' : tool.status;
        return tool;
      }
      case 'plan': {
        const existing = this.planKey ? this.byKey.get(this.planKey) : undefined;
        if (existing && existing.kind === 'plan') {
          existing.entries = event.entries;
          return existing;
        }
        const item = this.add({ kind: 'plan', key: this.next('plan'), entries: event.entries, timestamp: event.timestamp });
        this.planKey = item.key;
        return item;
      }
      case 'mode':
        return this.add({ kind: 'mode', key: this.next('mode'), modeId: event.modeId, timestamp: event.timestamp });
      case 'commands':
        this.commands = event.commands;
        return null;
      case 'usage':
        this.usage = event.usage;
        return null;
      case 'error':
        return this.add({ kind: 'error', key: this.next('error'), code: event.code, message: event.message, recoverable: event.recoverable, timestamp: event.timestamp });
      case 'done': {
        this.usage = event.usage ?? this.usage;
        for (const item of this.items) if ((item.kind === 'text' || item.kind === 'thinking') && item.partial) item.partial = false;
        return this.add({ kind: 'done', key: this.next('done'), stopReason: event.stopReason, usage: event.usage, timestamp: event.timestamp });
      }
      default:
        return null;
    }
  }
}

export function trimDiff(oldText: string | null, newText: string, context = 3): { line: string; sign: ' ' | '-' | '+' | '…' }[] {
  const before = oldText === null ? [] : oldText.split('\n');
  const after = newText.split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const lines: { line: string; sign: ' ' | '-' | '+' | '…' }[] = [];
  const from = Math.max(0, start - context);
  if (from > 0) lines.push({ line: '', sign: '…' });
  for (let index = from; index < start; index += 1) lines.push({ line: before[index] ?? '', sign: ' ' });
  for (let index = start; index < endBefore; index += 1) lines.push({ line: before[index] ?? '', sign: '-' });
  for (let index = start; index < endAfter; index += 1) lines.push({ line: after[index] ?? '', sign: '+' });
  const to = Math.min(after.length, endAfter + context);
  for (let index = endAfter; index < to; index += 1) lines.push({ line: after[index] ?? '', sign: ' ' });
  if (to < after.length) lines.push({ line: '', sign: '…' });
  return lines;
}
