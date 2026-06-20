# Smart Notify

A SillyTavern extension that gives you **full control over notifications (toasts)**.

SillyTavern and many extensions spam notifications through `toastr`, and there's
often no way to turn them off unless the author bothered to add a switch.
**Smart Notify intercepts every toast** before it shows, so you can mute the ones
you don't want — and restyle the ones you keep.

## Features

- **Live notification log** — a slide-out panel listing every toast (shown *and*
  blocked), color-coded by type, with timestamps.
- **One-click mute** — hit the mute button on any logged notification to create a
  rule that hides future matches.
- **Rule engine** — match by plain text or `/regex/i`, scoped to a specific type
  (success / info / warning / error) or any type. Each rule can **mute** (block)
  or **allow** (force-show, overriding mutes). Per-rule hit counters.
- **Global type mute** — instantly silence all `info`, `success`, etc.
- **Appearance overrides** — change toast **position** (including a fully custom
  X/Y), **width**, **font size**, **display duration** (0 = sticky), and
  **opacity** — independent of SillyTavern's defaults.
- Everything persists in your SillyTavern settings.

## Usage

1. Install the extension (see below).
2. Click the **floating bell button** (bottom-left) to open the panel, or use
   *Extensions → Smart Notify → Open panel*.
3. **Log tab** — watch notifications arrive; click the mute icon to silence
   anything like it.
4. **Rules tab** — add precise text/regex rules, toggle or delete them.
5. **Look tab** — enable *Override toast appearance* and tune position/size/etc.

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
