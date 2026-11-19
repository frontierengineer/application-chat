# Chat

A Frontier Application for talking with agents. It is one of Frontier's Initial
Applications, written against Frontier's Application Interface
(`interfaces/application.d.ts`) like any other Application.

## What it does

Chat contributes a **desktop** and a **panel**: on a workstation, the list of
chats beside the open one; on a handheld panel, the list or one chat at a time.

- **Starting a chat** takes one prompt. Chat picks a runtime that is ready on a
  connected worker, remembering the last choice on each surface. Options choose
  the runtime and worker, the model and its settings (such as effort), an agent
  definition, a persona, a title, and a workspace: none, an existing one on that
  worker, or a new one from a workspace provisioner there, by name and base.
  When the runtime is not ready on the worker, the form says why, in the
  runtime's own words.
- **A turn streams** as it runs: the prompt as a bubble at the end of the line,
  the agent's words as rendered Markdown beside it, and its thinking, each tool
  call (its input, files, diffs and result) and its plan as cards that open.
  The composer shows whether the turn is waiting or running, and for how long.
  When it ends it says why. The prompt a chat starts with shows at once, and
  the whole conversation loads again from the agent when a turn ends.
- **The next prompt** can be sent while a turn runs. It waits, and a newer one
  replaces it. A queued prompt can be canceled, and a running turn stopped,
  keeping what the agent wrote.
- **Runtime, model and mode** sit in the composer's bar; the model and mode
  change during a session where the agent allows it.
- **Attachments**: images, audio and files go with a prompt when the agent
  takes them. Text files go inline when it takes no embedded files. Anything
  the agent does not take is named, and nothing is sent.
- **Release** stops the agent and frees the workspace slot, keeping the
  conversation. The next prompt, or Resume, continues it on a fresh session.
- **Other sessions**, such as an agent's sub-agents, are listed too, to watch
  and prompt.

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
| `src/view/` | The desktop and panel: the list, the new chat form, the conversation, the transcript and the composer. |
| `src/shared.ts` | The chat record and the methods' input and output. |
| `translations.json` | Every word a person reads, by token. |
| `test/` | Unit tests of the methods and the transcript, and browser tests of the views. |

The views are plain semantic HTML and the Design System's `frontier-*`
elements: the desktop is a `frontier-split` whose list the person drags to
size, the open chat a stack of a header row, a `frontier-scroll` transcript
and the composer as a `frontier-card`; states are `frontier-badge`s, empty
views `frontier-empty`, the chat's actions a `frontier-menu`. Chat's own CSS
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

To see it in Frontier's Electron app, from a Frontier checkout:

```sh
bash modcon/scripts/tool.sh ui --remake --applications <a directory holding this repository and a Runtime>
```

The app's build carries the committed `HEAD` of each Application in that
directory as an Initial Application. A Runtime Application (Claude Code or
OpenCode, with its CLI on the worker) is needed for an agent to answer.

## License

MIT
