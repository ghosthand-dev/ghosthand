---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand tunnel url"
sidebarTitle: "tunnel url"
description: "Print this Mac's tunnel URL, to call the HTTP API from a script on another computer. --new-token also creates the API token"
---

## Usage

```bash
ghosthand tunnel url [--new-token] [--name <label>]
```

## Options

| Option | Description |
| --- | --- |
| `--new-token` | Create an API token and print `export GHOSTHAND_URL=...` and `export GHOSTHAND_TOKEN=...` |
| `--name [label]` | With --new-token: a label to recognise the token (default: tunnel-token) |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

While this Mac is signed in, the daemon keeps a connection to ghosthand.dev. The URL
is https://ghosthand.dev/macs/&lt;mac&gt;: the same API as the local socket (openapi.yaml)
plus an API token. It stays the same while the Mac keeps its name and session.
- Use it from any computer: `ghosthand --url <url> --token <token> list`, or curl
  with `Authorization: Bearer <token>`. With GHOSTHAND_URL and GHOSTHAND_TOKEN set, the
  CLI needs no flags. `acquire` there prints a local id like r1; later commands need
  only -l r1.
- A token works for every Mac of the account and is shown once. Store it like a password.
  Revoke it with `ghosthand tunnel revoke <id>` (the id goes to stderr).
- Only on the daemon's Mac. Through the tunnel a request body is at most 20 MB, and
  MCP leases are `<mac>:<number>`, while on this API the id stays `42`.
- Signed out or connecting: run `ghosthand setup` or try again in a few seconds.

## Examples

```bash
$ ghosthand tunnel url
$ ghosthand tunnel url --new-token --name ci  # copy the two export lines to the other computer
```
