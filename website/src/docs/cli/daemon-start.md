---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand daemon start"
sidebarTitle: "daemon start"
description: "Start the background daemon. Other commands start it on demand"
---

## Usage

```bash
ghosthand daemon start
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

- Remote MCP: while this Mac is signed in, the daemon keeps a connection to ghosthand.dev
  (no port, works behind NAT). Add https://ghosthand.dev/mcp as a remote MCP server in
  Claude, Cursor or opencode and sign in with the same Google account. It reaches every
  signed-in Mac of the account; `daemon status` shows this Mac's name there.
- The CLI on any signed-in Mac reaches the iPhones of every Mac of the account through
  the same connection: `list` shows them, leases look like studio:42.
- Scripts (curl, other languages, Linux) call the HTTP API through it, see `ghosthand tunnel url`.
- ghosthand.dev relays the requests and responses (screenshots, typed text).
  Signing the Mac out (`ghosthand account logout` or the ghosthand.dev dashboard) closes the connection.

## Examples

```bash
$ ghosthand daemon start
```
