# Smart Notify

A SillyTavern extension that gives you **full control over notifications (toasts)**.

SillyTavern and many extensions spam notifications through `toastr`, and there's
often no way to turn them off unless the author bothered to add a switch.
**Smart Notify intercepts every toast** before it shows, so you can mute the ones
you don't want — and restyle the ones you keep.

## Features

- **Mobile-friendly** — the panel is a proper modal that opens full-screen on
  phones (anchored below SillyTavern's top bar, respects safe-area insets) with
  bigger touch targets. On desktop it's a side drawer.
- **Live notification log** — a panel listing every toast (shown *and* blocked),
  color-coded by type, with timestamps and *edited* markers. A **search box**
  filters the log live (handy when console capture fills it with detail).
- **One-click mute** — hit the mute button on any logged notification to create a
  rule that hides future matches.
- **Rule engine** — match by plain text or `/regex/i`, scoped to a specific type
  (success / info / warning / error) or any type. Each rule can:
  - **mute** (block),
  - **allow** (force-show, overriding mutes), or
  - **rewrite** the toast text (plain replace or regex with `$1` groups).
  Per-rule hit counters.
- **Notification themes** — one-tap colour presets (Dark, Light, Coffee, Nude,
  Dracula, Midnight, Forest, Rose, Ocean, AMOLED, Sunset, Mono) picked from a
  swatch grid right in the **Extensions** settings card. Fine-tune any preset
  afterwards in the panel's Look tab.
- **Global type mute** — instantly silence all `info`, `success`, etc.
- **Appearance overrides** — change toast **position** (including a fully custom
  X/Y you can set by **dragging a ghost** to where toasts should appear),
  **width**, **font size**, **display duration** (0 = sticky), **opacity**, and a
  full **color/theme override** (background, text, border color, border width,
  corner radius).
- **Anti-spam** — collapse identical toasts fired in a burst (configurable
  window) and/or throttle the total toast rate (max N per X seconds). With
  **repeat grouping** on, bursts don't vanish silently — the existing log entry
  gets a devtools-style **×N counter** instead.
- **Capture console → Log** — a toast often says something terse like *"API
  returned an error"*, while the **full details** (status, response body, stack
  trace) get printed to the browser console. Turn this on to pull those detailed
  `console.error`/`warn`/`log` lines **into the Smart Notify Log panel** so you
  can read and copy the real error without opening devtools. Pick which console
  levels to capture; console entries get a <i>terminal</i> chip and a copy button.
  > This reads the **browser** console only. The Termux/node **server** process
  > log lives in a separate process and can't be read from a page extension.
- **Export / import** — back up and restore all rules and settings as JSON.
- **Bilingual (EN / RU)** — the UI auto-detects your SillyTavern locale; Russian
  users get Russian, everyone else gets English. Strings live in `i18n/`.
- **Polished settings block** — a clean card in the **Extensions** tab with the
  open-panel button, the theme swatch grid, and grouped toggles (general,
  mute-by-type, console).
- Everything persists in your SillyTavern settings.

## Usage

1. Install the extension (see below).
2. Open the panel from the **wand menu** (the magic-wand icon near the chat bar)
   → **Smart Notify**, or via *Extensions → Smart Notify → Open panel*.
3. **Log tab** — watch notifications arrive; click the mute icon to silence
   anything like it.
4. **Rules tab** — add precise text/regex rules (mute / allow / rewrite), toggle
   or delete them.
5. **Look tab** — enable *Override toast appearance* and tune position/size/colors.
6. **More tab** — capture-console-into-log, anti-spam (dedupe + grouping +
   throttle), and export/import of your config.

## Installation

In SillyTavern: **Extensions → Install Extension**, then paste:

```
https://github.com/Nufahi/ST-SmartNotify
```

## How it works

Smart Notify wraps `toastr.success/info/warning/error`. Each call is logged and
checked against your rules; blocked toasts are swallowed, allowed toasts pass
through (with optional appearance overrides applied). The original methods are
restored if the extension is reloaded.

> Note: notifications that don't go through `toastr` (e.g. native browser alerts)
> are outside this extension's reach.

## Project layout

The code is split into ES modules loaded by `index.js` (the entry point):

```
index.js                    # entry: toastr interception + wiring
modules/constants.js        # shared constants & small helpers
modules/i18n.js             # translation layer
modules/settings.js         # defaults, deep merge, accessors
modules/rules.js            # rule engine (match / rewrite / evaluate)
modules/antispam.js         # burst dedupe + grouping + throttle
modules/log.js              # notification log + repeat grouping
modules/console-capture.js  # capture browser console into the log
modules/appearance.js       # toast CSS overrides + drag-to-position
modules/ui.js               # the drawer panel and all its renders
```

## License

MIT
