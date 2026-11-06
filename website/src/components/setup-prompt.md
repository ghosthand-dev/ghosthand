# Set up Ghosthand

Set up ghosthand so you can control my iPhone.

## Before you start

- Tell me that Ghosthand requires a **Mac** and that I must connect my iPhone to it with a **USB cable**.
- If you do not run on a Mac (`uname` does not print `Darwin`), install nothing. Tell me to open https://ghosthand.dev/download on my Mac, and to add https://ghosthand.dev/mcp to you as a remote MCP server. Then stop.
- This prompt requires the **harness sandbox to be disabled** so Ghosthand can install and launch its Mac app and daemon outside the current workspace.
- For example, in **Codex**, select **Full access** in the permissions menu below the message box before running these commands.
- If the sandbox is still enabled, ask me to change it before continuing.

## Open setup

Run `npx -y ghosthand@latest setup`. It opens the small Ghosthand setup window on this Mac and starts the daemon. Tell me to complete setup in that window.

**All actions in the setup window must be done by me, not the agent. Do not interact with the window or complete setup for me. Do not open setup again.**

## Learn and verify

1. While I follow the window, install the skill: `npx -y skills add https://ghosthand.dev -g -y`.
2. Read the skill to learn the CLI, and the [Ghosthand docs](https://ghosthand.dev/index.md).
3. Poll `npx -y ghosthand@latest setup status` every 2 seconds until `ready` is true. When its `next` changes, tell me it in one line.
4. When ready, run `npx -y ghosthand@latest list` and take a screenshot of my iPhone to confirm that it works.
