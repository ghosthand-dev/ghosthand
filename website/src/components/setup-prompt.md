# Set up Ghosthand

Set up ghosthand so you can control my iPhone.

## Before you start

- Tell me that Ghosthand requires a **Mac** and that I must connect my iPhone to it with a **USB cable**.
- If you do not run on a Mac (`uname` does not print `Darwin`), install nothing. Tell me to open https://ghosthand.dev/download on my Mac, and to add https://ghosthand.dev/mcp to you as a remote MCP server. Then stop.
- This prompt needs the **harness sandbox disabled**, because Ghosthand installs and launches its Mac app and daemon outside the current workspace.
- For example, in **Codex**, select **Full access** in the permissions menu below the message box before you run these commands.
- If the sandbox is still enabled, ask me to change it before you continue.

## Open setup

Run `npx -y ghosthand@latest setup`. It opens the small Ghosthand setup window on this Mac and starts the daemon. Tell me to complete setup in that window.

**I must do every action in the setup window, not you. Do not interact with the window or complete setup for me. Do not open setup again.**

## Learn and verify

1. While I follow the window, install the skill: `npx -y skills add https://ghosthand.dev -g -y`.
2. Read the skill to learn the CLI. Also read the [Ghosthand docs](https://ghosthand.dev/index.md).
3. Poll `npx -y ghosthand@latest setup status` every 2 seconds until `ready` is true. When its `next` field changes, tell me the new step in one line.
4. When `ready` is true, run `npx -y ghosthand@latest list` and take a screenshot of my iPhone to confirm that it works.
