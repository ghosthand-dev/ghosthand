# Separate Apple Account for virtual iPhone tests (human)

- User, 2026-11-23: "never use my own iCloud credentials to do this for any kind of operations that interacts with the App Store to prevent me getting banned."
- Use only a separate test identity from the user-designated Sigillo Influencers or Ghosthand project, after verifying the project and identity purpose.
- Never reuse the host's Apple Account, existing Store session, or personal ipatool credentials.
- Why: isolate experimental App Store operations from the owner's personal account.
- Lost: convenience of reusing existing authentication.
- Open: select the test identity and verify isolated ipatool credential storage before any login.
- Lives in: `plans/virtual-iphone.md` and the local VPhone/ipatool test environment.
