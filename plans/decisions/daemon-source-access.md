# Daemon repo split and read-only source access (human)

- User, 2026-10-27: "only the Swift code will be closed source", "the public one ghosthand and the private one ghosthand-daemon", "we will add the daemon as a submodule".
- User, 2026-10-27: "use my token, then for an user to get access we show a button in dashboard to request access".
- User, 2026-10-27: "we want read only access. that's why i wanted to move to org?" (yes: only org-owned repos give read-only collaborators).
- Public `ghosthand-dev/ghosthand` (everything but Swift and private skills), private `ghosthand-dev/ghosthand-daemon` as the submodule `daemon/`, history split with `git filter-repo`.
- Access: dashboard **Request access** with a GitHub username (GitHub repo invites take a username, not an email), `permission: pull`, removed when the plan ends. Credential: Tommy's fine-grained token (`GITHUB_TOKEN`), scoped to the daemon repo.
- Why: read-only access needs an org repo; a token is the least setup at the current scale.
- Lost: email invites (only possible as org membership, with no way to know which account accepted), a GitHub App (cleaner, more code).
- Open: whether the base `ghosthand` skill stays public (recommended).
- Lives in: `docs/plans/pricing-and-repo-split.md` until built, then `website/src/lib/github.ts`.
