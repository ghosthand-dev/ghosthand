---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand account login"
sidebarTitle: "account login"
description: "Sign this Mac in to ghosthand.dev in the browser. For people; agents run `ghosthand setup` instead"
---

## Usage

```bash
ghosthand account login
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The setup window does the same with its Sign in button; prefer it. This command opens
the browser, prints the page and the code it shows, and waits until the browser
approves or denies. The daemon checks the server itself, so Ctrl-C does not stop the
sign-in. Only on the daemon's Mac (no --url).

## Examples

```bash
$ ghosthand account login
```
