---
title: Onboarding flows
description: Every way a new user starts with ghosthand (landing page prompt, remote MCP bot, download page, CLI), each step from the user and the agent side, and the exact error or status the agent gets in every empty state.
---

# Onboarding flows

**One rule: the agent always knows the next step.** Every empty state (no Mac, Mac offline,
no iPhone, iPhone not set up, plan limit) answers with one thing the user must do, in words
the agent can pass on, plus a link when one helps. The agent never does setup for the user.

| Flow | Starts in | Agent runs on | Agent waits with |
| --- | --- | --- | --- |
| [1. Copy setup prompt](#1-copy-setup-prompt-landing-page) | ghosthand.dev hero | the user's Mac | `ghosthand setup status` |
| [2. Remote MCP bot](#2-remote-mcp-bot-grok-bot-claudeai-chatgpt) | Grok bot, claude.ai, ChatGPT | another machine | MCP `setup-status` |
| [3. Download page](#3-download-page-human-first) | ghosthand.dev/download | none yet | the setup window |
| [4. CLI first](#4-cli-first-agent-already-has-a-shell) | `npx ghosthand list` | the user's Mac | `ghosthand setup status` |
| [5. More iPhones or Macs](#5-a-second-iphone-or-a-second-mac) | `acquire` | any | none: the user subscribes |

All flows end in the same **setup window** on the Mac. Its screens, in order:

```
sign in ──> permissions ──> connect ──> trust ──> unlock ──> pair ──> connecting ──> ready
(Google)    (Camera,        (USB        (tap      (Face ID  (Settings  (Bluetooth     (copy
            Bluetooth)      cable)      Trust)    or code)  > Bluetooth) link up)     prompt)
```

The **pair** screen, `next`, `ghosthand` input help and the pairing steps all carry one tip:
"If the Mac is not listed, turn Bluetooth off and on again on the iPhone."

`setup status` returns the same screen as `next`, one sentence for the user, so an agent that
cannot see the Mac still guides the user. The text lives in `Controller.nextStep`
(`daemon/Sources/ghosthand/controller.swift`), the screen choice in `SetupScreen`.

## 1. Copy setup prompt (landing page)

The hero on ghosthand.dev has **Copy setup prompt** (`website/src/components/hero-section.tsx`).
The user pastes it into a local agent: Claude Code, Codex, opencode.

```
user                          local agent (on the Mac)                   Mac
────                          ────────────────────────                   ───
paste prompt ───────────────> uname = Darwin? ── no ──> "open ghosthand.dev/download on
                              │                          your Mac, add ghosthand.dev/mcp"
                              │ yes                      (flow 2), stop
                              ▼
                              npx -y ghosthand@latest setup ─────────> installs Ghosthand.app,
                              │                                         starts the daemon,
                              │                                         opens the setup window
                              ├─ npx skills add https://ghosthand.dev   (in parallel)
                              ▼
signs in, plugs iPhone, <──── poll `setup status` every 2 s,
taps Trust, pairs             say `next` when it changes
                              │ ready: true
                              ▼
sees a screenshot <────────── ghosthand list, screenshot
```

- **Sandbox:** the prompt asks the user to turn the agent sandbox off first (Codex: Full
  access). A sandbox blocks Launch Services, so the window cannot open.
- **Not on a Mac:** the agent installs nothing and sends the user to flow 2 or 3.
- After sign-in the setup window **comes back to the front** by itself: the browser had the
  focus for the Google approval (`pollOverview` in `setup-app.swift`).

## 2. Remote MCP bot (Grok bot, claude.ai, ChatGPT)

The bot runs on a server, never on the user's Mac. It only sees `https://ghosthand.dev/mcp`.
The user adds that URL as a connector; OAuth signs in with Google and **creates the account**.
So "no account" is not a state here: connecting is signing up.

```
user                    bot                     hub (website/src/tunnel.ts)      Mac
────                    ───                     ───────────────────────────      ───
adds connector ───────> OAuth (Google) ───────> account + personal org
                        initialize, tools/list > answered by the hub from
                                                 mcp-tools.json, instructions
                                                 start with the next step
"check my iPhone" ────> list ─────────────────> no Mac online: tool error
                                                 "send ghosthand.dev/download..."
opens link on Mac <──── "install Ghosthand on
                        your Mac: <link>"
installs .pkg ──────────────────────────────────────────────────────────────> setup window
signs in (same Google) ─────────────────────────────────────────────────────> daemon connects
                        setup-status every 10 s > forwarded to the Mac ──────> {ready, next}
plugs, trusts, pairs <─ says `next` when it
                        changes
                        setup-status ─────────> ready: true
                        list, acquire, screenshot ──────────────────────────> iPhone
```

### What each state answers

| State | Who answers | `list`, `acquire`, other tools | `setup-status` |
| --- | --- | --- | --- |
| No Mac ever signed in | hub | error: install from the download link, sign in with the same Google account, then the window's steps | `ready: false`, `next`: open the link on the Mac and sign in |
| Mac signed in, offline | hub (waits 5 s if it dropped in the last minute) | error: wake Mac X (last seen ...), open Ghosthand; or install on another Mac | `ready: false`, `next`: wake Mac X |
| Lease of an offline Mac, others online | hub | error: `X is offline. Online: ...`, wake X or acquire on an online Mac; an unknown slug says the account has no such Mac | same |
| Several Macs online, no `mac` | hub | `list` asks every Mac; others: error "pass mac" | error "pass mac" |
| Mac online, Camera not allowed | daemon | `permission-denied` + open setup, poll status | `next`: click Allow Camera and Allow Bluetooth |
| Mac online, iPhone never connected | daemon | `no-device` naming the Mac, first-time steps, open setup, poll status | `next`: plug the iPhone into Mac X |
| iPhone unplugged now | daemon | `no-device` with the USB check per iPhone | `next`: plug in |
| iPhone untrusted, locked, not paired | daemon | `list` shows it with its state, or `no-device` with the USB check when screen capture does not list it yet; input fails with `bluetooth-*` + setup hint | `next`: tap Trust / unlock / pair |
| Free plan already used by another iPhone | daemon, from `/api/cli/lease-check` | `subscription-required` with the subscribe and dashboard links | not checked: setup can be ready |
| ghosthand.dev unreachable from the Mac | daemon | `tunnel-offline` on acquire (a known iPhone still works) | unchanged |

Tool errors are MCP **results** with `isError: true`, not JSON-RPC errors: only results reach
the model. A `setup-status` with no Mac is **not** an error, so a bot keeps polling it.

### Waiting

Remote bots cannot sleep long inside one reply. The no-Mac text tells the bot both options:

1. Poll `setup-status` every 10 seconds for up to 15 minutes, telling the user `next` when it
   changes. It answers from the hub until a Mac connects, then from that Mac, with the same
   `ready` and `next` fields.
2. If it cannot wait, ask the user to say when the window shows the iPhone is ready.

The hub never pushes and never polls: each `setup-status` wakes the hub Durable Object once.
A 10 s interval keeps that cheap. The bot can also call the `setup` tool to open the window
on the Mac when the user is there but closed it.

## 3. Download page (human first)

`https://ghosthand.dev/download` downloads the signed `.pkg` on a Mac and shows **Copy link**
on a phone. The installer puts Ghosthand.app in `~/Applications` (no admin password) and
opens it. Details of the installer and upgrades: `docs/install-paths.md`.

```
download page ──> .pkg ──> postinstall `open -n` ──> setup window ──> sign in ──> window back
                                                                     (browser)    in front
   ──> permissions ──> connect iPhone ──> trust ──> pair ──> ready ──> "Copy prompt" button
                                                                       for any local agent
```

- Opening Ghosthand again from Finder shows **setup** until this Mac has a ready iPhone,
  then the control plane (`showFirstWindow`).
- The ready screen copies a prompt that installs the skill and takes a first screenshot.
- A user who came from a remote bot (flow 2) only needs to keep the window open: the bot
  sees `ready` through `setup-status`.

## 4. CLI first (agent already has a shell)

An agent that read the README or the skill runs commands directly. Every error says what to
do next, so it ends up in the same window:

```
ghosthand list ──> login-required? ──> `ghosthand setup`, tell user, poll setup status
               ──> permission-denied ──> same
               ──> no-device ─────────> same (first time: plug, unlock, Trust)
               ──> iPhone listed ─────> acquire ──> subscription-required? ──> show links
```

The setup hint is one string (`setupHint` in `daemon/Sources/ghosthand/api.swift`), added to
every connection error, so CLI and MCP say the same thing.

## 5. A second iPhone or a second Mac

**Free** covers one iPhone, on any Mac. **Pro** is $99/month per Mac with unlimited iPhones
there. The check runs only on `acquire` and `wait`, so setup always completes and a running
lease never stops.

```
acquire ──> lease-check (website/src/lib/billing.ts: leaseDecision)
              ├─ allowed ──> lease
              └─ not allowed ──> subscription-required:
                   "The free plan covers one iPhone: <name>. Remove it on the dashboard to
                    switch, or subscribe to Pro" + Subscribe link + Dashboard link
                    + "do not retry in a loop"
```

A second Mac just installs Ghosthand and signs in with the same Google account. `list` then
groups iPhones under each Mac, and leases carry the Mac (`studio:42`).

## Where the text lives

| Text | File |
| --- | --- |
| No Mac, Mac offline, `setup-status` without a Mac | `website/src/lib/mcp-routing.ts` (`noMacMessage`, `noMacSetupStatus`) |
| `next` for each setup screen | `daemon/Sources/ghosthand/controller.swift` (`nextStep`) |
| No iPhone, first-time steps | `daemon/Sources/ghosthand/controller.swift` (`noDevice`) |
| Setup hint on connection errors | `daemon/Sources/ghosthand/api.swift` (`setupHint`, `setupPollingHint`) |
| Plan limit | `website/src/lib/billing.ts` (message), `daemon/Sources/ghosthand/account.swift` (links) |
| Landing page prompt | `website/src/components/hero-section.tsx` |
| Ready screen prompt | `daemon/Sources/ghosthand/setup-app.swift` (`copyPrompt`) |

Change the text there, run `pnpm generate-docs` in `website/` when CLI help changed, and
update the snapshots in `website/src/lib/mcp-routing.test.ts` and
`daemon/Tests/ghosthandTests/device-join-tests.swift`.
