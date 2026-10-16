---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand app list"
sidebarTitle: "app list"
description: "List installed apps over USB, with where each icon is on the Home Screen"
---

## Usage

```bash
ghosthand app list
```

## Options

| Option | Description |
| --- | --- |
| `--system` | Also list Apple's built-in apps |
| `--json` | Print JSON |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Each line: &lt;bundle id&gt;  &lt;name&gt; &lt;version&gt;  [installing]  [file sharing]  (&lt;place&gt;)
- place: dock, page N, or page N, folder &lt;name&gt;. "App Library only": not on a page.
  Open any app with `key cmd+space`, `type <name>`, `key enter`.
- [installing]: an App Store download that is not finished. Trust this, not the
  App Store's button label (it can show Resume while it downloads).
- [file sharing]: file commands reach its Documents with --app &lt;bundle id&gt;.
- Apps cannot be opened over USB without Developer Mode: tap the icon.

## Examples

```bash
$ ghosthand app list -l 42
```

## MCP tool

The same command is the MCP tool [`app-list`](/docs/mcp/app-list); flags are arguments.
