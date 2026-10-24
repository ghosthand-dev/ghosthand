---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand key"
sidebarTitle: "key"
description: "Press a key on the Bluetooth keyboard: home (Home Screen), enter, backspace, esc, arrows, volumeup. cmd+space opens Spotlight to open apps"
---

## Usage

```bash
ghosthand key <combo>
```

## Options

| Option | Description |
| --- | --- |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--wait-text [text]` | After input, poll real OCR for this case-insensitive substring; never repeat input |
| `--timeout-ms [ms]` | With --wait-text: verification deadline, 1...60000 ms (default: 5000); starts after input completes |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Keys: home, enter, backspace (or delete), forwarddelete, esc, tab, space, up, down,
left, right, pageup, pagedown, end, volumeup, volumedown, playpause, and
combos like cmd+a, shift+tab. Modifiers: cmd, shift, alt (option), ctrl, fn (Globe).
fn alone is a Globe tap. Keys in a combo go down in order: tab+h holds tab, then h.
- Replace text in a field: `key cmd+a` selects all of it, then `key backspace` deletes it.
- iOS keyboard shortcuts (iPad shortcuts; most work on iPhone, check the screen after):
  cmd+a                      select all
  alt+backspace              delete the previous word
  cmd+backspace              delete to start of line
  shift+left                 extend selection by one letter
  cmd+left / cmd+right       go to start / end of line
  cmd+shift+left / right     select to start / end of line
  cmd+up / cmd+down          go to start / end of the text
  cmd+shift+up / down        select to start / end of the text
  cmd+c, cmd+v, cmd+z        copy, paste, undo
  tab / shift+tab            next / previous field or focused item
  space                      activate the focused item
  esc                        dismiss menus, suggestions, some dialogs
  cmd+l, cmd+f, cmd+r        Safari: address bar, find on page, reload
  cmd+space                  Spotlight: then `type Files`, `key enter` opens the app
  fn+h                       Home Screen
  fn+up                      App Switcher
  fn+c, fn+n                 Control Center, Notification Center
- Full Keyboard Access (user setting, off by default; never turn it on yourself):
  tab+f finds an item by name (Enter opens it), tab+b goes back, tab+h lists all
  commands, tab/arrows/space move focus and activate. The first Tab focuses the
  AssistiveTouch button. A command can do nothing once; check the screen. Never send
  ctrl+alt+shift+cmd+s (Emergency SOS) or ctrl+alt+shift+cmd+r (restart).
- fn+h only types "h": the iPhone was paired with an older ghosthand whose report
  map dropped fn. Forget the Mac on the iPhone and pair again (`ghosthand forget --help`).
- No `key mute`: the Mute key is a toggle. Use `ghosthand mute` / `unmute`.
- home is the keyboard Home key (HID consumer Menu): no AssistiveTouch setup. Leaving
  an app opened from Spotlight shows Spotlight again; press home once more for the
  Home Screen. Press it again if an app was still opening.
- No verified global Back key. esc sends Escape, not a guaranteed navigation Back.
- pagedown/pageup scroll Safari pages after a tap on the text, not app lists (Settings).
- enter sends a message in Messages when the text field has focus.
- XCTest mode: home, volumeup, volumedown, enter, backspace, tab, space, and shortcuts
  with cmd, shift, ctrl, alt (cmd+space opens Spotlight; cmd+a, cmd+c, cmd+v work in
  text fields). Other keys fail with unsupported-in-mode.

## Examples

```bash
$ ghosthand key -l 42 home --screenshot s.png --screentext
$ ghosthand key -l 42 enter
```

## MCP tool

The same command is the MCP tool [`key`](/docs/mcp/key); flags are arguments.
