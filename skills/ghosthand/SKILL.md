---
name: ghosthand
description: >
  Control a real iPhone connected to this Mac with the ghosthand CLI: screenshots and
  on-device OCR over USB, taps, swipes, scroll, keys and typing over Bluetooth. Use it to
  open apps, read messages, reply, fill forms, or do any task on the user's iPhone.
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
- Leave the iPhone unlocked when done.
