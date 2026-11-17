import type { HostRegistration } from '../application';
import { createChat, listChats, promptChat, releaseChat, removeChat, resumeChat } from './src/host/chats.ts';

export const registration = {
  methods: {
    'create-chat': { call: (context, input: Record<string, unknown>) => createChat(context, input) },
    'prompt-chat': { call: (context, input: Record<string, unknown>) => promptChat(context, input) },
    'resume-chat': { call: (context, input: Record<string, unknown>) => resumeChat(context, input) },
    'release-chat': { call: (context, input: Record<string, unknown>) => releaseChat(context, input) },
    'remove-chat': { call: (context, input: Record<string, unknown>) => removeChat(context, input) },
    'list-chats': { call: (context) => listChats(context) },
  },
} satisfies HostRegistration;
