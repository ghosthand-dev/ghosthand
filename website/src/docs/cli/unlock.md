---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand unlock"
sidebarTitle: "unlock"
description: "Unlock with the Bluetooth keyboard: Enter, Enter, passcode, then check the lock state over USB (~3s). A wrong passcode is not retried"
---

## Usage

```bash
ghosthand unlock [passcode]
ghosthand unlock --stdin
```

## Options

| Option | Description |
| --- | --- |
| `--stdin` | Read the passcode without echo; strip one final LF or CRLF |
| `--screenshot [path]` | Save a screenshot after the action once the screen stops changing (default: screenshot.png); not available while locked |
| `--screentext` | Print the OCR text of the screen after the action (`x,y wxh text`, after --screenshot if both); uses --language |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Rules:
- Pipe a confirmed passcode directly to --stdin, not as an argument (arguments
  appear in logs and shell history). GHOSTHAND_PASSCODE is also supported.
  The local .passcode is stale; never read it. Use only the user-confirmed secret.
- The passcode must be nonempty printable US-ASCII: no newline or tab. stdin must be
  a pipe or file, not a terminal.
- A wrong passcode is not retried: failed attempts count toward the iPhone lockout.
- After an iPhone restart, unlock it by hand once; before that iOS ignores the
  Bluetooth keyboard.
- Not available in XCTest mode (unsupported-in-mode): ask the user to unlock.

## Examples

```bash
$ secret-provider | ghosthand unlock -l 42 --stdin
```

## MCP tool

The same command is the MCP tool [`unlock`](/docs/mcp/unlock); flags are arguments.
