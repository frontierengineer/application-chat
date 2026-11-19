type Child = Node | string | null | undefined | false;
type Attributes = Record<string, string | boolean | ((event: Event) => void) | undefined>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attributes: Attributes = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  return build(document.createElement(tag), attributes, children);
}

// A Design System element: frontier-stack, frontier-row, frontier-card, frontier-badge and the rest.
export function ds(tag: `frontier-${string}`, attributes: Attributes = {}, ...children: (Child | Child[])[]): HTMLElement {
  return build(document.createElement(tag), attributes, children);
}

function build<E extends HTMLElement>(element: E, attributes: Attributes, children: (Child | Child[])[]): E {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(name.replace(/^on/, '').toLowerCase(), value);
    else if (value === true) element.setAttribute(name, '');
    else element.setAttribute(name, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

export function withCode(textValue: string): (Node | string)[] {
  return textValue.split(/(`[^`]+`)/).filter((part) => part !== '').map((part) =>
    part.startsWith('`') && part.endsWith('`') ? h('code', {}, part.slice(1, -1)) : part,
  );
}

export function style(css: string): HTMLStyleElement {
  return h('style', {}, css);
}

// Icons drawn on a 24-unit grid; the Design System sizes and strokes an svg
// with no width or height of its own, and a button whose only child is one
// becomes a square icon button.
export const paths = {
  chat: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 3.5V6a1 1 0 0 1 1-1z',
  plus: 'M12 5v14M5 12h14',
  send: 'm5 12 7-7 7 7M12 19V5',
  stop: 'M7 7h10v10H7z',
  attach: 'm21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6L15 7.6',
  back: 'm15 18-6-6 6-6',
  down: 'm6 9 6 6 6-6',
  read: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  edit: 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  delete: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  move: 'm16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  execute: 'm4 17 6-6-6-6M12 19h8',
  think: 'M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1',
  fetch: 'M12 3v12m-5-5 5 5 5-5M5 21h14',
  switch_mode: 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  other: 'M12 8v8M8 12h8',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4v.3M12 17h.01',
} as const;

export function icon(name: keyof typeof paths): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS(namespace, 'path');
  shape.setAttribute('d', paths[name]);
  svg.append(shape);
  return svg;
}

export function fill(element: Element, ...children: Child[]): void {
  element.replaceChildren(...children.filter((child): child is Node | string => child !== null && child !== undefined && child !== false));
}
