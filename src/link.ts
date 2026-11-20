import type { Panels, Result, Subscription, SurfaceContext } from '../../application';
import { openKey, shownKey } from './shared.ts';

// What a Chat panel shows: a new chat's form, a chat by its id, or another session as `session:` and its id.
export type Target = string;

// How Chat's panels tell each other what to show: the Chats panel, and an action, ask a Chat panel to open a
// chat and bring it forward; the Chat panel says what it shows, so the Chats panel marks it.
export interface PanelLink {
  open(target: Target): Promise<Result>;
  onOpen(handler: (target: Target) => void): Subscription;
  // The request made before this panel listened, taken once.
  pending(): Promise<Target | null>;
  shown(target: Target | null): void;
  onShown(handler: (target: Target | null) => void): Subscription;
  current(): Promise<Target | null>;
}

// The Shell's way for an Application's panels to open one another and talk within a Deck, where the platform
// has it: open places or reuses a panel in the Deck shown, post and onMessage reach the Application's other
// panels in that Deck. Without it, a request goes through Chat's store and panels.reveal.
interface DeckPanels {
  open?(request: { panelId: string; values?: Record<string, unknown>; mode?: 'reuse' | 'new'; key?: string }): Promise<Result>;
  post?(message: unknown): unknown;
  onMessage?(handler: (message: unknown) => void): Subscription;
}

type Message = { type: 'chat.shown'; target: Target | null } | { type: 'chat.which' };

function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && ((value as Message).type === 'chat.shown' || (value as Message).type === 'chat.which');
}

const isChat = (target: Target): boolean => target !== 'new' && !target.startsWith('session:');

export function panelLink(context: SurfaceContext): PanelLink {
  const panels = context.panels as Panels & DeckPanels;
  const talks = typeof panels.post === 'function' && typeof panels.onMessage === 'function';
  const opening = openKey(context.currentSurface.id);
  const showing = shownKey(context.currentSurface.id);
  const take = async (): Promise<Target | null> => {
    const request = await context.store.getJson<{ target: Target }>(opening);
    if (!request.ok || request.value === null) return null;
    await context.store.delete(opening);
    return request.value.target;
  };
  const hear = (handler: (message: Message) => void): Subscription | null =>
    talks && panels.onMessage ? panels.onMessage((message) => { if (isMessage(message)) handler(message); }) : null;
  const state: { last: Target | null; answering: Subscription | null } = { last: null, answering: null };
  return {
    async open(target) {
      // A chat is the Chat panel's own field, so the Shell shows it in the panel already on it, or reuses one.
      if (panels.open && isChat(target)) return panels.open({ panelId: 'chat', values: { chat: target }, mode: 'reuse', key: target });
      const written = await context.store.putJson({ key: opening, value: { target, at: Date.now() } });
      if (!written.ok) return written;
      if (panels.open) return panels.open({ panelId: 'chat', mode: 'reuse' });
      const one = await panels.reveal('chat');
      if (one.ok || !one.unavailable) return one;
      return panels.reveal('chat-compact');
    },
    onOpen(handler) {
      return context.store.watch('open/', (change) => {
        if (change.kind !== 'written' || change.key !== opening) return;
        void take().then((target) => {
          if (target !== null) handler(target);
        });
      });
    },
    pending: take,
    shown(target) {
      state.last = target;
      if (talks) {
        state.answering ??= hear((message) => { if (message.type === 'chat.which') panels.post?.({ type: 'chat.shown', target: state.last }); });
        panels.post?.({ type: 'chat.shown', target });
      }
      void context.store.putJson({ key: showing, value: { target } });
    },
    onShown(handler) {
      const heard = hear((message) => { if (message.type === 'chat.shown') handler(message.target); });
      if (heard) return heard;
      return context.store.watch('shown/', (change) => {
        if (change.key !== showing) return;
        void context.store.getJson<{ target: Target | null }>(showing).then((shown) => {
          if (shown.ok) handler(shown.value?.target ?? null);
        });
      });
    },
    async current() {
      // In a Deck the Chat panels there answer by message; without one, the store holds what one on this Surface last showed.
      if (talks) {
        panels.post?.({ type: 'chat.which' });
        return null;
      }
      const shown = await context.store.getJson<{ target: Target | null }>(showing);
      return shown.ok ? shown.value?.target ?? null : null;
    },
  };
}
