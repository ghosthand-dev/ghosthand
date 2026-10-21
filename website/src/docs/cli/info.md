---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand info"
sidebarTitle: "info"
description: "Show battery, storage, iOS build, serial number, language, time zone and SIM over USB (works while locked)"
---

## Usage

```bash
ghosthand info
```

## Options

| Option | Description |
| --- | --- |
| `--json` | Print JSON |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

- sim tray: the physical SIM tray. `SIM card in`, `empty`, `no tray` or `unknown`.
  An eSIM does not use the tray.
- sim line &lt;slot&gt;: one per SIM iOS reads (physical or eSIM), with its carrier bundle and
  MCC/MNC. `sim lines: none read`: iOS reads no SIM. A line does not prove cellular
  service works (SIM PIN, activation, plan): check Settings &gt; Cellular.
- A missing sim field means the iPhone did not report it, not that there is no SIM.

## Examples

```bash
$ ghosthand info -l 42
```

## MCP tool

The same command is the MCP tool [`info`](/docs/mcp/info); flags are arguments.
