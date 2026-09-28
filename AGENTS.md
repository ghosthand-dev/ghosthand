# Device access

- `.passcode` contains the local iPhone passcode. It is ignored by Git. Never print, upload, or commit its contents.
- To try the Bluetooth unlock flow, pass it to `iphonectl` as `IPHONECTL_PASSCODE` from `.passcode`. Do not put the passcode in command arguments or logs:

  ```sh
  IPHONECTL_PASSCODE="$(<.passcode)" .build/debug/iphonectl unlock
  ```

- Check the iPhone with `iphonectl list` before input. A wrong passcode is not retried because failed attempts count toward lockout.

# CLI help is the agent manual

Agents learn iphonectl from `iphonectl --help` and `iphonectl <command> --help` before they read the README. So every rule an agent needs to use a command correctly goes into the CLI help, in `Sources/iphonectl/main.swift`:

- `description`: one line, what the command does. Shown in the root command list.
- `details`: usage notes and rules, shown only by `<command> --help`: what the output means, what to do on common errors, limits found in tests (for example "Home Screen labels do not open apps").
- `agentLoopHelp`: the rules for every command (coordinate space, `--screenshot` after actions, leave the phone unlocked). Shown by `iphonectl --help`.

When you find a new limit or a rule while testing on a real iPhone, add it to the matching command's `details` first, then to the README if a human needs it too. Keep help text short and concrete: say what to do, not only what went wrong.

# Relative pointer (iOS 15)

Read `docs/relative-pointer.md` before changing relative pointer code: the acceleration table, the measurements, and the timing rules (150 ms after homing, 100 ms before a press).
