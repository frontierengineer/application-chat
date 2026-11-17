export const css = `
:root {
  --chat-page: var(--frontier-color-background, #fbfaf8);
  --chat-sidebar: var(--frontier-color-surface-sunken, #f2f0ec);
  --chat-card: var(--frontier-color-surface, #ffffff);
  --chat-fill: var(--frontier-color-fill, #e9e6e0);
  --chat-selected: var(--frontier-color-selected, #e4e0f7);
  --chat-text: var(--frontier-color-text, #24211d);
  --chat-muted: var(--frontier-color-text-muted, #6b665e);
  --chat-accent: var(--frontier-color-primary, #5b4bc4);
  --chat-accent-text: var(--frontier-color-primary-text, #4a3bb0);
  --chat-on-accent: var(--frontier-color-on-primary, #ffffff);
  --chat-success: var(--frontier-color-success, #2b7a3d);
  --chat-warning: var(--frontier-color-warning, #8a5a00);
  --chat-danger: var(--frontier-color-danger, #b42318);
  --chat-info: var(--frontier-color-info, #2f5fb3);
  --chat-focus: var(--frontier-color-focus-ring, #5b4bc4);
  --chat-radius: var(--frontier-radius-medium, 10px);
  --chat-radius-small: var(--frontier-radius-small, 6px);
  --chat-shadow: var(--frontier-shadow-raised, 0 1px 2px rgba(0, 0, 0, 0.06), 0 2px 8px rgba(0, 0, 0, 0.04));
  --chat-font: var(--frontier-font-text, system-ui, sans-serif);
  --chat-font-code: var(--frontier-font-code, ui-monospace, monospace);
  --chat-small: var(--frontier-font-size-small, 0.85em);
  --chat-caption: var(--frontier-font-size-caption, 0.78em);
}
html, body { height: 100%; }
body { margin: 0; overflow: hidden; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.chat :where(.sidebar, .sidebar > *, .chat-list, .chat-list *, .main, .main > *, .transcript > *, .composer *, .conversation-header *, .new-chat form > *, .new-chat .grid > *, .new-chat .field > *, .new-chat fieldset > *, .notice *, .empty > *, details *) { margin-block: 0; }
.transcript > .message-agent :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4) + :is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4) { margin-block-start: 0.75em; }
.chat { display: grid; grid-template-columns: 300px minmax(0, 1fr); height: 100vh; }
.chat.panel { grid-template-columns: 1fr; }
.sidebar { display: flex; flex-direction: column; min-width: 0; background: var(--chat-sidebar); }
.sidebar header { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 14px 14px 8px; }
.sidebar h1 { font-size: 1rem; margin: 0; }
.sidebar .search { margin: 0 14px 8px; }
.sidebar .search input { width: 100%; }
.chat-list { list-style: none; margin: 0; padding: 0 8px 12px; overflow-y: auto; flex: 1; }
.chat-list h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--chat-muted); margin: 14px 8px 4px; }
.chat-list button.entry { display: grid; height: auto; color: inherit; font-weight: inherit; grid-template-columns: 1fr auto; gap: 2px 8px; width: 100%; text-align: start; background: transparent; padding: 8px 10px; border-radius: 8px; }
.chat-list button.entry[aria-current="true"] { background: var(--chat-card); box-shadow: var(--chat-shadow); }
.chat-list .entry-title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-list .entry-meta { grid-column: 1 / -1; color: var(--chat-muted); font-size: 0.85em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.state { font-size: 0.78em; font-weight: 600; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; color: var(--chat-muted); }
.state::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.state[data-state="running"] { color: var(--chat-accent); }
.state[data-state="running"]::before { animation: pulse 1.2s ease-in-out infinite; }
.state[data-state="queued"] { color: var(--chat-warning); }
.state[data-state="inactive"] { color: var(--chat-warning); }
.state[data-state="released"]::before { background: transparent; border: 1.5px solid currentColor; }
@keyframes pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .state[data-state="running"]::before, .typing span { animation: none; } }

.main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.empty { margin: auto; max-width: 30rem; text-align: center; display: grid; gap: 10px; justify-items: center; padding: 32px; }
.empty svg { width: 44px; height: 44px; color: var(--chat-muted); }
.empty h2 { margin: 0; font-size: 1.15rem; }
.empty p { margin: 0; color: var(--chat-muted); }

.conversation-header { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 12px 18px; background: var(--chat-page); box-shadow: var(--chat-shadow); z-index: 1; }
.conversation-header .titles { flex: 1 1 16rem; min-width: 0; }
.conversation-header h2 { margin: 0; font-size: 1.05rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.conversation-header .meta { color: var(--chat-muted); font-size: 0.85em; }
.conversation-header .controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.conversation-header label.inline { display: inline-flex; gap: 6px; align-items: center; color: var(--chat-muted); font-size: 0.85em; }
.usage { display: inline-flex; gap: 6px; align-items: center; color: var(--chat-muted); font-size: 0.85em; }
.usage meter { width: 70px; }

.notice { margin: 10px 18px 0; padding: 10px 14px; border-radius: var(--chat-radius); background: var(--chat-card); display: flex; gap: 10px; align-items: flex-start; }
.notice[data-tone="warning"] { box-shadow: inset 3px 0 0 var(--chat-warning); }
.notice[data-tone="danger"] { box-shadow: inset 3px 0 0 var(--chat-danger); }
.notice[data-tone="info"] { box-shadow: inset 3px 0 0 var(--chat-accent); }
.notice p { margin: 0; flex: 1; }
.notice strong { display: block; }

.transcript { flex: 1; overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 14px; scroll-behavior: auto; }
.transcript > * { max-width: 52rem; width: 100%; margin-inline: auto; content-visibility: auto; contain-intrinsic-size: auto 60px; }
.message-user { align-self: flex-end; background: var(--chat-selected); border-radius: 14px 14px 4px 14px; padding: 10px 14px; max-width: min(40rem, 85%); width: auto; margin-inline: auto 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.message-user .attachments { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.message-agent { overflow-wrap: anywhere; }
.message-agent > :first-child { margin-top: 0; }
.message-agent > :last-child { margin-bottom: 0; }
.message-agent pre { position: relative; background: var(--chat-card); border-radius: 8px; padding: 10px 72px 10px 12px; overflow-x: auto; }
.message-agent pre button.copy { position: absolute; top: 6px; right: 6px; font-size: 0.75em; padding: 2px 8px; opacity: 0.8; }
.message-agent :not(pre) > code { background: var(--chat-card); border-radius: 4px; padding: 1px 4px; }
.message-agent table { border-collapse: collapse; }
.message-agent th, .message-agent td { padding: 4px 10px; background: var(--chat-card); }
.message-agent img { max-width: 100%; border-radius: 8px; }
.message-agent blockquote { margin: 0; padding-left: 12px; box-shadow: inset 3px 0 0 var(--chat-fill); color: var(--chat-muted); }
details.thinking, details.tool { background: var(--chat-card); border-radius: var(--chat-radius); }
details.thinking > summary, details.tool > summary { cursor: pointer; padding: 8px 12px; display: flex; gap: 10px; align-items: center; color: var(--chat-muted); font-size: 0.9em; }
details.thinking .body { padding: 0 14px 12px; white-space: pre-wrap; color: var(--chat-muted); font-size: 0.92em; }
details.tool .glyph { font-family: var(--chat-font-code); width: 1.2em; text-align: center; }
details.tool .name { color: var(--chat-text); font-weight: 600; }
details.tool .summary-input { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; font-family: var(--chat-font-code); font-size: 0.85em; }
details.tool .body { padding: 0 14px 12px; display: grid; gap: 8px; }
details.tool .body h3 { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.06em; color: var(--chat-muted); margin: 6px 0 0; }
details.tool pre { margin: 0; background: var(--chat-page); border-radius: 8px; padding: 8px 10px; overflow-x: auto; max-height: 24rem; white-space: pre-wrap; overflow-wrap: anywhere; }
details.tool pre[data-error="true"] { box-shadow: inset 3px 0 0 var(--chat-danger); }
.tool-state { font-size: 0.8em; font-weight: 600; }
.tool-state[data-status="failed"] { color: var(--chat-danger); }
.tool-state[data-status="completed"] { color: var(--chat-success); }
.tool-state[data-status="in_progress"], .tool-state[data-status="pending"] { color: var(--chat-accent); }
.diff { font-family: var(--chat-font-code); font-size: 0.85em; background: var(--chat-page); border-radius: 8px; overflow-x: auto; }
.diff .path { padding: 6px 10px; color: var(--chat-muted); }
.diff .line { white-space: pre; padding: 0 10px; }
.diff .line[data-sign="+"] { background: color-mix(in srgb, var(--chat-success) 14%, transparent); }
.diff .line[data-sign="-"] { background: color-mix(in srgb, var(--chat-danger) 14%, transparent); }
.diff .line[data-sign="…"] { color: var(--chat-muted); }
.plan { background: var(--chat-card); border-radius: var(--chat-radius); padding: 10px 14px; }
.plan h3 { margin: 0 0 6px; font-size: 0.85em; color: var(--chat-muted); }
.plan ol { margin: 0; padding-left: 1.4em; display: grid; gap: 3px; }
.plan li[data-status="completed"] { color: var(--chat-muted); text-decoration: line-through; }
.plan li[data-status="in_progress"] { font-weight: 600; }
.plan .priority { font-size: 0.75em; color: var(--chat-muted); margin-left: 6px; }
.event-line { color: var(--chat-muted); font-size: 0.85em; text-align: center; }
.event-error { background: var(--chat-card); box-shadow: inset 3px 0 0 var(--chat-danger); border-radius: var(--chat-radius); padding: 10px 14px; }
.attachment { display: inline-flex; gap: 6px; align-items: center; background: var(--chat-fill); border-radius: 8px; padding: 4px 8px; font-size: 0.85em; max-width: 100%; }
.attachment img { max-height: 160px; max-width: 100%; border-radius: 6px; display: block; }
.typing { display: inline-flex; gap: 4px; align-items: center; color: var(--chat-muted); font-size: 0.9em; }
.typing span { width: 6px; height: 6px; border-radius: 50%; background: currentColor; animation: pulse 1.2s ease-in-out infinite; }
.typing span:nth-child(2) { animation-delay: 0.2s; }
.typing span:nth-child(3) { animation-delay: 0.4s; }
.jump { position: sticky; bottom: 0; align-self: center; width: auto; box-shadow: var(--chat-shadow); }

.composer { padding: 10px 18px 16px; background: var(--chat-page); }
.composer-box { max-width: 52rem; margin: 0 auto; background: var(--chat-card); box-shadow: var(--chat-shadow); border-radius: 14px; padding: 8px; display: grid; gap: 6px; }
.composer-box:focus-within { box-shadow: 0 0 0 2px var(--chat-focus); }
.composer textarea { width: 100%; resize: none; border: none; background: transparent; padding: 6px 8px; max-height: 40vh; min-height: 2.6em; outline: none; }
.composer .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.composer .row .spacer { flex: 1; }
.composer .status { color: var(--chat-muted); font-size: 0.85em; display: inline-flex; gap: 8px; align-items: center; }
.composer .chips { display: flex; flex-wrap: wrap; gap: 6px; }
.composer .chips:empty { display: none; }
.composer .hint { max-width: 52rem; margin: 6px auto 0; color: var(--chat-muted); font-size: 0.8em; }
.composer .problem { max-width: 52rem; margin: 6px auto 0; color: var(--chat-danger); font-size: 0.9em; }
.composer .problem:empty, .composer .hint:empty { display: none; }
.composer.dragging .composer-box { box-shadow: 0 0 0 2px var(--chat-accent); }

.new-chat { overflow-y: auto; padding: 28px 18px; }
.new-chat form { max-width: 44rem; margin: 0 auto; display: grid; gap: 14px; }
.new-chat h2 { margin: 0; font-size: 1.25rem; }
.new-chat .lead { margin: 0; color: var(--chat-muted); }
.new-chat textarea { min-height: 7em; width: 100%; resize: vertical; }
.new-chat .field { display: grid; gap: 4px; }
.new-chat .field > label { font-weight: 600; font-size: 0.9em; }
.new-chat .field small { color: var(--chat-muted); }
.new-chat .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr)); gap: 12px; }
.new-chat details.options { background: var(--chat-card); border-radius: var(--chat-radius); padding: 10px 14px; }
.new-chat details.options > summary { cursor: pointer; list-style: none; display: flex; gap: 8px; align-items: baseline; }
.new-chat details.options > summary::-webkit-details-marker { display: none; }
.new-chat details.options[open] > summary { margin-bottom: 12px; }
.new-chat .summary-text { color: var(--chat-muted); font-size: 0.9em; }
.new-chat fieldset { border: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.new-chat legend { font-weight: 600; font-size: 0.9em; padding: 0; margin-bottom: 4px; }
.new-chat .choices { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.new-chat .actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.message { padding: 10px 14px; border-radius: var(--chat-radius); background: var(--chat-card); }
.message[data-tone="danger"] { box-shadow: inset 3px 0 0 var(--chat-danger); }
.message[data-tone="warning"] { box-shadow: inset 3px 0 0 var(--chat-warning); }
.message[data-tone="success"] { box-shadow: inset 3px 0 0 var(--chat-success); }
.message:empty { display: none; }

.panel .sidebar, .panel .main { height: 100vh; }
.panel button { min-height: 44px; padding: 8px 14px; }
.panel .chat-list button.entry { padding: 12px; }
.panel select, .panel input, .panel textarea { min-height: 44px; }
.panel .conversation-header { padding: 10px 12px; }
.panel .transcript { padding: 12px; }
.panel .composer { padding: 8px 10px 12px; }
.list-empty { padding: 8px 10px; color: var(--chat-muted); font-size: var(--chat-small); }
.more { position: relative; }
.more > summary { list-style: none; cursor: pointer; padding: 8px 14px; border-radius: 8px; color: var(--chat-muted); }
.more > summary::-webkit-details-marker { display: none; }
.more[open] > .menu { position: absolute; right: 0; top: 100%; z-index: 2; display: grid; min-width: 12rem; padding: 6px; background: var(--chat-card); border-radius: var(--chat-radius); box-shadow: var(--frontier-shadow-overlay, 0 8px 24px rgba(0, 0, 0, 0.16)); }
.more .menu button { justify-content: flex-start; text-align: start; }
.panel .composer .status { flex-basis: 100%; order: -1; }
`;

export const fallbackCss = `
body { background: var(--chat-page); color: var(--chat-text); font-family: var(--chat-font); font-size: 15px; line-height: 1.5; color-scheme: light dark; }
:focus-visible { outline: 2px solid var(--chat-focus); outline-offset: 2px; }
button, select, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; border: none; border-radius: 8px; padding: 6px 12px; background: var(--chat-fill); display: inline-flex; align-items: center; gap: 6px; }
button:disabled { opacity: 0.55; cursor: default; }
button[data-variant="primary"] { background: var(--chat-accent); color: var(--chat-on-accent); font-weight: 600; }
button[data-variant="ghost"] { background: transparent; color: var(--chat-muted); }
button[data-variant="ghost"]:hover:not(:disabled) { background: var(--chat-fill); color: var(--chat-text); }
button[data-variant="danger"] { background: var(--chat-danger); color: #fff; }
button[data-tone="danger"] { color: var(--chat-danger); }
select, input:not([type="checkbox"], [type="radio"]), textarea { background: var(--chat-card); border: 1px solid var(--chat-fill); border-radius: 8px; padding: 6px 10px; }
code, pre, kbd { font-family: var(--chat-font-code); font-size: 0.9em; }
details > summary { list-style: none; }
details > summary::-webkit-details-marker { display: none; }
details:not(.more) > summary::before { content: '▸'; font-size: 0.8em; transition: transform 80ms; }
details[open]:not(.more) > summary::before { transform: rotate(90deg); }
@media (prefers-color-scheme: dark) {
  :root {
    --chat-page: #1d1c1a; --chat-sidebar: #191816; --chat-card: #272522; --chat-fill: #34312c; --chat-selected: #322d4a;
    --chat-text: #eeebe5; --chat-muted: #a8a298; --chat-accent: #a99bf5; --chat-accent-text: #b9adf7; --chat-on-accent: #17141f;
    --chat-success: #7fcf8f; --chat-warning: #e8b75a; --chat-danger: #f08a80; --chat-info: #8fb3f0; --chat-focus: #a99bf5;
  }
}
`;
