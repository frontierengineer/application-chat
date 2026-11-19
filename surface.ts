import type { SurfaceRegistration } from '../application';
import { listChatChoices, newChat, openChat, promptChat, releaseChat, startChat } from './src/actions.ts';
import { mountChat } from './src/view/app.ts';

export const registration = {
  panels: {
    chat: { mount: (context) => mountChat(context, 'wide') },
    'chat-compact': { mount: (context) => mountChat(context, 'compact') },
  },
  actions: {
    'new-chat': { run: (context) => newChat(context) },
    'start-chat': { run: (context, input) => startChat(context, input) },
    'open-chat': { run: (context, input) => openChat(context, input) },
    'prompt-chat': { run: (context, input) => promptChat(context, input) },
    'release-chat': { run: (context, input) => releaseChat(context, input) },
  },
  optionSources: {
    chats: { list: (context) => listChatChoices(context) },
  },
} satisfies SurfaceRegistration;
