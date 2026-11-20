import type { DeckPanel, FieldValues, OpenOptions, PanelContext, Result, Subscription, SurfaceContext } from '../../application';

// What a Chat panel shows: a new chat's form, a chat by its id, or another session as `session:` and its id.
export type Target = string;

// A new chat's form has no field of the Chat panel to carry it, so the ask is the Deck's state, heard by the
// Chat panels there and read once by one mounted just after.
const ASKED = 'open';
const ASK_HOLDS_MILLISECONDS = 15_000;

function valuesOf(target: Target): FieldValues {
  if (target === 'new') return {};
  if (target.startsWith('session:')) return { sessionId: target.slice('session:'.length) };
  return { chat: target };
}

// The Chat panel's fields as they name what it shows: a chat, or a session no chat runs, or neither.
export function fieldsOf(target: Target | null): FieldValues {
  if (target === null || target === 'new') return { chat: '', sessionId: '' };
  if (target.startsWith('session:')) return { chat: '', sessionId: target.slice('session:'.length) };
  return { chat: target, sessionId: '' };
}

// What a Chat panel in the Deck shows, read from its fields.
export function targetOfFields(values: FieldValues): Target | null {
  if (typeof values.chat === 'string' && values.chat !== '') return values.chat;
  if (typeof values.sessionId === 'string' && values.sessionId !== '') return `session:${values.sessionId}`;
  return null;
}

// From the Chats panel or an action: shows the target in a Chat panel of the Deck, the one already on it when
// there is one; on a Surface that places no panel by itself, in the compact panel the Deck holds.
export async function openInChat(context: SurfaceContext, target: Target): Promise<Result> {
  if (target === 'new') {
    const asked = await context.deck.state.set(ASKED, { target, at: Date.now() });
    if (!asked.ok) return asked;
  }
  const options: OpenOptions = target === 'new' ? {} : { key: target };
  const shown = await context.panels.show('chat', valuesOf(target), options);
  if (shown.ok || !shown.unavailable) return shown;
  return context.panels.show('chat-compact', valuesOf(target), options);
}

// In a Chat panel: a new chat's form asked for by another of Chat's panels in the Deck, now or just before it mounted.
export function onAskedNew(context: PanelContext, handler: () => void): Subscription {
  const heard = (value: unknown): boolean => {
    const ask = value as { target?: unknown; at?: unknown } | null;
    return ask !== null && typeof ask === 'object' && ask.target === 'new' && typeof ask.at === 'number' && Date.now() - ask.at < ASK_HOLDS_MILLISECONDS;
  };
  void context.deck.state.get(ASKED).then((asked) => {
    if (asked.ok && heard(asked.value)) handler();
  });
  return context.deck.state.watch(ASKED, (value) => {
    if (heard(value)) handler();
  });
}

// In the Chats panel: what the Chat panels of this Deck show, the one in front of its stack first.
export function onChatShown(context: PanelContext, handler: (target: Target | null) => void): Subscription {
  const pick = (panels: readonly DeckPanel[]): Target | null => {
    const chats = panels.filter((panel) => panel.panelId === 'chat');
    const shown = chats.find((panel) => panel.front) ?? chats[0];
    return shown === undefined ? null : targetOfFields(shown.values);
  };
  void context.panels.inDeck().then((panels) => {
    if (panels.ok) handler(pick(panels.value));
  });
  return context.panels.onChange((panels) => handler(pick(panels)));
}
