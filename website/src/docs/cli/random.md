---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand random"
sidebarTitle: "random"
description: "Make a random name, lastname, username, birthdate (18+) or password for a new account, saved with the lease. `random list` shows every saved value"
---

## Usage

```bash
ghosthand random <kind>
ghosthand random list
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Use it when you create an account and the user gave no name or details. Never invent
a password yourself.
  name, lastname  common US first or last name, e.g. Emma, Carter
  username        name + lastname of this lease (newest) + 4 digits, max 15 chars,
                  lowercase, e.g. emmacarter4821. Also the email username (before @)
  birthdate       YYYY-MM-DD, age 19-45, so always 18+
  password        16 chars: uppercase, lowercase, digits, !@#$%*; starts uppercase
  list            every saved value, newest first, with its iPhone, lease and reason
- stdout is only the value. Each value is saved in ~/.ghosthand/state.db with the
  lease's --reason, label and iPhone, and never deleted. Forgot one (compacted
  context, crash)? Run `random list`. Name the site in --reason at acquire, so the
  list shows what each value is for.
- Making a value needs -l. list does not; with -l it shows only that lease.

## Examples

```bash
$ ghosthand random -l 42 name  # e.g. Emma
$ ghosthand random -l 42 password
$ ghosthand random list
```

## MCP tool

The same command is the MCP tool [`random`](/docs/mcp/random); flags are arguments.
