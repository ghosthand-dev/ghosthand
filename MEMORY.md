# MEMORY

## Mac release signing

- Apple Developer Program bought Oct 2026 ($99/yr).
- Developer ID Application and Installer certs: `.p12` + password in Sigillo project `macos-release` (ghosthand org). Password only in Sigillo.
- Backups of the `.p12` files: `~/Documents/apple-signing` and iCloud Drive `apple-signing` (global, used by all apps).
- Certs expire 2027-11-25. Renew from the same team then.

## Installer and onboarding

- `.pkg` installer (not DMG): installs `~/Applications/Ghosthand.app`, postinstall `open -n` shows setup.
- Download page: ghosthand.dev/download. Remote MCP tells bots to send it when no Mac or no iPhone.
- Grok plugin route: https://x.ai/bot/marketplace/submit-a-plugin with MCP URL https://ghosthand.dev/mcp (drafted fields in thread 1564340627242614814).

## Users (Oct 26 2026)

- 2 real sign-ups (Oct 12, Oct 21), 0 paying. Names live in Strada, not here: this repo goes public.

## Pricing and repo split (split done Oct 27 2026)

- Plan: `docs/plans/pricing-and-repo-split.md` (thread 1564575683521413194). Waiting for user answers on its open questions.
- Free: 1 iPhone, no time limit (user changed it). Pro: $99 per Mac, unlimited iPhones on that Mac + read access to private `ghosthand-dev/ghosthand-daemon` (Swift + skills) via Tommy's GitHub token (not a GitHub App); dashboard button to request access.
- User: no deploys; ask before destructive actions (push, repo change, migration, Stripe, npm publish).
- Public repo `ghosthand-dev/ghosthand` (website, docs, README), daemon as submodule `daemon/`, history kept with git filter-repo.
- User prefers Opus agent for planning workers, not GPT `build`.
- MEMORY.md goes to the public repo: no user names, emails or secrets in it.
- Split done: origin is `ghosthand-dev/ghosthand` (private for now), Swift in submodule `daemon/` (`ghosthand-dev/ghosthand-daemon`). Old `.git` in `~/Documents/ghosthand-old-remorses.git`. Backup `~/Documents/ghosthand-backup-2026-10-27`.
- Open: README links to `Sources/...`, GitHub releases not copied, other Macs not switched, daemon LICENSE draft, free/Pro billing code not started.
