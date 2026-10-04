# Changelog

## 0.3.0

1. **MCP server** — every CLI command is now an MCP tool with the same name. `ghosthand mcp` is a stdio MCP server that talks to the local daemon over its unix socket, so no port or token is needed:

   ```bash
   claude mcp add ghosthand -- npx -y ghosthand mcp
   ```

   ```jsonc
   // opencode.json
   { "mcp": { "ghosthand": { "type": "local", "command": ["npx", "-y", "ghosthand", "mcp"] } } }
   ```

   Tool descriptions come from the CLI help. Screenshots come back as image content. Use `ghosthand mcp --url` for a remote daemon.

2. **Screen recording** — record the iPhone screen and sound to a `.mov` or `.mp4` file from the same USB capture. Screenshots, `screentext` and input keep working while it records:

   ```bash
   ghosthand record-start demo.mov --fps 30   # returns at once
   ghosthand tap --text "Settings"
   ghosthand record-stop
   # /Users/me/demo.mov  12.4s  2.1 MB  828x1792  30 fps  sound  stopped by request
   ```

   Stops by itself after `--max-duration` (default 300 s), when the lease ends, or when the daemon stops. `--no-audio` leaves the sound out. With sound, start and stop pause media on the iPhone: start the recording first, then press play.

3. **`ghosthand setup` and `ghosthand app` windows** — `setup` walks one new iPhone through USB trust, unlock and Bluetooth pairing, then gives a prompt to copy for your agent. `app` is a control plane: every iPhone with its status, agent, task, last command, waiting agents and a live screen preview. Agents get a hint to open `setup` when a phone is missing or not paired.

4. **iPhones stay awake** — the daemon sends an idle Left Control key over Bluetooth, so Auto-Lock no longer has to be **Never**. No pointer shows in screenshots and nothing is typed. It stops when the iPhone is unplugged from USB.

5. **AssistiveTouch on acquire, off on release** — `acquire` turns AssistiveTouch on when it is off. `release` (or an expired lease) turns it off again only if ghosthand turned it on. Your own AssistiveTouch setting stays.

6. **More reliable `unlock`** — unlock now uses only the Bluetooth keyboard (Enter, passcode, Enter) and checks the lock state between steps. **Forget and pair each iPhone again** after you update: iOS keeps the old HID report map from pairing, and the lock screen ignores keys from it.

7. **Close invisible system dialogs with `lock` then `unlock`** — some iOS dialogs do not show in USB capture. `lock`, then `unlock` with a confirmed passcode closes them without picking an option:

   ```bash
   ghosthand lock
   secret-provider | ghosthand unlock --stdin
   ```

8. **Tap by text, `--wait-text`, `--screenshot` and `--screentext` now run in the daemon** — same behavior from the CLI and MCP. Errors after an input say `Input sent` and never repeat the input. New error codes `text-not-found` and `wait-text-timeout`.

9. **Browser requests are rejected on the TCP API** — requests with `Origin` or browser `Sec-Fetch-*` headers get 403 even with a valid token, so a web page cannot reach the daemon.

10. **Daemon state survives updates** — `state.db` is migrated in place. Leases, device matches, pointer settings and the lease counter are kept.
