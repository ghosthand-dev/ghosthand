// Pure rules of the cloud fleet. No I/O and no clock: fleet.ts reads Postgres and the hosts,
// asks these functions what to do, then writes the rows and calls the hosts.
//
//   acquire ──> place(): where a stored phone starts, or which idle phone stops for it
//   cron, acquire ──> reconcile(): what a host's report means for one phone (level-triggered:
//                     the same rows and report always give the same step, so repeating it is safe)
//
// Rules:
//   1. A phone runs on at most one host. Its newest copy is on `host` (running, or the host's
//      disk) and, once version == savedVersion, also in R2 (version 0 is the template).
//   2. A stored phone starts on, first match:
//      a. its own host, if online, active and with a free slot (no download);
//      b. if R2 has its newest copy: the usable host with the most free slots, then slug;
//      c. else a slot freed by stopping the unleased running phone idle longest (at least
//         GRACE_MS), on a host it can use; while a stop is in flight there, it waits for it;
//      d. else it waits. A phone whose newest copy is only on an offline host waits for that
//         host; only the operator's recover moves it to its R2 copy.
//   3. A running phone without a lease keeps running until a stored one needs its slot.
//   4. A stop hashes the disk on the host as version + 1; the cron then copies it to R2.
//      A VM that stopped by itself (crash, host restart) is hashed the same way.
//   5. Only a host report moves a phone out of a transition. A failed or timed-out call proves
//      nothing (the host may have done it): the next reconcile sends it again.

export const GRACE_MS = 10 * 60_000
export const DEFAULT_IDLE_TIMEOUT_S = 600
/** A plain acquire waits this long for the phone to start (or a slot to free). */
export const DEFAULT_START_WAIT_S = 300
/** A host is online while its last status answer is this recent. The cron asks every minute. */
export const HOST_ONLINE_MS = 3 * 60_000

export type PhoneState = 'stored' | 'starting' | 'running' | 'stopping'

/** One phone in a host's `GET /v1/status` (vphone-cli fleet serve). */
export type HostPhone = {
  id: string
  /** damaged: a stop or restore was cut off; a new stop or restore repairs it. */
  state: 'starting' | 'stopping' | 'restoring' | 'running' | 'stopped' | 'damaged'
  /** Version of the local copy; null while damaged. */
  version: number | null
  /** Why the last start, stop or restore failed. */
  error?: string
}

export type HostSlot = {
  slug: string
  slots: number
  /** Online, active (not draining) and in this Worker's environment. */
  usable: boolean
}

/** A phone that takes a slot: every state but stored. */
export type PlacedPhone = {
  id: string
  host: string
  state: PhoneState
  /** Running without a live lease: when its last lease ended (or it started). Else null. */
  idleSince: number | null
}

export type Placement =
  | { kind: 'start'; host: string }
  | { kind: 'stop'; host: string; victim: string }
  | { kind: 'wait'; reason: 'host-offline' | 'full' }
  /** Stops in flight on the hosts it can use: one of them frees its slot. */
  | { kind: 'wait'; reason: 'freeing'; stopping: string[] }

/** Rule 2: where a stored phone starts, or what makes room for it. */
export function place({ phone, hosts, placed, now }: {
  phone: { host: string | null; version: number; savedVersion: number }
  hosts: HostSlot[]
  placed: PlacedPhone[]
  now: number
}): Placement {
  const free = (host: HostSlot) => host.slots - placed.filter((p) => p.host === host.slug).length
  const home = hosts.find((host) => host.slug === phone.host)
  const unsaved = phone.version > phone.savedVersion
  if (home?.usable && free(home) > 0) return { kind: 'start', host: home.slug }
  if (!unsaved) {
    const best = hosts
      .filter((host) => host.usable && free(host) > 0)
      .sort((a, b) => free(b) - free(a) || a.slug.localeCompare(b.slug))[0]
    if (best) return { kind: 'start', host: best.slug }
  }
  const candidates = unsaved ? (home?.usable ? [home] : []) : hosts.filter((host) => host.usable)
  const slugs = new Set(candidates.map((host) => host.slug))
  const stopping = placed.filter((p) => p.state === 'stopping' && slugs.has(p.host)).map((p) => p.id)
  if (stopping.length) return { kind: 'wait', reason: 'freeing', stopping }
  const victim = placed
    .filter((p) => p.state === 'running' && slugs.has(p.host) && p.idleSince !== null && p.idleSince + GRACE_MS <= now)
    .sort((a, b) => a.idleSince! - b.idleSince! || a.id.localeCompare(b.id))[0]
  if (victim) return { kind: 'stop', host: victim.host, victim: victim.id }
  return { kind: 'wait', reason: unsaved && !home?.usable ? 'host-offline' : 'full' }
}

/** What to write on the phone row (compare-and-set on its state, version and host) and which
 *  host call to make after the write. */
export type Step = {
  state?: PhoneState
  version?: number
  /** The host no longer has the copy, and R2 has the same version. */
  clearHost?: true
  /** The VM stopped under a lease: end it. */
  endLeases?: true
  /** start: launch `version`. load: copy `version` from R2 to the host, then restore it.
   *  stop: shut down and hash as version + 1. save: copy `version` from the host to R2. */
  call?: 'start' | 'load' | 'stop' | 'save'
}

const BUSY = new Set<HostPhone['state']>(['starting', 'stopping', 'restoring'])

/** Rules 4 and 5: one phone placed on a host that answered, and that host's report of it. */
export function reconcile({ phone, report }: {
  phone: { state: PhoneState; version: number; savedVersion: number }
  report: HostPhone | undefined
}): Step {
  const busy = report !== undefined && BUSY.has(report.state)
  switch (phone.state) {
    case 'starting':
      if (report?.state === 'running') return { state: 'running' }
      if (busy) return {}
      if (report?.state === 'stopped' && report.version === phone.version) return { call: 'start' }
      // Version 0 of a phone the host has never seen is a new clone of its template.
      if (!report && phone.version === 0) return { call: 'start' }
      return { call: 'load' }
    case 'running':
      if (report?.state === 'running' || busy) return {}
      return { state: 'stopping', endLeases: true, call: 'stop' }
    case 'stopping':
      if (report?.state === 'stopped' && report.version === phone.version + 1) return { state: 'stored', version: phone.version + 1 }
      if (busy) return {}
      return { call: 'stop' }
    case 'stored':
      if (!report) return phone.version === phone.savedVersion ? { clearHost: true } : {}
      if (phone.version > phone.savedVersion && report.state === 'stopped' && report.version === phone.version) return { call: 'save' }
      return {}
  }
}
