import type { PromptCapabilities, PromptContentPart } from '../../../application';
import type { ChatPrompt } from '../shared.ts';

export interface Attachment {
  name: string;
  type: string;
  data: Uint8Array;
}

export type Built = { ok: true; prompt: ChatPrompt } | { ok: false; refused: string[]; kinds: string[] };

const textTypes = /^(text\/|application\/(json|xml|javascript|typescript|x-sh|x-yaml|toml|sql))/;
const textExtensions = /\.(md|txt|json|ya?ml|toml|ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|swift|sh|sql|html|css|scss|xml|csv|log|ini|env|lock|gitignore|dockerfile)$/i;

export function asText(attachment: Attachment): string | null {
  if (attachment.data.length > 512 * 1024) return null;
  if (!textTypes.test(attachment.type) && !textExtensions.test(attachment.name) && attachment.type !== '') return null;
  if (attachment.data.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(attachment.data);
  } catch {
    return null;
  }
}

export function buildPrompt(text: string, attachments: readonly Attachment[], capabilities: PromptCapabilities): Built {
  if (attachments.length === 0) return { ok: true, prompt: text };
  const parts: PromptContentPart[] = [];
  const inline: string[] = [];
  const refused: string[] = [];
  const kinds = new Set<string>();
  for (const attachment of attachments) {
    const uri = `file:///${encodeURIComponent(attachment.name)}`;
    if (attachment.type.startsWith('image/')) {
      if (capabilities.image) parts.push({ type: 'image', data: attachment.data, mimeType: attachment.type, uri: null });
      else {
        refused.push(attachment.name);
        kinds.add('image');
      }
      continue;
    }
    if (attachment.type.startsWith('audio/')) {
      if (capabilities.audio) parts.push({ type: 'audio', data: attachment.data, mimeType: attachment.type });
      else {
        refused.push(attachment.name);
        kinds.add('audio');
      }
      continue;
    }
    const content = asText(attachment);
    if (content !== null) {
      if (capabilities.embeddedContext) parts.push({ type: 'resource_text', uri, text: content, mimeType: attachment.type || 'text/plain' });
      else inline.push(`${attachment.name}:\n\`\`\`\n${content}\n\`\`\``);
      continue;
    }
    if (capabilities.embeddedContext) parts.push({ type: 'resource_blob', uri, blob: attachment.data, mimeType: attachment.type || 'application/octet-stream' });
    else {
      refused.push(attachment.name);
      kinds.add('file');
    }
  }
  if (refused.length > 0) return { ok: false, refused, kinds: [...kinds] };
  const fullText = [text, ...inline].filter((part) => part.trim() !== '').join('\n\n');
  return { ok: true, prompt: [...(fullText === '' ? [] : [{ type: 'text' as const, text: fullText }]), ...parts] };
}
