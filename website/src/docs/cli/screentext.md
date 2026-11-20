---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand screentext"
sidebarTitle: "screentext"
description: "Read the text on the iPhone screen with on-device OCR. One line per text: `x,y wxh text` in screenshot coordinates (same space as tap)"
---

## Usage

```bash
ghosthand screentext
```

## Options

| Option | Description |
| --- | --- |
| `--json` | Print the full JSON (lines with confidence, screen size) |
| `--language [tag]` | OCR language, e.g. it-IT; en-US is always included. Env: GHOSTHAND_LANGUAGE |
| `--settle` | Wait (up to 2s) until the screen stops changing |
| `--scale [n]` | Image and coordinate size as a fraction of native pixels (default: screen points, 1/2 or 1/3; 1 = native). Env: GHOSTHAND_SCALE |
| `--wait-text [text]` | Poll OCR until a line contains this case-insensitive substring, then print that screen; sends no input |
| `--timeout-ms [ms]` | With --wait-text: deadline, 1...60000 ms (default: 5000) |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Output: one line per text, `x,y wxh text`, top-left corner and size in screen
points. The center of a line is x+w/2, y+h/2. To tap text, use
`ghosthand tap --text "..."`, which does this for you.
Use --wait-text to wait for something slow without an input (an upload, a
download, a reply). On timeout it fails with wait-text-timeout; read the screen.
Add --language for non-English UIs (it-IT, de-DE, ...) or accents are misread.
Body text and labels read at about 99% of words. Not read: red badge counts
(Mail "6"), icons (read as stray letters like "Q", "A", "4"), text cut by
an edge. Text inside photos comes out garbled. Use a screenshot for these.

## Examples

```bash
$ ghosthand screentext -l 42
$ ghosthand screentext -l 42 --language it-IT --json
$ ghosthand screentext -l 42 --wait-text Posted --timeout-ms 30000
```

## MCP tool

The same command is the MCP tool [`screentext`](/docs/mcp/screentext); flags are arguments.
