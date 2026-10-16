---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand rename"
sidebarTitle: "rename"
description: "Set the iPhone's name over USB (Settings > General > About > Name), no touch needed"
---

## Usage

```bash
ghosthand rename <name>
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Works while locked. The id does not change; input and the Bluetooth link keep working.
- `list` and `acquire -d` use the new name at once. macOS screen capture keeps the old name
  until the cable is unplugged and plugged in again (QuickTime, logs).

## Examples

```bash
$ ghosthand rename -l 42 "iPhone XR"
```

## MCP tool

The same command is the MCP tool [`rename`](/docs/mcp/rename); flags are arguments.
