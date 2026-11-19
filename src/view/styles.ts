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

/* The whole view: the list beside the open chat on a desktop, one of them on a panel. */
.chat.panel { display: flex; flex-direction: column; }
.chat.panel > * { flex: 1; min-block-size: 0; }
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
.usage { display: inline-flex; gap: var(--frontier-space-2); align-items: center; color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); white-space: nowrap; }
.usage meter { inline-size: 64px; }
.usage:empty { display: none; }
.notices:empty { display: none; }
.notices { padding: 0 var(--frontier-space-5); display: grid; gap: var(--frontier-space-2); }
.notices > [role] { display: flex; gap: var(--frontier-space-3); align-items: center; }
.notices > [role] p { margin: 0; flex: 1; }
.notices > [role] strong { display: block; }

.transcript { inline-size: 100%; max-inline-size: 860px; margin-inline: auto; box-sizing: border-box; min-block-size: 100%; }
.you {
  align-self: end; max-inline-size: 70%; padding: var(--frontier-space-2) var(--frontier-space-3);
  border-radius: var(--frontier-radius-large); background: var(--frontier-color-surface-raised);
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.you .attachments { display: flex; flex-wrap: wrap; gap: var(--frontier-space-2); margin-block-start: var(--frontier-space-2); white-space: normal; }
.agent { line-height: 1.6; overflow-wrap: anywhere; }
.agent :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4) { margin-block: 0; }
.agent :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4) + :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4) { margin-block-start: var(--frontier-space-3); }
.agent pre { position: relative; padding-inline-end: var(--frontier-space-16); }
.agent pre button.copy { position: absolute; inset-block-start: var(--frontier-space-1); inset-inline-end: var(--frontier-space-1); }
.agent img { max-inline-size: 100%; border-radius: var(--frontier-radius-large); }

/* A thought, a tool call and a plan are sunken cards: wells below the page. */
details.block, .plan { background: var(--frontier-color-surface-sunken); border-radius: var(--frontier-radius-large); }
details.block > summary { display: flex; gap: var(--frontier-space-2); align-items: center; padding: var(--frontier-space-2) var(--frontier-space-3); cursor: pointer; min-inline-size: 0; }
details.block > summary .name { font-weight: 600; white-space: nowrap; }
details.block > summary .summary-input { font-family: var(--frontier-font-code); font-size: var(--frontier-font-size-small); color: var(--frontier-color-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; min-inline-size: 0; }
details.block > summary > svg { color: var(--frontier-color-text-muted); }
details.block .body { padding: 0 var(--frontier-space-3) var(--frontier-space-3); display: grid; gap: var(--frontier-space-2); }
details.block .body h3 { font-family: var(--frontier-font-text); font-size: var(--frontier-font-size-caption); text-transform: uppercase; letter-spacing: 0.06em; color: var(--frontier-color-text-muted); margin: var(--frontier-space-1) 0 0; }
details.block .body ul { margin: 0; padding-inline-start: var(--frontier-space-5); }
details.block pre { margin: 0; max-block-size: 24rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--frontier-color-background); }
details.block pre[data-error="true"] { box-shadow: inset 3px 0 0 var(--frontier-color-danger); }
details.thinking .body { white-space: pre-wrap; color: var(--frontier-color-text-muted); font-style: italic; }
.diff { font-family: var(--frontier-font-code); font-size: var(--frontier-font-size-small); background: var(--frontier-color-background); border-radius: var(--frontier-radius-small); overflow-x: auto; padding-block: var(--frontier-space-1); }
.diff .path { padding: var(--frontier-space-1) var(--frontier-space-3); color: var(--frontier-color-text-muted); }
.diff .line { white-space: pre; padding: 0 var(--frontier-space-3); }
.diff .line[data-sign="+"] { background: color-mix(in srgb, var(--frontier-color-success) 14%, transparent); }
.diff .line[data-sign="-"] { background: color-mix(in srgb, var(--frontier-color-danger) 14%, transparent); }
.diff .line[data-sign="…"] { color: var(--frontier-color-text-muted); }
.plan { padding: var(--frontier-space-3); }
.plan h3 { font-family: var(--frontier-font-text); font-size: var(--frontier-font-size-caption); text-transform: uppercase; letter-spacing: 0.06em; color: var(--frontier-color-text-muted); margin: 0 0 var(--frontier-space-2); }
.plan ol { margin: 0; padding-inline-start: var(--frontier-space-5); display: grid; gap: var(--frontier-space-1); }
.plan li[data-status="completed"] > span:first-child { color: var(--frontier-color-text-muted); text-decoration: line-through; }
.plan li[data-status="in_progress"] > span:first-child { color: var(--frontier-color-primary-text); font-weight: 600; }
.plan li frontier-badge { margin-inline-start: var(--frontier-space-2); }
.event-line { color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); text-align: center; margin: 0; }
.event-error p { margin: 0; }
.attachment { display: inline-flex; gap: var(--frontier-space-1); align-items: center; background: var(--frontier-color-fill); border-radius: var(--frontier-radius-medium); padding: var(--frontier-space-1) var(--frontier-space-2); font-size: var(--frontier-font-size-small); max-inline-size: 100%; }
.attachment img { max-block-size: 160px; max-inline-size: 100%; border-radius: var(--frontier-radius-small); display: block; }
.typing { display: inline-flex; gap: var(--frontier-space-1); align-items: center; color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); }
.typing > span:not(.visually-hidden) { inline-size: 6px; block-size: 6px; border-radius: var(--frontier-radius-pill); background: currentColor; animation: chat-pulse var(--chat-pulse) ease-in-out infinite; }
.typing > span:nth-child(2) { animation-delay: calc(var(--chat-pulse) / 6); }
.typing > span:nth-child(3) { animation-delay: calc(var(--chat-pulse) / 3); }
.typing-row:empty { display: none; }
.jump { position: sticky; inset-block-end: var(--frontier-space-2); align-self: center; box-shadow: var(--frontier-shadow-overlay); }
.transcript > frontier-empty { margin-block: auto; }

.composer { inline-size: calc(100% - 2 * var(--frontier-space-5)); max-inline-size: 860px; margin: var(--frontier-space-2) auto var(--frontier-space-5); box-sizing: border-box; }
.composer:focus-within { box-shadow: var(--frontier-shadow-raised), 0 0 0 2px var(--frontier-color-focus-ring); }
.composer textarea { border: none; background: transparent; box-shadow: none; outline: none; resize: none; padding: 0; min-block-size: calc(var(--frontier-line-height-body) * 2em); max-block-size: 40vh; inline-size: 100%; }
.composer .chips:empty { display: none; }
.composer .chips { display: flex; flex-wrap: wrap; gap: var(--frontier-space-2); }
.composer .status { color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); display: inline-flex; gap: var(--frontier-space-2); align-items: center; min-inline-size: 0; }
.composer select { inline-size: auto; max-inline-size: 14rem; }
/* A chat keeps a reading column unless the person chose to fill the view's width. */
.main[data-width="fill"] :is(.transcript, .composer, .below-composer) { max-inline-size: none; }
.composer.dragging { box-shadow: 0 0 0 2px var(--frontier-color-primary); }
.below-composer { inline-size: calc(100% - 2 * var(--frontier-space-5)); max-inline-size: 860px; margin: calc(-1 * var(--frontier-space-3)) auto var(--frontier-space-4); }
.below-composer p { margin: 0; font-size: var(--frontier-font-size-small); }
.below-composer p:empty { display: none; }
.hint { color: var(--frontier-color-text-muted); }

/* A new chat. */
.new-chat form { inline-size: 100%; max-inline-size: 44rem; margin-inline: auto; box-sizing: border-box; padding: var(--frontier-space-8) var(--frontier-space-5); display: grid; gap: var(--frontier-space-4); }
.new-chat form > :empty { display: none; }
.new-chat h2 { margin: 0; }
.new-chat .lead { margin: 0; color: var(--frontier-color-text-muted); }
.new-chat textarea { inline-size: 100%; min-block-size: 7em; box-sizing: border-box; }
.new-chat .field { display: grid; gap: var(--frontier-space-1); }
.new-chat .field > label { font-weight: 600; font-size: var(--frontier-font-size-small); }
.new-chat .field small { color: var(--frontier-color-text-muted); }
.new-chat .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: var(--frontier-space-3); }
.new-chat details.options { background: var(--frontier-color-surface-sunken); border-radius: var(--frontier-radius-large); padding: var(--frontier-space-3) var(--frontier-space-4); }
.new-chat details.options[open] > summary { margin-block-end: var(--frontier-space-3); }
.new-chat .summary-text { color: var(--frontier-color-text-muted); font-size: var(--frontier-font-size-small); margin-inline-start: var(--frontier-space-2); }
.new-chat fieldset { border: none; margin: var(--frontier-space-3) 0 0; padding: 0; display: grid; gap: var(--frontier-space-2); }
.new-chat legend { font-weight: 600; font-size: var(--frontier-font-size-small); padding: 0; margin-block-end: var(--frontier-space-1); }
.new-chat .choices { display: flex; flex-wrap: wrap; gap: var(--frontier-space-2) var(--frontier-space-4); }

/* A panel is touched: controls grow to a finger's size. */
.panel button:not(.entry), .panel select, .panel input, .panel summary { min-block-size: 44px; }
.panel .composer { inline-size: calc(100% - 2 * var(--frontier-space-3)); margin-block-end: var(--frontier-space-3); }
.panel .below-composer { inline-size: calc(100% - 2 * var(--frontier-space-3)); }
.panel .you { max-inline-size: 85%; }
`;
