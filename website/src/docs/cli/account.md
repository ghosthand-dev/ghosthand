---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand account"
sidebarTitle: "account"
description: "Show this Mac's ghosthand.dev account: who is signed in, the plan, and the subscribe link"
---

## Usage

```bash
ghosthand account
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Every lease needs a signed-in account. Free for one iPhone; Pro is $99/month per Mac
for more iPhones and the daemon source. Only acquire and wait check it; a lease that
runs is never stopped. People (preview, Take Control) are never limited.
- signed out: run `ghosthand setup`. Tell the user to complete setup in its small
  window; do not interact with it. Poll `setup status` until ready.
- another iPhone than the plan covers: acquire fails with subscription-required.
  Show the user the subscribe and dashboard links, then acquire again after they
  change the plan. Never retry in a loop.
- Asks ghosthand.dev once per call (GHOSTHAND_SERVER at daemon start overrides it).
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
$ ghosthand account
```

## MCP tool

The same command is the MCP tool [`account`](/docs/mcp/account); flags are arguments.
