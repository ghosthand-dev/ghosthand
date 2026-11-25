---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand app catalog"
sidebarTitle: "app catalog"
description: "List the apps `app install --app <id>` installs, and which the iPhone has"
---

## Usage

```bash
ghosthand app catalog
```

## Options

| Option | Description |
| --- | --- |
| `--json` | Print JSON |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Each line: &lt;id&gt;  &lt;name&gt;  &lt;bundle id&gt;  [installed] | [installing]
The list comes from ghosthand.dev, so it grows without a ghosthand update.

## Examples

```bash
$ ghosthand app catalog -l 42
```

## MCP tool

The same command is the MCP tool [`app-catalog`](/docs/mcp/app-catalog); flags are arguments.
