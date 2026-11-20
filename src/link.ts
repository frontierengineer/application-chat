import type { Result, Subscription, SurfaceContext } from '../../application';
import { openKey, shownKey } from './shared.ts';

// What a Chat panel shows: a new chat's form, a chat by its id, or another session as `session:` and its id.
export type Target = string;

// How Chat's panels on one Surface tell each other what to show: the Chats panel, and an action, ask a Chat
// panel to open a chat and bring it forward; the Chat panel says what it shows, so the Chats panel marks it.
export interface PanelLink {
  open(target: Target): Promise<Result>;
  onOpen(handler: (target: Target) => void): Subscription;
  // The request made before this panel listened, taken once.
  pending(): Promise<Target | null>;
  shown(target: Target | null): void;
  onShown(handler: (target: Target | null) => void): Subscription;
  current(): Promise<Target | null>;
}

export function panelLink(context: SurfaceContext): PanelLink {
  const opening = openKey(context.currentSurface.id);
  const showing = shownKey(context.currentSurface.id);
  const take = async (): Promise<Target | null> => {
    const request = await context.store.getJson<{ target: Target }>(opening);
    if (!request.ok || request.value === null) return null;
    await context.store.delete(opening);
    return request.value.target;
  };
  return {
    async open(target) {
      const written = await context.store.putJson({ key: opening, value: { target, at: Date.now() } });
      if (!written.ok) return written;
      const one = await context.panels.reveal('chat');
      if (one.ok || !one.unavailable) return one;
      return context.panels.reveal('chat-compact');
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
      void context.store.putJson({ key: showing, value: { target } });
    },
    onShown(handler) {
      return context.store.watch('shown/', (change) => {
        if (change.key !== showing) return;
        void context.store.getJson<{ target: Target | null }>(showing).then((shown) => {
          if (shown.ok) handler(shown.value?.target ?? null);
        });
      });
    },
    async current() {
      const shown = await context.store.getJson<{ target: Target | null }>(showing);
      return shown.ok ? shown.value?.target ?? null : null;
    },
  };
}
