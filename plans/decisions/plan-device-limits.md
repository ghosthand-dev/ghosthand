# Plans limit devices, never time (human)

- User, 2026-10-27: "let's make this free for one iphone. 99 for unlimited iphones in one mac. plus you get access to code. no time based limits"
- User, 2026-10-27: "ok for 99 per mac"
- Free: one iPhone per org, on any Mac. Pro: $99/month per Mac (Stripe quantity), unlimited iPhones on each paid Mac, plus read access to the daemon repo.
- Checked only at acquire and wait; a running lease is never stopped. People (preview, Take Control) are never limited.
- Why: companies that run many phones pay; personal use stays free.
- Lost: the 7-day trial, any time or request based limits (a 60 minutes per day free plan was planned, then dropped).
- Applied recommendations (user said "proceed", Oct 27): switching the free iPhone is Remove on the dashboard, no cooldown; phone tasks are Pro only (they spend AI tokens); uploads stay free.
- Lives in: `website/src/lib/billing.ts`, `website/src/cli-api.ts`, `daemon/Sources/ghosthand/account.swift` (after the split).
