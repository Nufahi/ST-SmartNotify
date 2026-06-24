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
  color-coded by type, with timestamps and *edited* markers.
- **One-click mute** — hit the mute button on any logged notification to create a
  rule that hides future matches.
- **Rule engine** — match by plain text or `/regex/i`, scoped to a specific type
  (success / info / warning / error) or any type. Each rule can:
  - **mute** (block),
  - **allow** (force-show, overriding mutes), or
  - **rewrite** the toast text (plain replace or regex with `$1` groups).
  Per-rule hit counters.
- **Global type mute** — instantly silence all `info`, `success`, etc.
- **Appearance overrides** — change toast **position** (including a fully custom
  X/Y), **width**, **font size**, **display duration** (0 = sticky), **opacity**,
  and a full **color/theme override** (background, text, border color, border
  width, corner radius).
- **Anti-spam** — drop identical toasts fired in a burst (configurable window)
  and/or throttle the total toast rate (max N per X seconds).
- **Capture console → Log** — the *reverse* of mirroring. A toast often says
  something terse like *"API returned an error"*, while the **full details**
  (status, response body, stack trace) get printed to the browser console.
  Turn this on to pull those detailed `console.error`/`warn`/`log` lines **into
  the Smart Notify Log panel** so you can read and copy the real error without
  opening devtools. Pick which console levels to capture; console entries get a
  <i>terminal</i> chip and a copy button.
  > This reads the **browser** console only. The Termux/node **server** process
  > log lives in a separate process and can't be read from a page extension.
- **Console mirror** — mirror every notification (full title + message) *out* to
  the console. On PC that's the browser devtools console; on phone it's the
  **Termux**/server log. Choose to log shown, blocked, or all. There's also a
  one-tap **Dump log to console** button.
- **Export / import** — back up and restore all rules and settings as JSON.
- Everything persists in your SillyTavern settings.

## Usage

1. Install the extension (see below).
2. Open the panel from the **wand menu** (the magic-wand icon near the chat bar)
   → **Smart Notify**, or via *Extensions → Smart Notify → Open panel*.
3. **Log tab** — watch notifications arrive; click the mute icon to silence
   anything like it, or the terminal icon to dump the log to console.
4. **Rules tab** — add precise text/regex rules (mute / allow / rewrite), toggle
   or delete them.
5. **Look tab** — enable *Override toast appearance* and tune position/size/colors.
6. **More tab** — capture-console-into-log, console mirroring, anti-spam
   (dedupe + throttle), and export/import of your config.

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

## License

MIT
