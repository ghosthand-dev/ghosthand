# Cloud VM memory and host slots (human)

- User, 2026-11-25: "We should consider that the available slots are 2 GB for each VM. Let's put the VM memory size in some constant that is also used when creating the virtual machines as well, so that it's the same ... Assume that the worker will need 4 GB to fit the operating system and other stuff."
- Two constants in the VPhone fork's `Fleet/` folder: VM memory 2 GiB, host reserve 4 GiB. `fleet serve` sets each VM's memory from the first and computes `slots = floor((hw.memsize - reserve) / vm memory)`. A 24 GiB Mac gets 10 slots, a 16 GiB Mac 6.
- The host reports `slots` in `GET /v1/status`; the website copies it into `cloud_host.slots` on every poll and never sets it by hand. Draining stays the way to run nothing on a host.
- Why: one source for the slot size, so the scheduler, the admin page and the VMs can never disagree.
- Lost: per-host `--slots` overrides.
- Open: measured host footprint of a 2 GiB VM is 2.14 to 2.26 GiB (`docs/research-notes/vphone-ipa-trial/vm-density-resume.md`), so 10 phones on 24 GiB leave about 1.4 GiB for macOS, not 4. Add a per-VM overhead constant (about 0.3 GiB, 8 slots on 24 GiB) if the admin page shows swap.
- Lives in: `vphone/VPhoneExecutable/VPhoneCommand/VPhoneCommand/Fleet/`, `website/src/cloud/fleet.ts` (cron), `plans/cloud-phones.md` Task 8.
