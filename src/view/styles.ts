// Chat's own CSS: only the arrangement particular to a chat, written with the
// Design System's tokens. The view frame already holds the tokens, the
// stylesheet and the frontier-* elements, which draw every control, badge,
// card, menu and split; nothing here draws a line between areas, and the
// radius is Soft: controls take the medium radius, cards and bubbles the
// large one, panes and bars stay square, badges and dots stay round.
// A pulse lasts five and a half page durations, so with reduced motion,
// where every duration is 0, nothing pulses.
export const css = `
html, body { block-size: 100%; margin: 0; }
body { overflow: hidden; background: var(--frontier-color-background); }
.visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.chat { --chat-pulse: calc(var(--frontier-duration-page) * 5.5); block-size: 100vh; }
@keyframes chat-pulse { 50% { opacity: 0.35; } }

/* The whole view: the Chats panel's list, the Chat panel's one chat, or one of them at a time when compact. */
.chat { display: flex; flex-direction: column; }
.chat > * { flex: 1; min-block-size: 0; }
.list-pane { background: var(--frontier-color-surface-sunken); border-radius: var(--frontier-radius-none); min-inline-size: 0; }
.list-pane h1 { font-size: var(--frontier-font-size-heading-3); margin: 0; }
.list-pane input[type="search"] { inline-size: 100%; box-sizing: border-box; }
.main { min-inline-size: 0; min-block-size: 0; background: var(--frontier-color-background); border-radius: var(--frontier-radius-none); }

/* The list of chats. */
.chat-list, .chat-list ul { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--frontier-space-1); }
.chat-list h2 { font-family: var(--frontier-font-text); font-size: var(--frontier-font-size-caption); text-transform: uppercase; letter-spacing: 0.06em; color: var(--frontier-color-text-muted); margin: var(--frontier-space-4) var(--frontier-space-2) var(--frontier-space-1); }
.chat-list button.entry {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px var(--frontier-space-2); align-items: center;
  inline-size: 100%; block-size: auto; padding: var(--frontier-space-2) var(--frontier-space-3);
  text-align: start; font-weight: inherit; color: inherit; background: transparent;
  border-radius: var(--frontier-radius-medium);
}
.chat-list button.entry:hover { background: var(--frontier-color-hover); }
.chat-list button.entry[aria-current="true"] { background: var(--frontier-color-selected); }
.chat-list .entry-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-list .entry-meta { grid-column: 1 / -1; color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-empty { margin: 0; padding: var(--frontier-space-2); color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); }
frontier-badge[data-state="running"]::before { animation: chat-pulse var(--chat-pulse) ease-in-out infinite; }

/* The open chat: its header, the transcript and the composer. */
.conversation-header h2 { font-size: var(--frontier-font-size-heading-3); margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-header .titles { min-inline-size: 0; flex: 1; }
.conversation-header small { color: var(--frontier-color-text-muted); }
.notices:empty { display: none; }
.notices { padding: 0 var(--frontier-space-5); display: grid; gap: var(--frontier-space-2); }
.notices > [role] { display: flex; gap: var(--frontier-space-3); align-items: center; }
.notices > [role] p { margin: 0; flex: 1; }
.notices > [role] strong { display: block; }

.transcript { inline-size: 100%; max-inline-size: 860px; margin-inline: auto; box-sizing: border-box; min-block-size: 100%; }
.attachment { display: inline-flex; gap: var(--frontier-space-1); align-items: center; background: var(--frontier-color-fill); border-radius: var(--frontier-radius-medium); padding: var(--frontier-space-1) var(--frontier-space-2); font-size: var(--frontier-font-size-small); max-inline-size: 100%; }
.jump { position: sticky; inset-block-end: var(--frontier-space-2); align-self: center; box-shadow: var(--frontier-shadow-overlay); }
.transcript > frontier-empty { margin-block: auto; }
.transcript > frontier-empty[hidden] { display: none; }

.composer { inline-size: calc(100% - 2 * var(--frontier-space-5)); max-inline-size: 860px; margin: var(--frontier-space-2) auto var(--frontier-space-5); box-sizing: border-box; }
.composer:focus-within { box-shadow: var(--frontier-shadow-raised), 0 0 0 2px var(--frontier-color-focus-ring); }
.composer textarea { border: none; background: transparent; box-shadow: none; outline: none; resize: none; padding: 0; min-block-size: calc(var(--frontier-line-height-body) * 2em); max-block-size: 40vh; inline-size: 100%; }
.composer .chips:empty { display: none; }
.composer .chips { display: flex; flex-wrap: wrap; gap: var(--frontier-space-2); }
.composer .status { color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); display: inline-flex; gap: var(--frontier-space-2); align-items: center; min-inline-size: 0; }
.composer select { inline-size: auto; max-inline-size: 14rem; }
/* A chat keeps a reading column unless the person chose the full width. */
.main[data-width="fill"] :is(.transcript, .composer, .below-composer) { max-inline-size: none; }
.composer.dragging { box-shadow: 0 0 0 2px var(--frontier-color-primary); }
.below-composer { inline-size: calc(100% - 2 * var(--frontier-space-5)); max-inline-size: 860px; margin: calc(-1 * var(--frontier-space-3)) auto var(--frontier-space-4); }
.below-composer p { margin: 0; font-size: var(--frontier-font-size-small); }
.below-composer p:empty { display: none; }

/* A new chat. */
.new-chat form { inline-size: 100%; max-inline-size: 44rem; margin-inline: auto; box-sizing: border-box; padding: var(--frontier-space-8) var(--frontier-space-5); display: grid; gap: var(--frontier-space-4); }
.new-chat form > :empty { display: none; }
.new-chat h2 { margin: 0; }
.new-chat .lead { margin: 0; color: var(--frontier-color-text-muted); }
.new-chat textarea { inline-size: 100%; min-block-size: 7em; box-sizing: border-box; }
.new-chat .field { display: grid; gap: var(--frontier-space-1); align-content: start; }
.new-chat .field-label { display: flex; align-items: center; gap: var(--frontier-space-1); }
.new-chat .field-label > label { font-weight: 600; font-size: var(--frontier-font-size-small); }
.new-chat .about { position-area: block-end span-inline-end; margin: var(--frontier-space-1) 0; inset: auto; max-inline-size: 20rem; font-weight: 400; text-transform: none; letter-spacing: normal; font-size: var(--frontier-font-size-small); }
.new-chat .field small { color: var(--frontier-color-text-muted); }
.new-chat .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--frontier-space-3); }
.new-chat details.options { background: var(--frontier-color-surface-sunken); border-radius: var(--frontier-radius-large); padding: var(--frontier-space-3) var(--frontier-space-4); }
.new-chat details.options[open] > summary { margin-block-end: var(--frontier-space-3); }
.new-chat .summary-text { color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); margin-inline-start: var(--frontier-space-2); }
.new-chat fieldset { border: none; margin: var(--frontier-space-3) 0 0; padding: 0; display: grid; gap: var(--frontier-space-2); }
.new-chat legend { font-weight: 600; font-size: var(--frontier-font-size-small); padding: 0; margin-block-end: var(--frontier-space-1); }
.new-chat legend .field-label { display: inline-flex; }

/* The compact panel is touched: controls grow to a finger's size. */
.compact button:not(.entry), .compact select, .compact input, .compact summary { min-block-size: 44px; }
.compact .composer { inline-size: calc(100% - 2 * var(--frontier-space-3)); margin-block-end: var(--frontier-space-3); }
.compact .below-composer { inline-size: calc(100% - 2 * var(--frontier-space-3)); }
`;
