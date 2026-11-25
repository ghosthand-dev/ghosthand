---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand app install"
sidebarTitle: "app install"
description: "Install a catalog app (--app tiktok) from the App Store, or an .ipa signed for this iPhone over USB"
---

## Usage

```bash
ghosthand app install --app <id>
ghosthand app install <file.ipa>
```

## Options

| Option | Description |
| --- | --- |
| `--app [id]` | Catalog app id from `app catalog`, e.g. tiktok |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

--app: the daemon opens the app's App Store page (Spotlight), taps Get or the download
icon, and answers once `app list` shows it installed (minutes for big apps).
- Needs an Apple Account signed in to the App Store on the iPhone. If none is, the
  answer says so: ask the user to sign in, never use an account they did not give.
- No download after the tap: a sheet USB capture hides (Install, password, cellular
  data). Run `screenshot --native` to see it. The tap is never repeated.
- A cloud iPhone (lease cloud:&lt;n&gt;) gets the app from ghosthand.dev instead.
&lt;file.ipa&gt;: iOS checks the signature. App Store apps install only from the App Store
app (use --app), and an IPA signed for other devices fails with an error from iOS.
MCP: send the signed .ipa bytes as data (base64, up to about 3 MB), never source.
Use the REST install endpoint for larger IPAs.

## Examples

```bash
$ ghosthand app install -l 42 --app tiktok
$ ghosthand app install -l 42 MyApp.ipa
```

## MCP tool

The same command is the MCP tool [`app-install`](/docs/mcp/app-install); flags are arguments.
