---
title: Lifecycle emails
description: Plain emails from Tommy that product events trigger, to move ghosthand users from signup to daily use and to Pro. Each email has its trigger, timing, subject, copy, the aha idea, and the data it still needs. Plan only; nothing sends yet.
---

# Lifecycle emails

**One idea per email, sent when a user stops at a step.** Each one is a short note from Tommy
with one use case or one small lesson, tied to a clear benefit: it saves time, it makes money,
or it takes a boring phone chore off your hands. Plan and copy only: no code sends these yet.

```
signup ──2h, no Mac──> A1 (A1-mcp if the user came from an AI chat)
  │
  ▼
Mac signed in ──24h, no lease──> A2 Trust and Bluetooth
  │
  ▼
first lease ──24h, fewer than 3 leases──> A3 one sentence as a phone task
  │
  ├──first phone task──> A4 your own agent, no monthly limit
  ▼
active (3+ leases on 2+ days) ──> B1 ──> B2 ──> B3 ──> B4 ──> B5       one idea each
  │                               day 2  day 5  day 9  day 14 day 21   after activation
  ▼
quiet 7 days ──> W1 one idea                quiet 30 days ──> W2 what stopped you (last one)

any time:  10 tasks used ──> M1      2nd iPhone refused ──> M2      checkout left ──> M3
           paid ──> M4 welcome ──48h quiet──> M5 personal help      Pro canceled ──> W3
```

| Id | Trigger | When | Subject | Goal |
| --- | --- | --- | --- | --- |
| A1 | signup, no Mac signed in | 2 h | Ghosthand needs your Mac for one step | Mac signs in |
| A2 | Mac signed in, no lease | 24 h | Two steps between your Mac and your iPhone | first lease |
| A3 | first lease, fewer than 3 leases | 24 h | Try one sentence on your iPhone | first phone task, active |
| A4 | first phone task | 10 min | Your own agent can drive the iPhone too | CLI or MCP input |
| B1 | active | day 2 | Jump in when your agent gets stuck | Take Control used |
| B2 | active | day 5 | Post a video to TikTok without touching your phone | `upload` used |
| B3 | active | day 9 | Control your iPhone from Claude or ChatGPT, anywhere | MCP input |
| B4 | active | day 14 | Run a phone chore every morning, on its own | API token created |
| B5 | active | day 21 | Let an agent test your iOS app and record it | `record start` used |
| M1 | `task_limit_reached` | now | You used your 10 phone tasks for this month | Pro, or own agent |
| M2 | `device_limit_reached` free | now | Ghosthand on more than one iPhone | Pro, or switch |
| M3 | checkout opened, not paid | 24 h | Did something stop you? | a reply |
| M4 | subscription active | now | Welcome to Ghosthand Pro | lease, GitHub access |
| M5 | Pro, no lease since paying | 48 h | Can I help you set up your first flow? | a reply, a lease |
| W1 | active before, no lease | 7 days | One idea for your iPhone this week | lease |
| W2 | no lease | 30 days | What stopped you? | a reply |
| W3 | Pro `cancel_at_period_end` | now | Sorry to see you go | a reply |

## Why these emails

From the Strada stats of Nov 9 (`strada query ... -p ghosthand`, last 21 days unless noted):

- **The biggest drop is after setup.** Signed in on the daemon: 82%. iPhone bound: ~65%. 20+ phone inputs: ~43%. A2 and A3 target this gap.
- **Phone tasks look sticky.** Users who ran a phone task: 15 of 31 active 3+ days (48%). Users with neither a task nor MCP: 23 of 68 (34%). This is correlation, not proof, but it is why A3 asks for a first task.
- **Limits do not convert.** 11 free orgs hit the task limit and 12 hit the iPhone limit; none subscribed. M1 and M2 show the value at the moment of need, M3 asks what stopped them.
- **2 of 3 paying users went silent 1-2 days after paying.** M4 and M5.
- **Good features few people find** (distinct users in 21 days): Take Control 36, task 49, MCP ~40, screen recording 14, `upload` 12, API tokens 3. The B emails teach these.

## Rules

- **From Tommy, plain Gmail style.** Follow the `transactional-email` skill: "Hey," then short paragraphs, links in full, sign-off "Tommy". Send a plain-text part too.
- **Reply-to a real inbox.** Every email asks for replies. The sender and reply-to are not decided yet (see open questions).
- **One stage email at a time.** A user gets only the A email of the stage they are in. Reaching the next stage cancels the pending one.
- **At most one email every 2 days.** M1, M2, M3, M4 and W3 answer something the user just did, so they skip this rule.
- **Each email once per user.** M1 once per month.
- **B only while active** (a lease in the last 7 days). A user who goes quiet moves to W1, which reuses the next unsent B idea.
- **Stop after W2** or an unsubscribe. One plain line at the bottom ("Don't want these emails? Unsubscribe") and a `List-Unsubscribe` header.
- **No tracking pixels.** Measure each email by its goal event (table above), against users who signed up before the emails started.

## Activation emails

### A1. Signed up, no Mac yet

- **Trigger:** `auth.signup`, and no Mac signed in to the account 2 h later.
- **Aha:** an agent can use any app on your real iPhone, like a person holding it.
- **Call to action:** copy the setup prompt on ghosthand.dev (download page as fallback).

```text
Subject: Ghosthand needs your Mac for one step

Hey,

thanks for signing up. One step is left: Ghosthand runs on a Mac and controls your iPhone
through a USB cable, and no Mac is connected to your account yet.

The fastest way is to let your agent do it. Copy the setup prompt on https://ghosthand.dev
and paste it into Claude Code, Codex or opencode. It installs Ghosthand and tells you what
to tap.

No terminal? Download the app instead: https://ghosthand.dev/download

When it's done, ask your agent something like "open WhatsApp on my iPhone and reply to Anna
that I'm on my way". It works in any app, with no jailbreak and nothing installed on the
phone.

If you get stuck, just reply to this email.

Tommy
```

**A1-mcp**, when the account was created by an MCP connector (an `oauth_consent` row before any Mac):

```text
Subject: Your AI chat is waiting for your Mac

Hey,

you connected Ghosthand to your AI chat, but it can't reach your iPhone yet: the iPhone
talks to a Mac over USB, and no Mac is signed in to your account.

On your Mac, install Ghosthand from https://ghosthand.dev/download and sign in with this
same Google account. The window shows the rest: plug in the iPhone, tap Trust, pair
Bluetooth.

Then ask your chat to "take a screenshot of my iPhone". From then on it works from any
computer, as long as the Mac is on.

Tommy
```

### A2. Mac signed in, iPhone never used

- **Trigger:** a Mac signed in, and no lease-check from the org 24 h later.
- **Lesson:** the two manual steps, and the Bluetooth off-and-on fix.
- **Benefit:** you do it once; after that the iPhone reconnects in about 2 s.
- **Call to action:** open the Ghosthand app, which shows the current step.

```text
Subject: Two steps between your Mac and your iPhone

Hey,

your Mac is signed in to Ghosthand, but your iPhone hasn't been used yet. Usually it stops
at one of two steps:

- Trust: plug the iPhone into the Mac with a cable, unlock it and tap Trust.
- Bluetooth: on the iPhone open Settings > Bluetooth and tap your Mac's name. If the Mac
  is not in the list, turn Bluetooth off and on again on the iPhone.

Bluetooth makes the Mac a mouse and keyboard for the iPhone. You do it once. After that the
iPhone reconnects in about 2 seconds every time you plug it in.

Open the Ghosthand app on your Mac: it shows the step you're on.

Stuck on something else? Reply with a screenshot of the window and I'll help.

Tommy
```

### A3. iPhone ready, little use

- **Trigger:** first lease-check 24 h ago, fewer than 3 leases since. Lease count is the proxy for "20+ phone inputs", which only Strada has.
- **Aha:** one plain sentence, and you watch your real phone do it.
- **Call to action:** type a task in the chat of the Ghosthand app.

```text
Subject: Try one sentence on your iPhone

Hey,

your iPhone is connected to Ghosthand. The quickest way to see what it can do is to type
one sentence.

Open the Ghosthand app on your Mac and write a task in the chat on the right, for example:

- "Open WhatsApp and tell me who wrote me today"
- "Turn on Low Power Mode and set Auto-Lock to 5 minutes"
- "Check how much storage each app uses and list the top 5"

An agent on ghosthand.dev reads the screen and taps until it's done, and you watch it live.
In a terminal it's the same: ghosthand task "...". The free plan includes 10 tasks a month.

Tommy
```

### A4. First phone task done

- **Trigger:** 10 min after the org's first `task_run` row. Skip if M1 was sent.
- **Lesson:** tasks are for quick chores; long jobs go to the agent you already use.
- **Benefit:** your own agent has no monthly limit on the free plan.
- **Call to action:** install the skill (MCP connector as fallback).

```text
Subject: Your own agent can drive the iPhone too

Hey,

nice, your first phone task ran. Tasks are great for quick chores. For longer jobs, give the
iPhone to the agent you already use:

npx -y skills add https://ghosthand.dev -g -y

Then ask Claude Code, Codex or opencode in plain words, for example "use ghosthand to post my
latest screen recording to TikTok". The free plan limits phone tasks to 10 a month, but not
your own agent.

No terminal? Add https://ghosthand.dev/mcp as a connector in Claude or ChatGPT instead.

Tommy
```

## Idea emails (active users)

Sent to activated users (3+ leases on 2+ days), counted from the day they became active.
Each one teaches a feature few people find. Skip an idea the user already uses once we have
per-user command data (see [data](#data-we-have-and-data-we-need)).

### B1. Take Control when the agent is stuck (day 2)

- **Benefit:** finish the hard 5% yourself (a captcha, a 2FA code) without unplugging anything.
- **Call to action:** open the Ghosthand app, click the screen.

```text
Subject: Jump in when your agent gets stuck

Hey,

a small trick: when an agent gets stuck on your iPhone (a captcha, a 2FA code, a strange
popup), you don't need to pick up the phone.

Open the Ghosthand app, hover the iPhone's screen and click it. Now your clicks tap the
phone and your Mac keyboard types into it. Press Esc when you're done, and the agent
continues from there.

The same window shows every iPhone live, which agent holds it and what it's doing.

Tommy
```

### B2. Post to TikTok from your Mac (day 5)

- **Benefit:** creators skip the AirDrop-and-post routine for every video. Makes money for people who post daily.
- **Call to action:** https://ghosthand.dev/docs/send-media

```text
Subject: Post a video to TikTok without touching your phone

Hey,

TikTok and Instagram only upload from the iPhone's Photos. That usually means AirDropping
the clip, then posting by hand.

Your agent can do all of it. Ask it:

"Use ghosthand to post ~/Movies/clip.mp4 to TikTok with the caption 'day 12 of building
my app'"

It sends the file with ghosthand upload, saves it to Photos through Safari, opens TikTok,
picks the clip, writes the caption and posts. The first video on https://ghosthand.dev
shows the whole run. How it works: https://ghosthand.dev/docs/send-media

If you post every day, that's the boring part of every post gone.

Tommy
```

### B3. Use it from anywhere with MCP (day 9)

- **Benefit:** the iPhone at home or in the office answers to any AI chat, from any computer.
- **Call to action:** add https://ghosthand.dev/mcp as a connector.

```text
Subject: Control your iPhone from Claude or ChatGPT, anywhere

Hey,

while your Mac is signed in, it keeps a connection to ghosthand.dev. So any AI chat can
reach your iPhone, not only the agent on your Mac.

Add https://ghosthand.dev/mcp as a connector in Claude, ChatGPT or Cursor and sign in with
the same Google account. Then, from any laptop:

"Open WhatsApp on my iPhone and tell Anna I'm 10 minutes late"

Leave the Mac on with the iPhone plugged in, and it works while you're away.

Setup for each app: https://ghosthand.dev/docs/mcp/overview

Tommy
```

### B4. Automate a daily phone chore (day 14)

- **Benefit:** a boring daily check runs by itself, from any computer or server.
- **Call to action:** `ghosthand tunnel url --new-token`, then the API docs.

```text
Subject: Run a phone chore every morning, on its own

Hey,

some things only exist in an app: a daily check-in reward, a number with no export, a report
you screenshot every morning.

Ghosthand has an HTTP API, so a script can do these for you. On the Mac with the iPhone, run:

ghosthand tunnel url --new-token

It prints a URL and a token. Any script on any computer can then take the iPhone, tap, type
and read the screen text. Put it in a cron job and it runs every morning at 9 while you
sleep.

API docs: https://ghosthand.dev/docs/api/overview

Tommy
```

### B5. Test your iOS app and record it (day 21)

- **Benefit:** app developers get a real-device test run and a video for bug reports, App Store previews or a launch post.
- **Call to action:** https://ghosthand.dev/docs/cli/record-start

```text
Subject: Let an agent test your iOS app and record it

Hey,

if you build an iOS app, try this. Install your build with
ghosthand app install MyApp.ipa (ad hoc or development signed), then ask your agent to go
through signup like a new user would.

Run ghosthand record start run.mov first, and you get a video with sound of the whole run.
Good for bug reports, App Store preview videos or a launch post.

No simulator and no test target: the real app on a real iPhone.
Recording: https://ghosthand.dev/docs/cli/record-start

Tommy
```

### More ideas for later

- **Photos off the iPhone without AirDrop:** `ghosthand photo pull --last 3 -o .`
- **Turn off the SIM PIN** with one prompt (README example). Saves a PIN after every restart.
- **One agent per iPhone in parallel** (Pro): warm up several TikTok accounts at once.

## Plan limit and billing emails

### M1. 10 phone tasks used

- **Trigger:** `task_limit_reached`, first time per org per month. Send from the task route, right away.
- **Benefit:** unlimited tasks, and every iPhone on the Mac.
- **Call to action:** https://ghosthand.dev/subscribe

```text
Subject: You used your 10 phone tasks for this month

Hey,

you ran 10 phone tasks this month, the limit of the free plan. It resets on {reset date}.

If tasks save you time, Pro makes them unlimited: $99 a month per Mac, and every iPhone you
plug into that Mac is included.

https://ghosthand.dev/subscribe

Not ready to pay? Your own agent (Claude Code, Codex, or Claude and ChatGPT through
https://ghosthand.dev/mcp) can keep driving your iPhone with no limit.

What were you automating? Reply and tell me, I read every answer.

Tommy
```

### M2. Second iPhone refused

- **Trigger:** `device_limit_reached` with plan free and limit phone, first time per org. Send from lease-check, right away.
- **Use case:** one agent per iPhone, so 3 iPhones do 3 jobs at the same time.
- **Call to action:** https://ghosthand.dev/subscribe (switching on the dashboard as the free option).

```text
Subject: Ghosthand on more than one iPhone

Hey,

your agent just tried to use a second iPhone. The free plan covers one: {free iPhone name}.

Two ways forward:

- Switch: remove {free iPhone name} on https://ghosthand.dev/dashboard, and the next
  iPhone your agent uses becomes the free one.
- Pro: every iPhone on your Mac, at the same time. One agent per iPhone, so 3 iPhones do
  3 jobs in parallel: warm up 3 TikTok accounts at once, or test your app on iOS 16 and
  iOS 26 side by side. $99 a month per Mac: https://ghosthand.dev/subscribe

Tommy
```

### M3. Checkout opened, not paid

- **Trigger:** Stripe `checkout.session.expired` for the org (Checkout sessions expire after 24 h by default), once per org.
- **Goal:** learn what stopped them. No link: a reply is the action.

```text
Subject: Did something stop you?

Hey,

you opened the Pro checkout yesterday but didn't finish. No pressure. Was something missing,
unclear, or too expensive?

Just reply, even with one line. It helps me decide what to build next.

Tommy
```

### M4. Welcome to Pro

- **Trigger:** `subscription_updated` with status active, first time per org. Right away.
- **Aha:** the private skills do whole flows (warm up a TikTok account, create accounts).
- **Call to action:** add the GitHub username on the dashboard.

```text
Subject: Welcome to Ghosthand Pro

Hey,

thanks for subscribing, it means a lot. What you get now:

- Every iPhone on your paid Mac. Plug in more and run one agent per iPhone at the same time.
- Unlimited phone tasks.
- The daemon source and the private skills. Add your GitHub username on
  https://ghosthand.dev/dashboard and accept the invite. Two skills come with it:
  tiktok-warmup watches and likes videos in your niche, so a new account's feed fits it,
  and ghosthand-accounts signs up for Google, Apple, TikTok, Instagram and Reddit accounts
  on the iPhone.

Reply anytime with what you want to automate, and I'll help you set it up.

Tommy
```

### M5. Pro, quiet after paying

- **Trigger:** 48 h after the subscription started, no lease-check since. Once.
- **At today's volume, write it by hand.** The template is for later.

```text
Subject: Can I help you set up your first flow?

Hey,

you subscribed to Pro two days ago, and your iPhones have been quiet since. Usually that
means something got in the way.

Tell me what you want the iPhones to do, in one or two lines. I'll reply with the exact
prompt or a skill for it, or we can do a 15 minute call and set it up together.

Tommy
```

## Win-back emails

### W1. Quiet for 7 days

- **Trigger:** was active (3+ leases on 2+ days), last lease 7 days ago. Once per quiet period.
- **Body:** the next B idea the user has not received, plus one line from the changelog.
- **Variant:** when the hub's last-seen time for every Mac of the org is over 7 days old, add: "Your Mac {name} has been offline since {date}. Open Ghosthand on it to reconnect."

```text
Subject: One idea for your iPhone this week

Hey,

your iPhone hasn't had an agent on it for a week, so here's one idea worth 5 minutes:

{the next unsent B idea, 2 or 3 sentences, with its link}

Also new since you last used it: {one changelog line, e.g. "Ghosthand now updates itself,
and uploads take files up to 2 GB."}

Tommy
```

### W2. Quiet for 30 days

- **Trigger:** no lease for 30 days, and at least one lease ever. Once. The last automated email.

```text
Subject: What stopped you?

Hey,

you set up Ghosthand a while ago and haven't used it in a month. This is the last of these
emails.

Could you reply with one line on why? It didn't work on your iPhone, it was too slow, no use
case, something else. Every answer changes what I fix next.

Tommy
```

### W3. Pro canceled

- **Trigger:** `subscription_updated` with `cancel_at_period_end` true. Right away, once.

```text
Subject: Sorry to see you go

Hey,

I saw you canceled Pro. It stays active until {period end}.

Could you tell me in one line why? If it's something I can fix, I'll fix it.

Tommy
```

## Data we have and data we need

The email job reads Postgres, not Strada: Strada is analytics with retention limits, and the
website already owns the account rows. Event emails (M1, M2, M4, W3) send from the handler
that sees the event.

| Trigger data | Have today | Missing |
| --- | --- | --- |
| Signup time, email, name | `user` row, `auth.signup` | nothing |
| Signup came from an MCP connector | `oauth_consent` row, `mcp_consent` event | nothing |
| Mac signed in, last online | Hub Durable Object registry (`lastSeenAt` per Mac), daemon `login` usage in Strada | **New:** Postgres `org_mac` row (org, name, `first_seen_at`, `last_seen_at`) written when the hub accepts a Mac, plus a `mac_connected` website event. Not on a timer |
| First lease, lease days | lease-check runs on every `acquire`; `org_device.bound_at` only for the free iPhone and paid Macs | **New:** lease-check upserts `org_lease_day` (org, day, leases). Gives first lease, active days and last lease |
| 20+ phone inputs | only daemon `usage` in Strada | Stays in Strada. Lease days are the proxy |
| First phone task | `task_run` | nothing |
| Task limit hit | `task_run` count per month, `task_limit_reached` | nothing |
| Second iPhone refused | `device_limit_reached` event only | Nothing to store: send from lease-check, dedupe with the sent log |
| Checkout opened, not paid | `subscribe_opened` event only | **New:** handle Stripe `checkout.session.expired` in the webhook |
| Paid, canceled | `subscription` table, webhook | nothing |
| Features a user already uses (to skip B ideas) | daemon `usage` per `user.id` in Strada | Optional. v1 sends every idea |
| Sent log, unsubscribe | nothing | **New:** `lifecycle_email` (user, key, `sent_at`, unique per user and key) and an opt-out flag on the user |
| Sending | no `send_email` binding, no sending domain | Cloudflare Email Service binding, a sending domain, a reply-to inbox |
| Measuring | goal events exist | **New:** `email_sent { key }` website event in `WebsiteEvents` |

Also update `website/src/docs/privacy.mdx`: we send product emails, with an unsubscribe link.

```
handlers, right away ────── task route: M1 · lease-check: M2 · Stripe webhook: M3, M4, W3
                                          │
                                          ▼
                              lifecycle_email log (dedupe) ──> send_email ──> user inbox
                                          ▲                                       │
hourly cron, SQL on Postgres ── A1-A4, B1-B5, M5, W1, W2                         reply
                                                                                  ▼
                                                                         Tommy's inbox
```

## Open questions

1. **Sender and reply-to address.** Not in AGENTS.md yet; the reply-to must be an inbox Tommy reads.
2. **M1 tells free users their own agent has no limit.** It keeps them active but may cost upgrades. Keep or drop the line.
3. **M5 by hand or automated.** By hand while there are few Pro users.
4. **Greeting.** "Hey," as in the skill, or "Hey {first name}," from `user.name`.
