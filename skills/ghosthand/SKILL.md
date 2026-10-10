---
name: ghosthand
description: >
  Control a real iPhone connected to this Mac with the ghosthand CLI: screenshots and
  on-device OCR over USB, taps, swipes, scroll, keys and typing over Bluetooth, and files,
  photos, apps, battery and logs over USB. Use it to open apps, read messages, reply, fill
  forms, get photos or files off the iPhone, or do any task on the user's iPhone.
  ALWAYS load this skill when the user mentions ghosthand, their iPhone or phone, or asks
  to do something on a phone app (Messages, WhatsApp, Instagram, TikTok, Settings, App Store).
---

# ghosthand

Before the first ghosthand command in a session, run:

```bash
ghosthand --help # NEVER pipe to head/tail, read the full output
```

The help output is the full agent manual: leases, coordinates, the screenshot feedback loop, and what to do on each error. Read `ghosthand <command> --help` before using a command for the first time.

If `ghosthand` is not found, use `npx -y ghosthand@latest` instead.

Rules:

- Always `acquire` a lease with `--reason "<task>"` first, pass `-l <id>` to every command, and `release` it when done.
- Never retry a passcode or repeat input after a verification timeout. Take a screenshot first.
- Screen dimmed but no dialog in the screenshot: run `screenshot -l <id> --native -o real.png` (a real iOS screenshot that shows hidden system dialogs, deleted from Photos after reading) and tap at the coordinates in it. A button that ignores `tap`: `swipe x y x y --duration 400` at the same point.
- Photos, files and apps go over USB without the screen: `photo-pull`, `file-pull`, `file-push`, `app-list`, `info`, `logs`. Read each `--help` first.
- If a dialog does not respond or is invisible to capture, try `lock -l <id>`, then `unlock -l <id> --stdin --screenshot s.png --screentext` once to dismiss it, not accept an option. First obtain a user-confirmed passcode from the secret provider and pipe it to unlock. Without one, ask the user before locking. This may not dismiss every dialog; check the result and never retry a failed passcode.
- Leave the iPhone unlocked when done.
- `login-required` or `subscription-required` from acquire: follow the error text. Open `ghosthand setup` once and tell the user to complete setup in the small Ghosthand window, or show the subscribe link. All Ghosthand window actions are user-only; never interact with the window or complete setup for the user. Never run `ghosthand login` yourself and never retry in a loop.
