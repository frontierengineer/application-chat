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
  delete: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
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
