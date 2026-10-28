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

- User counts and names live in Strada and the database, never here: this repo is public.

## Pricing and repo split (split done Oct 27 2026)

- Plan: `docs/plans/pricing-and-repo-split.md` (thread 1564575683521413194). Tasks 1-3 done; open questions in the plan still need answers.
- Free: 1 iPhone, no time limit (user changed it). Pro: $99 per Mac, unlimited iPhones on that Mac + read access to private `ghosthand-dev/ghosthand-daemon` (Swift + skills) via Tommy's GitHub token (not a GitHub App); dashboard button to request access.
- User: no deploys; ask before destructive actions (push, repo change, migration, Stripe, npm publish).
- Public repo `ghosthand-dev/ghosthand` (website, docs, README), daemon as submodule `daemon/`, history kept with git filter-repo.
- User prefers Opus agent for planning workers, not GPT `build`.
- MEMORY.md goes to the public repo: no user names, emails or secrets in it.
- Split done: origin is `ghosthand-dev/ghosthand` (private for now), Swift in submodule `daemon/` (`ghosthand-dev/ghosthand-daemon`). Old `.git` in `~/Documents/ghosthand-old-remorses.git`. Backup `~/Documents/ghosthand-backup-2026-10-27`.
- Releases ghosthand@0.3.0-0.12.0 copied to the new repo (notes only, new dates).
- Other Macs: none has a ghosthand clone (checked mintmacbook Oct 27).
- Open: daemon LICENSE draft, free/Pro billing code done and pushed (Oct 27), website deployed + prod migrated + GITHUB_TOKEN set (Oct 27). 0.13.0 published Oct 27 (npm + pkg + GitHub release). E2E test on mintmacbook in thread 1564648446156087417. Phone tasks: Free gets 10 prompts per UTC month, Pro unlimited (uncommitted, Oct 27).

## Tetherport (iPhone mobile proxy product, planned Oct 27 2026)

- Plan: `/Users/morse/Documents/GitHub/tetherport/docs/plan.md` (private repo ghosthand-dev/tetherport, pushed Oct 27). Thread 1564639728744140920.
- One proxy port per USB iPhone (Personal Hotspot), one-time price, menu bar app + CLI via `.pkg`. Not App Store for v1 (sandbox blocks usbmuxd and PATH).
- Riskiest open test: two tethered iPhones at once, each with its own carrier IP. ghosthand capture flips iPhone USB mode, which may drop proxy connections.
- `GITHUB_TOKEN` (fine-grained "ghosthand.dev source access", ghosthand-dev/ghosthand-daemon, Administration write) in Sigillo dev, preview, prod. **Expires 2027-10-28**: renew before then. Stripe: own portal config `bpc_1UVAhkA0ZSKMzQVuHC3ALSTe` (metadata.app=ghosthand).
- Oct 27: Swift app + CLI built and committed (ad-hoc signed). Event log state (phone seen/forgotten, remote access on/off). Internet URLs via opentunnel.xyz. Not tested with real tethered iPhones yet.

## Open work (Oct 27 2026, uncommitted)

- Install paths fix (thread 1564658296793731293): app only moves forward, daemon restarts onto installed build. Doc `docs/install-paths.md`.
- Onboarding (thread 1564660012461199500): `setup-status` `next` field, hub answers before any Mac. Doc `docs/onboarding-flows.md`.
- Security review (thread 1564660351914614844): fixes done. The report is `daemon/docs/security-review-2026-10.md` (private). The old unlimited 100% promo code is deactivated; the owner's customer-bound replacement is Sigillo `website` prod `STRIPE_OWNER_PROMO_CODE`.
- All three touch `controller.swift`/`api.swift`: commit by hunk.

## Email and Grok listing

- ghosthand.dev email routing (Cloudflare): `tommy@` and catch-all forward to Tommy's Gmail.
- Grok plugin form filled in Chrome, not submitted (thread 1564672592638509236). Blocker: reviewer Google account + spare Mac + test iPhone online.
- Oct 27 real test: proxy exits via carrier IP (mintmacbook + iphone se bianco). ghosthand screen capture kills the hotspot USB link, so proxy and ghosthand cannot share one phone (XCTest mode is a possible fix, untested). 5 multi-iPhone review bugs fixed (tetherport commits d24087d, 81cbc23, not pushed). Naomi iPhone has no SIM.
