---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand app uninstall"
sidebarTitle: "app uninstall"
description: "Uninstall an app and its data over USB, like Remove App > Delete App"
---

## Usage

```bash
ghosthand app uninstall <bundle id>
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Its data is deleted. Ask the user first unless the task says to remove it. Bundle ids come from app list.

## Examples

```bash
$ ghosthand app uninstall -l 42 com.example.app
```

## MCP tool

The same command is the MCP tool [`app-uninstall`](/docs/mcp/app-uninstall); flags are arguments.
