---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand app install"
sidebarTitle: "app install"
description: "Install an .ipa signed for this iPhone over USB (ad hoc, enterprise or development signing)"
---

## Usage

```bash
ghosthand app install <file.ipa>
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

iOS checks the signature: App Store apps install only from the App Store app (tap Get),
and an IPA signed for other devices fails with an error from iOS.

## Examples

```bash
$ ghosthand app install -l 42 MyApp.ipa
```

## MCP tool

The same command is the MCP tool [`app-install`](/docs/mcp/app-install); flags are arguments.
