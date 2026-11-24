# Chat

A Frontier Application for talking with agents. It is one of Frontier's Initial
Applications, written against Frontier's Application Interface
(`interfaces/application.d.ts`) like any other Application.

## What it does

Chat contributes three **panels** a person places in a deck. **Chats** lists
the chats and the other public sessions, to find one by its words and start a
new one; it fits 240 by 320. **Chat** shows one chat, its conversation and
composer; it needs a keyboard and at least 320 by 360 pixels, so a phone
shows it. A chat chosen in Chats is shown in the Chat panel of the same deck,
the one already on it if there is one, else one is placed there. A Chat panel keeps its values true to
what it shows, the chat or a session no chat runs, so the deck keeps it and
Chats marks it, deck by deck. **Compact chat** shows the list or one chat, with
targets sized for a finger; it fits 320 by 400 and works by touch. A Chat
panel can be set, in its deck, to open on one chat, and the actions bring
whichever the deck shown holds forward.

The **Chats + Conversation** deck preset places Chats beside Chat.

- **Starting a chat** takes one prompt. Chat picks a runtime that is ready on a
  connected worker, remembering the last choice on each surface. Options choose
  the runtime and worker, the model and its settings (such as effort), an agent
  definition, a persona, a title, and a workspace: none, an existing one on that
  worker, or a new one from a workspace provisioner there, by name and base.
  When the runtime is not ready on the worker, the form says why, in the
  runtime's own words.
- **A turn streams** as it runs, drawn by the Design System's
  `frontier-transcript`, the same as in every Application: the prompt as a
  bubble at the end of the line, the agent's words as Markdown with its code
  coloured, its thoughts, each tool call as a card of its kind (an edit's diff,
  a command and its output, a read, a search), the plan, and the mode, commands
  and context used in a bar under it. The composer shows whether the turn is
  waiting or running, and for how long. The prompt a chat starts with shows at
  once, and the whole conversation loads again from the agent when a turn ends.
- **The next prompt** can be sent while a turn runs. It waits, and a newer one
  replaces it. A queued prompt can be canceled, and a running turn stopped,
  keeping what the agent wrote.
- **Runtime, model and mode** sit in the composer's bar; the model and mode
  change during a session where the agent allows it. The model picker is the
  Design System's `frontier-combobox`: typing "deepseek flash" shows every
  DeepSeek Flash model. So are the new chat form's model, agent definition,
  persona and workspace pickers.
- **Attachments**: images, audio and files go with a prompt when the agent
  takes them. Text files go inline when it takes no embedded files. Anything
  the agent does not take is named, and nothing is sent.
- **Release** stops the agent and frees the workspace slot, keeping the
  conversation. The next prompt, or Resume, continues it on a fresh session.
- **Other sessions**, such as an agent's sub-agents, are listed too, to watch
  and prompt.

When a turn ends while no view shows its chat, Chat raises a notification:
the agent waits on you. A chat starts its agent in the background, so a slow
launch shows as Starting, and one that does not start says why.

Chat's sessions are public, so the Sessions view, agents and other
Applications see them. Everything Chat keeps is in its store under `chats/`,
the same on every surface.

## Its methods, actions and option source

The host bundle's methods do the work, and the views are a thin layer over them.
Agents and other Applications call them too.

| Method | What it does |
| --- | --- |
| `create-chat` | Starts a chat on a runtime and worker, optionally in a workspace, and sends its first prompt. |
| `prompt-chat` | Sends a prompt, resuming a released chat first. |
| `resume-chat` | Starts a released chat again on a fresh session. |
| `release-chat` | Stops a chat's agent and frees its slot, keeping the conversation. |
| `remove-chat` | Releases a chat and removes it from Chat. |
| `list-chats` | Every chat, most recently prompted first. |

Actions, for the Command Palette and for agents as tools: `new-chat` (Alt+N),
`start-chat`, `open-chat`, `prompt-chat` and `release-chat`. The `chats` option
source lists the chats for their inputs.

## Layout

| Path | What |
| --- | --- |
| `contributions.json` | The Application as data. |
| `host.ts`, `src/host/chats.ts` | The methods. |
| `surface.ts`, `src/actions.ts` | The surface registration and its actions. |
| `src/link.ts` | How the panels on one Surface ask each other to show a chat and say what they show. |
| `src/view/` | The panels: the list, the new chat form, the conversation and the composer. |
| `src/shared.ts` | The chat record and the methods' input and output. |
| `translations.json` | Every word a person reads, by token. |
| `test/` | Unit tests of the methods and the prompt's attachments, and browser tests of the views. |

The views are plain semantic HTML and the Design System's `frontier-*`
elements: the open chat is a stack of a header row, a `frontier-scroll`
holding the `frontier-transcript`, and the composer as a `frontier-card`;
states are `frontier-badge`s, empty views `frontier-empty`, the chat's actions
a `frontier-menu`, long lists `frontier-combobox`es. Chat's own CSS
is only the arrangement, all of it in tokens, with the Soft radius: controls
and list entries take the control radius, bubbles and cards the large one,
panes and bars stay square, badges and dots round.

## Checking it

```sh
npm ci
npm test
```

It type-checks the sources against a Frontier checkout's Application Interface,
runs the tests, and bundles each entry file the way the Host does. It looks for
the checkout at `../../frontier`, or at `FRONTIER_REPO`, and drives the views in
Chromium with the checkout's Playwright and the checkout's own Design System,
its stylesheet and Behaviors, as a view frame holds them; without them the
browser tests fail rather than skip. Set `CHAT_SCREENSHOTS` to a directory to
keep screenshots of the views.

To see it in Frontier's Electron application, from a Frontier checkout:

```sh
bash modcon/scripts/tool.sh ui --remake --applications <a directory holding this repository and a Runtime>
```

Its build carries the committed `HEAD` of each Application in that
directory as an Initial Application. A Runtime Application (Claude Code or
OpenCode, with its CLI on the worker) is needed for an agent to answer.

## License

MIT
