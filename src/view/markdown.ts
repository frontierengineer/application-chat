import { Marked } from 'marked';

const marked = new Marked({ gfm: true, breaks: false, async: false });

const allowedTags = new Set([
  'p', 'br', 'strong', 'em', 'del', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'img', 'span', 'input', 'sup', 'sub', 'kbd', 'details', 'summary',
]);
const allowedAttributes: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'title']),
  th: new Set(['align', 'colspan', 'rowspan']),
  td: new Set(['align', 'colspan', 'rowspan']),
  ol: new Set(['start']),
  input: new Set(['type', 'checked', 'disabled']),
  code: new Set(['class']),
};

function safeUrl(value: string, image: boolean): boolean {
  const trimmed = value.trim().toLowerCase();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('mailto:')) return !image || !trimmed.startsWith('mailto:');
  if (image && /^data:image\/(png|jpe?g|gif|webp|svg\+xml);/.test(trimmed)) return true;
  return !/^[a-z][a-z0-9+.-]*:/.test(trimmed);
}

function clean(node: Node): void {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      const element = child as Element;
      const tag = element.tagName.toLowerCase();
      if (!allowedTags.has(tag)) {
        if (tag === 'script' || tag === 'style' || tag === 'iframe' || tag === 'object' || tag === 'embed' || tag === 'template') {
          element.remove();
        } else {
          clean(element);
          element.replaceWith(...element.childNodes);
        }
        continue;
      }
      for (const attribute of [...element.attributes]) {
        const name = attribute.name.toLowerCase();
        const allowed = allowedAttributes[tag]?.has(name) ?? false;
        if (!allowed || ((name === 'href' || name === 'src') && !safeUrl(attribute.value, name === 'src'))) element.removeAttribute(attribute.name);
      }
      if (tag === 'input' && element.getAttribute('type') !== 'checkbox') element.remove();
      if (tag === 'input') element.setAttribute('disabled', '');
      if (tag === 'a') {
        element.setAttribute('target', '_blank');
        element.setAttribute('rel', 'noopener noreferrer');
      }
      clean(element);
    } else if (child.nodeType !== Node.TEXT_NODE) {
      child.remove();
    }
  }
}

export function renderMarkdown(source: string): DocumentFragment {
  const html = marked.parse(source) as string;
  const template = document.createElement('template');
  template.innerHTML = html;
  clean(template.content);
  return template.content;
}
