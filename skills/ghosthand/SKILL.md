---
name: ghosthand
description: >
  Control a real iPhone connected to this Mac with the ghosthand CLI: screenshots and
  on-device OCR over USB, taps, swipes, scroll, keys and typing over Bluetooth, and files,
  photos, apps, battery and logs over USB. Use it to open apps, read messages, reply, fill
  forms, get photos or files off the iPhone, or do any task on the user's iPhone.
  ALWAYS load this skill when the user mentions ghosthand, their iPhone or phone, or asks
  to do something on a phone app (Messages, WhatsApp, Instagram, TikTok, Settings, App Store).
# The "Phone tips" section is also in the system prompt of the ghosthand.dev task agent
# (website/src/task-agent.ts imports it). Keep it free of CLI flags and CLI-only commands.
---

# ghosthand

Before the first ghosthand command in a session, run:

```bash
ghosthand --help # NEVER pipe to head/tail, read the full output
```

The help output is the full agent manual: leases, coordinates, the screenshot feedback loop, and what to do on each error. Read `ghosthand <command> --help` before using a command for the first time.

If `ghosthand` is not found, use `npx -y ghosthand@latest` instead. Without Node.js (installed from the download page), use `~/Applications/Ghosthand.app/Contents/MacOS/ghosthand`.

Pro subscribers also get the task skills `ghosthand-accounts` (Google, Apple, App Store and social account signup) and `tiktok-warmup` (watch and like TikTok videos for a niche) in the private daemon repo: https://ghosthand.dev/docs/pricing

## Phone tips

- **Prefer full app access.** When the app being used requests permission, grant the broadest available access unless the user explicitly restricts it: camera, microphone, Full Photos Access (not limited selection), contacts, notifications, location, and tracking. Complete related in-app access prompts too, so controls work immediately and repeated dialogs are reduced. Do not ask again for routine permission choices.
- Permission approval does not authorize purchases, unrelated account linking, publishing, follows, messages, or disabling security.
- Open apps with `key` cmd+space, `key` cmd+a (Spotlight can keep the last query), `type` the app name, `key` enter (works from any app). Faster than swiping Home Screen pages. If the app did not open, tap its icon in the results. cmd+space also closes Spotlight when it is already open, so check the screen before you press it again.
- A button that ignores a tap: read the screen, then press it once more. A just-opened alert can ignore the first press.
- Never repeat an input after a timeout or an error that says it was sent. Look at the screen first.
- After a Copy or Copy link tap, read the toast before you paste. A new TikTok post shows "Your post is under review and can't be shared right now" (or "being processed") and copies nothing, so a paste gives the old clipboard.
- To add an emoji while typing: press ctrl+space (the Emoji keyboard opens), tap Search Emoji, type a word like pizza, then tap the emoji in the results. Pick it from the screenshot: screen text does not show emoji. Tap the text field again to go on typing.
- If autocorrect changes words you type (it turned "Wikimedia" into "Wikipedia"), turn off Settings > General > Keyboard > Hardware Keyboard > Auto-Correction.

## CLI rules

- Always `acquire` a lease with `--reason "<task>"` first, pass `-l <id>` to every command, and `release` it when done.
- Never retry a passcode or repeat input after a verification timeout. Take a screenshot first.
- **Never `sleep` to wait for the phone.** Add `--screenshot` and `--screentext` to the action itself: they wait until the screen is still, then return it. To wait for a page that loads, pass `--wait-text "<expected text>"`. A `sleep` before a screenshot only adds seconds to every step.
- After a tap, hold or swipe that changes little of the screen (a toggle, a button with no visible effect), `--screenshot` waits until 1.5 s after the input, because a permission alert can come late. To go faster, add `--fast`: it returns the first still screen, often 0.5-1 s sooner. Then a late alert can be missing from the result, so take another screenshot when you expected a dialog.
- Expected a dialog but the screenshot has none: take another normal `screenshot` first. Permission alerts can appear 1-2 s after the tap. Only if that screenshot still misses it (the screen is often dimmed, but not always), the dialog is hidden from USB capture: run `screenshot -l <id> --native -o real.png` and tap at the coordinates in it. `--native` is a last resort: it is slow (2-7 s) and stays in the user's Photos when iCloud Photos is on. A button that ignores `tap` may also take `hold x y --duration 400`.
- Long press (context menus): `hold x y`. Move an item after a long press: `hold-drag` (read its `--help`).
- `type` types accents (è, ñ, ü) and symbols like € but no emoji. For long text with emoji, write it to a .txt file, `upload` it, open the link in Safari, tap Copy, then tap the field and `key cmd+v`.
- Photos, files and apps go over USB without the screen: `photo pull`, `file pull`, `file push`, `app list`, `info`, `logs`. Read each `--help` first.
- The Mac cannot read the iPhone clipboard. To read a copied link, tap the Safari address bar, `key cmd+v`, and read it with `--screentext`. A new TikTok post cannot be copied while it is under review, so read the newest video ids and captions from the public creator embed page; the URL is `https://www.tiktok.com/@<user>/video/<id>`. TikTok oEmbed answers 200 even for ids that do not exist, so it cannot confirm one.

  ```bash
  curl -sL -A 'Mozilla/5.0' https://www.tiktok.com/embed/@<user> | LC_ALL=C grep -o '"id":"[0-9]*","desc":"[^"]\{0,60\}'
  ```
- If a dialog does not respond or is invisible to capture, try `lock -l <id>`, then `unlock -l <id> --stdin --screenshot s.png --screentext` once to dismiss it, not accept an option. First obtain a user-confirmed passcode from the secret provider and pipe it to unlock. Without one, ask the user before locking. This may not dismiss every dialog; check the result and never retry a failed passcode.
- Leave the iPhone unlocked when done.
- Ghosthand's Mac setup window is user-only.
- `login-required` or `subscription-required` from acquire: follow the error text. Open `ghosthand setup` once and tell the user to complete setup in the small Ghosthand window, or show the subscribe link. All Ghosthand window actions are user-only; never interact with the window or complete setup for the user. Never run `ghosthand login` yourself and never retry in a loop.
