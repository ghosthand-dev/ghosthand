// Pure rules of the cloud fleet. No I/O and no clock: fleet.ts reads Postgres and the hosts,
// asks these functions what to do, then writes the rows and calls the hosts.
//
//   acquire ──> place(): where a stopped phone starts, or which idle phone stops for it
//   cron, acquire ──> reconcile(): what a host's report means for one phone (level-triggered:
//                     the same rows and report always give the same step, so repeating it is safe)
//
// Rules:
//   1. A phone is pinned to one host forever: its first placement sets `host`, nothing moves it.
//      That host's disk holds the only copy of its VM (we back up host machines, not phones).
//   2. A stopped phone with a host starts there, first match:
//      a. the host is offline: it waits (the user is told its machine is offline);
//      b. the host has a free slot: start;
//      c. a stop in flight on that host: wait for it;
//      d. stop the unleased running phone idle longest on that host, if idle at least GRACE_MS;
//      e. else wait (full).
//   3. A phone with no host yet gets the online, active host with the most free slots, then slug;
//      if every one is full, an idle phone on any of them stops for it (2c and 2d).
//   4. A running phone without a lease keeps running until a stopped one needs its slot.
//   5. A start clones the template only before the VM first ran (`create`). A host that does
//      not report a phone that already ran has lost it: an error, never a fresh clone.
//   6. Only a host report moves a phone out of a transition. A failed or timed-out call proves
//      nothing (the host may have done it): the next reconcile sends it again.

import type { components } from '../generated/fleet-api.ts'

export const GRACE_MS = 10 * 60_000
export const DEFAULT_IDLE_TIMEOUT_S = 600
/** A plain acquire waits this long for the phone to start (or a slot to free). */
export const DEFAULT_START_WAIT_S = 300
/** A host is online while its last status answer is this recent. The cron asks every minute. */
export const HOST_ONLINE_MS = 3 * 60_000

export type PhoneState = 'stopped' | 'starting' | 'running' | 'stopping'

/** One phone in a host's `GET /v1/status` (vphone-cli fleet serve). */
export type HostPhone = components['schemas']['HostPhone']

export type HostSlot = {
  slug: string
  slots: number
  /** Answered the cron within HOST_ONLINE_MS. Hosts of other environments are not listed. */
  online: boolean
  /** Not draining: new phones may be pinned to it. */
  active: boolean
}

/** A phone that takes a slot: every state but stopped. */
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
  /** The phone's own host is offline: it never starts anywhere else. */
  | { kind: 'wait'; reason: 'host-offline' }
  | { kind: 'wait'; reason: 'full' }
  /** Stops in flight on the hosts it can use: one of them frees its slot. */
  | { kind: 'wait'; reason: 'freeing'; stopping: string[] }

/** Rules 2 and 3: where a stopped phone starts, or what makes room for it. */
export function place({ phone, hosts, placed, now }: {
  phone: { host: string | null }
  hosts: HostSlot[]
  placed: PlacedPhone[]
  now: number
}): Placement {
  const free = (host: HostSlot) => host.slots - placed.filter((p) => p.host === host.slug).length
  let candidates: HostSlot[]
  if (phone.host) {
    const home = hosts.find((host) => host.slug === phone.host)
    if (!home?.online) return { kind: 'wait', reason: 'host-offline' }
    candidates = [home]
  } else {
    // TODO: no cap on phones pinned per host (disk, oversell ratio) yet: slots are the only measure.
    candidates = hosts.filter((host) => host.online && host.active)
  }
  const best = candidates
    .filter((host) => free(host) > 0)
    .sort((a, b) => free(b) - free(a) || a.slug.localeCompare(b.slug)).at(0)
  if (best) return { kind: 'start', host: best.slug }
  const slugs = new Set(candidates.map((host) => host.slug))
  const stopping = placed.filter((p) => p.state === 'stopping' && slugs.has(p.host)).map((p) => p.id)
  if (stopping.length) return { kind: 'wait', reason: 'freeing', stopping }
  const victim = placed
    .filter((p) => p.state === 'running' && slugs.has(p.host) && p.idleSince !== null && p.idleSince + GRACE_MS <= now)
    .sort((a, b) => a.idleSince! - b.idleSince! || a.id.localeCompare(b.id)).at(0)
  if (victim) return { kind: 'stop', host: victim.host, victim: victim.id }
  return { kind: 'wait', reason: 'full' }
}

/** What to write on the phone row (compare-and-set on its state and host) and which host call
 *  to make after the write. */
export type Step = {
  state?: PhoneState
  /** The host reports the VM running for the first time: set first_run_at. */
  ran?: true
  /** The VM stopped under a lease: end it. */
  endLeases?: true
  /** The host should have this VM and does not (rule 5). */
  lost?: true
  /** start: launch it, cloning the template first while it never ran. stop: shut it down. */
  call?: 'start' | 'stop'
}

const BUSY = new Set<HostPhone['state']>(['starting', 'stopping'])

/** Rules 5 and 6: one phone pinned to a host that answered, and that host's report of it.
 *  `ran`: first_run_at is set, so the VM must exist on the host. */
export function reconcile({ phone, report }: {
  phone: { state: PhoneState; ran: boolean }
  report: HostPhone | undefined
}): Step {
  if (!report) {
    if (phone.ran) return phone.state === 'stopped' ? { lost: true } : { state: 'stopped', endLeases: true, lost: true }
    // Never ran: the host has not cloned it yet, or a first start failed before the clone.
    if (phone.state === 'starting') return { call: 'start' }
    return phone.state === 'stopped' ? {} : { state: 'stopped', endLeases: true }
  }
  const busy = BUSY.has(report.state)
  const ran = !phone.ran && report.state === 'running' ? { ran: true as const } : {}
  switch (phone.state) {
    case 'starting':
      if (report.state === 'running') return { state: 'running', ...ran }
      if (busy) return {}
      return { call: 'start' }
    case 'running':
      if (report.state === 'running') return ran
      if (busy) return {}
      // The VM stopped by itself (crash, host restart): its lease ends.
      return { state: 'stopped', endLeases: true }
    case 'stopping':
      if (report.state === 'stopped') return { state: 'stopped' }
      if (busy) return {}
      return { call: 'stop' }
    case 'stopped':
      return ran
  }
}
