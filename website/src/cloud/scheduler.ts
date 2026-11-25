// Pure scheduler of cloud iPhones: one function over the CloudFleet state. Same events in,
// same actions out, so a saved event log replays any decision (scheduler.test.ts). No
// Cloudflare imports and no clock: every event carries its time.
//
//   event ──> step(state, event) ──> new state + actions (start, stop, grant, reject)
//                                     fleet.ts saves the state, runs the actions through
//                                     host.ts, and feeds the results back as events
//
// Rules, applied on every event after expiry and the event itself:
//   1. A phone runs on at most one host. Its newest copy is on `host` (running, or the
//      host's disk cache) and, when not `unsaved`, also in R2 (version 0 is the template).
//   2. Waiters in FIFO order. A stopped, allowed phone starts on, first match:
//      a. the host with its copy, if online, enabled and with a free slot;
//      b. if R2 has the newest copy: the usable host with the most free slots, then slug;
//      c. else a slot freed by stopping the unleased running phone idle longest (at least
//         GRACE_MS), on a host the waiter can use; the waiter stays first in line;
//      d. else it keeps waiting. An unsaved phone waits for its host; only `recover` moves it.
//   3. A running phone without a lease keeps running until a waiter needs its slot.
//   4. Removed access ends the lease and rejects the waiters; the phone is idle from then.
//   5. A stop always uploads; R2 counts as newest only after the host reports the upload.
//   6. Only a host report frees a slot or a placement. A start or stop call that failed or
//      timed out proves nothing (the host may have done it): the phone keeps its state and
//      host until the host's status says what happened, however long it is offline.
//   7. A lease on a running phone is granted only while its host is online.

export const GRACE_MS = 10 * 60_000
export const DEFAULT_IDLE_TIMEOUT_S = 600
/** A plain acquire waits this long for the phone to start (or a slot to free). */
export const DEFAULT_START_WAIT_S = 300
/** Host polling while a start or stop is in flight. */
export const POLL_TRANSITION_MS = 3_000
/** Host polling while acquires wait for a host or a slot. */
export const POLL_WAITING_MS = 15_000
const SECOND_MS = 1_000

export type Host = {
  slug: string
  /** `10.77.0.1:7400`: the private IP routed to the host's tunnel (host.ts). */
  address: string
  /** Most phones running at once. */
  slots: number
  /** False drains the host: no new starts. */
  enabled: boolean
  /** The last status call answered. */
  online: boolean
  lastSeenAt: number | null
}

export type PhoneState = 'stored' | 'starting' | 'running' | 'stopping'

export type Phone = {
  id: string
  orgId: string
  /** VPhone template key: the start of a phone that never ran, and its model. */
  template: string
  /** The subscription allows leases. */
  allowed: boolean
  state: PhoneState
  /** Where it runs, or the host whose disk cache has its newest copy. */
  host: string | null
  /** Storage version of the newest copy. +1 on every stop. */
  version: number
  /** Newest version uploaded to R2. 0: never, the template is the copy. */
  r2Version: number
  /** The copy on `host` has changes that R2 does not: from a start until a stop uploads them. */
  unsaved: boolean
  /** When `state` last changed. */
  since: number
  /** The start or stop call to the host has not answered yet: its status may not show it. */
  callPending: boolean
  /** When its last lease ended, while it runs without one. */
  idleSince: number | null
}

export type Lease = {
  /** The `<n>` of `cloud:<n>`. */
  n: number
  phoneId: string
  orgId: string
  label?: string
  reason: string
  idleTimeoutS: number
  acquiredAt: number
  lastUsedAt: number
  lastCommand?: string
}

export type Waiter = {
  id: number
  phoneId: string
  orgId: string
  label?: string
  reason: string
  idleTimeoutS: number
  /** Wait for another lease to end instead of failing with device-leased. */
  wait: boolean
  /** End another lease of the phone and take it. */
  force: boolean
  createdAt: number
  deadline: number
}

/** Keys are strings: the state is JSON, stored one row per entry (fleet.ts). */
export type FleetState = {
  hosts: Record<string, Host>
  phones: Record<string, Phone>
  leases: Record<string, Lease>
  waiters: Record<string, Waiter>
  nextLease: number
  nextWaiter: number
}

/** One phone in a host's `GET /v1/status` (fleet API, docs/cloud-phones.md). */
export type HostPhone = {
  id: string
  state: 'starting' | 'running' | 'stopping' | 'stopped'
  /** Version of the local copy. */
  version: number
  /** Newest version this host uploaded. */
  uploadedVersion: number
  /** Why the last start or stop failed. */
  error?: string
}

export type FleetEvent =
  | { type: 'host-set'; at: number; slug: string; address: string; slots: number; enabled: boolean }
  | { type: 'host-removed'; at: number; slug: string }
  | { type: 'host-status'; at: number; slug: string; online: false }
  | { type: 'host-status'; at: number; slug: string; online: true; phones: HostPhone[] }
  | { type: 'access'; at: number; phoneId: string; orgId: string; template: string; allowed: boolean }
  | {
    type: 'acquire'
    at: number
    waiterId: number
    phoneId: string
    orgId: string
    label?: string
    reason: string
    idleTimeoutS: number
    /** Seconds to wait for another lease to end; absent fails at once while leased. */
    waitS?: number
    force?: boolean
  }
  /** The client of a waiting acquire went away. */
  | { type: 'cancel'; at: number; waiterId: number }
  | { type: 'release'; at: number; orgId: string; n: number }
  | { type: 'used'; at: number; orgId: string; n: number; command: string }
  | { type: 'tick'; at: number }
  /** The host answered the start or stop call (202): its status shows the phone from now on. */
  | { type: 'call-answered'; at: number; phoneId: string }
  /** The start or stop call failed or timed out: the host may or may not have done it. */
  | { type: 'call-failed'; at: number; phoneId: string; error: string }
  /** Operator: the host with the newest copy is gone; restart from the R2 version. */
  | { type: 'recover'; at: number; phoneId: string }
  /** The Durable Object restarted: the clients of waiting acquires are gone. */
  | { type: 'reset'; at: number }

export type RejectCode = 'device-not-found' | 'device-leased' | 'subscription-required' | 'tunnel-offline' | 'no-device' | 'internal-error'

export type FleetAction =
  | { type: 'start'; phoneId: string; host: string; version: number; template: string }
  | { type: 'stop'; phoneId: string; host: string; uploadVersion: number }
  | { type: 'grant'; waiterId: number; n: number; replaced?: Lease }
  | { type: 'reject'; waiterId: number; code: RejectCode; detail: string }

export function emptyFleet(): FleetState {
  return { hosts: {}, phones: {}, leases: {}, waiters: {}, nextLease: 1, nextWaiter: 1 }
}

export function step(previous: FleetState, event: FleetEvent): { state: FleetState; actions: FleetAction[] } {
  const state = structuredClone(previous)
  const actions: FleetAction[] = []
  expire({ state, at: event.at, actions })
  applyEvent({ state, event, actions })
  schedule({ state, at: event.at, actions })
  return { state, actions }
}

/** Replays a log from an empty fleet: what the test and a debugging session read. */
export function replay(events: FleetEvent[]): { state: FleetState; actions: FleetAction[][] } {
  let state = emptyFleet()
  const actions: FleetAction[][] = []
  for (const event of events) {
    const result = step(state, event)
    state = result.state
    actions.push(result.actions)
  }
  return { state, actions }
}

export function leaseOf(state: FleetState, phoneId: string): Lease | undefined {
  return Object.values(state.leases).find((lease) => lease.phoneId === phoneId)
}

export function leaseExpiresAt(lease: Lease): number {
  return lease.lastUsedAt + lease.idleTimeoutS * SECOND_MS
}

/** Hosts with a start or stop in flight need polling; so do hosts while acquires wait. */
export function needsPolling(state: FleetState): boolean {
  return inTransition(state) || Object.keys(state.waiters).length > 0
}

/** When the alarm must run next, or null when nothing can change by itself. */
export function nextWake(state: FleetState, now: number): number | null {
  const times: number[] = Object.values(state.leases).map(leaseExpiresAt)
  if (inTransition(state)) times.push(now + POLL_TRANSITION_MS)
  const waiters = Object.values(state.waiters)
  if (waiters.length) {
    times.push(now + POLL_WAITING_MS, ...waiters.map((w) => w.deadline))
    for (const phone of Object.values(state.phones)) {
      if (phone.state !== 'running' || phone.idleSince === null || leaseOf(state, phone.id)) continue
      // A passed deadline was already weighed by the last step: only new information helps now.
      if (phone.idleSince + GRACE_MS > now) times.push(phone.idleSince + GRACE_MS)
    }
  }
  return times.length ? Math.max(now, Math.min(...times)) : null
}

function inTransition(state: FleetState): boolean {
  return Object.values(state.phones).some((phone) => phone.state === 'starting' || phone.state === 'stopping')
}

function expire({ state, at, actions }: { state: FleetState; at: number; actions: FleetAction[] }): void {
  for (const lease of Object.values(state.leases)) {
    if (leaseExpiresAt(lease) <= at) endLease({ state, n: lease.n, at })
  }
  for (const waiter of sortedWaiters(state)) {
    if (waiter.deadline > at) continue
    const phone = state.phones[waiter.phoneId]
    delete state.waiters[waiter.id]
    actions.push({ type: 'reject', waiterId: waiter.id, ...timeoutReason({ state, phone, waiter }) })
  }
}

function timeoutReason({ state, phone, waiter }: { state: FleetState; phone?: Phone; waiter: Waiter }): { code: RejectCode; detail: string } {
  const waited = `waited ${Math.round((waiter.deadline - waiter.createdAt) / SECOND_MS)}s`
  const lease = phone && leaseOf(state, phone.id)
  if (lease) {
    return { code: 'device-leased', detail: `${waited}; the cloud iPhone is still used by ${describeHolder(lease)}. Give up or tell the user it is busy.` }
  }
  const host = phone?.host ? state.hosts[phone.host] : undefined
  if (phone?.unsaved && phone.state === 'stored' && !host?.online) {
    return { code: 'tunnel-offline', detail: `${waited}; the server that holds this cloud iPhone's newest data is offline. Try again later.` }
  }
  if (phone?.state === 'starting') return { code: 'no-device', detail: `${waited}; the cloud iPhone is still starting. Acquire again to keep waiting.` }
  return { code: 'no-device', detail: `${waited}; every cloud server is full right now. Acquire again later.` }
}

function applyEvent({ state, event, actions }: { state: FleetState; event: FleetEvent; actions: FleetAction[] }): void {
  const { at } = event
  switch (event.type) {
    case 'host-set': {
      const old = state.hosts[event.slug]
      state.hosts[event.slug] = {
        slug: event.slug, address: event.address, slots: event.slots, enabled: event.enabled,
        online: old?.online ?? false, lastSeenAt: old?.lastSeenAt ?? null,
      }
      return
    }
    case 'host-removed':
      delete state.hosts[event.slug]
      return
    case 'host-status': {
      const host = state.hosts[event.slug]
      if (!host) return
      host.online = event.online
      if (!event.online) return
      host.lastSeenAt = at
      reconcileHost({ state, slug: event.slug, reported: event.phones, at, actions })
      return
    }
    case 'access': {
      const phone = state.phones[event.phoneId]
      if (!phone) {
        state.phones[event.phoneId] = {
          id: event.phoneId, orgId: event.orgId, template: event.template, allowed: event.allowed,
          state: 'stored', host: null, version: 0, r2Version: 0, unsaved: false, since: at, callPending: false, idleSince: null,
        }
        return
      }
      phone.allowed = event.allowed
      if (event.allowed) return
      const lease = leaseOf(state, phone.id)
      if (lease) endLease({ state, n: lease.n, at })
      return
    }
    case 'acquire': {
      state.nextWaiter = Math.max(state.nextWaiter, event.waiterId + 1)
      state.waiters[event.waiterId] = {
        id: event.waiterId, phoneId: event.phoneId, orgId: event.orgId, label: event.label, reason: event.reason,
        idleTimeoutS: event.idleTimeoutS, wait: event.waitS !== undefined, force: event.force ?? false,
        createdAt: at, deadline: at + (event.waitS ?? DEFAULT_START_WAIT_S) * SECOND_MS,
      }
      return
    }
    case 'cancel':
      delete state.waiters[event.waiterId]
      return
    case 'release': {
      const lease = state.leases[event.n]
      if (lease?.orgId === event.orgId) endLease({ state, n: event.n, at })
      return
    }
    case 'used': {
      const lease = state.leases[event.n]
      if (lease?.orgId !== event.orgId) return
      lease.lastUsedAt = at
      lease.lastCommand = event.command
      return
    }
    case 'tick':
      return
    case 'call-answered': {
      const phone = state.phones[event.phoneId]
      if (phone) phone.callPending = false
      return
    }
    case 'call-failed': {
      const phone = state.phones[event.phoneId]
      if (!phone) return
      phone.callPending = false
      // The acquires stop waiting; the phone waits for the host's status (rule 6).
      if (phone.state === 'starting') rejectWaiters({ state, phoneId: phone.id, actions, detail: `the cloud iPhone did not start: ${event.error}. Try again in a minute.` })
      return
    }
    case 'recover': {
      const phone = state.phones[event.phoneId]
      if (!phone) return
      const lease = leaseOf(state, phone.id)
      if (lease) endLease({ state, n: lease.n, at })
      Object.assign(phone, { state: 'stored', host: null, version: phone.r2Version, unsaved: false, since: at, callPending: false, idleSince: null } satisfies Partial<Phone>)
      return
    }
    case 'reset':
      state.waiters = {}
      return
  }
}

/** Compares a host's report with the phones placed on it. */
function reconcileHost({ state, slug, reported, at, actions }: { state: FleetState; slug: string; reported: HostPhone[]; at: number; actions: FleetAction[] }): void {
  const byId = new Map(reported.map((phone) => [phone.id, phone]))
  for (const phone of Object.values(state.phones)) {
    if (phone.host !== slug) continue
    const report = byId.get(phone.id)
    switch (phone.state) {
      case 'starting':
        if (report?.state === 'running') {
          Object.assign(phone, { state: 'running', unsaved: true, since: at, callPending: false, idleSince: at } satisfies Partial<Phone>)
        } else if (report?.state === 'stopped' && report.error) {
          failStart({ state, phone, at, actions, error: report.error })
        } else if ((!report || report.state === 'stopped') && !phone.callPending) {
          // The call ended and the host does not run it: the start never happened. Waiters stay.
          Object.assign(phone, { state: 'stored', host: phone.unsaved ? phone.host : null, since: at } satisfies Partial<Phone>)
        }
        break
      case 'running':
        // Stopped without our stop (VM crash, host restart): the local copy is the newest.
        if (!report || report.state === 'stopped') {
          const lease = leaseOf(state, phone.id)
          if (lease) endLease({ state, n: lease.n, at })
          Object.assign(phone, { state: 'stored', unsaved: true, since: at, idleSince: null } satisfies Partial<Phone>)
        }
        break
      case 'stopping':
        if (report?.state === 'stopped' && report.uploadedVersion === phone.version + 1) {
          const version = report.uploadedVersion
          Object.assign(phone, { state: 'stored', version, r2Version: version, unsaved: false, since: at, idleSince: null } satisfies Partial<Phone>)
        } else if (report?.state === 'stopped' && report.error) {
          failStop({ phone, at })
        } else if (report?.state === 'running' && !phone.callPending) {
          // The stop call ended and the VM still runs: the stop never happened.
          Object.assign(phone, { state: 'running', since: at } satisfies Partial<Phone>)
        }
        break
      case 'stored':
        // The host evicted its cached copy; R2 has the same version.
        if (!report && !phone.unsaved) phone.host = null
        break
    }
  }
}

function failStart({ state, phone, at, actions, error }: { state: FleetState; phone: Phone; at: number; actions: FleetAction[]; error: string }): void {
  // A copy that existed only there stays there; a partial download is not a copy.
  Object.assign(phone, { state: 'stored', host: phone.unsaved ? phone.host : null, since: at, callPending: false } satisfies Partial<Phone>)
  rejectWaiters({ state, phoneId: phone.id, actions, detail: `the cloud iPhone did not start: ${error}. Try again; if it fails again, contact support.` })
}

function rejectWaiters({ state, phoneId, actions, detail }: { state: FleetState; phoneId: string; actions: FleetAction[]; detail: string }): void {
  for (const waiter of sortedWaiters(state)) {
    if (waiter.phoneId !== phoneId) continue
    delete state.waiters[waiter.id]
    actions.push({ type: 'reject', waiterId: waiter.id, code: 'internal-error', detail })
  }
}

/** A stop that did not upload: the VM is down, its changes exist only on the host. */
function failStop({ phone, at }: { phone: Phone; at: number }): void {
  Object.assign(phone, { state: 'stored', unsaved: true, since: at, callPending: false, idleSince: null } satisfies Partial<Phone>)
}

function endLease({ state, n, at }: { state: FleetState; n: number; at: number }): void {
  const lease = state.leases[n]
  if (!lease) return
  delete state.leases[n]
  const phone = state.phones[lease.phoneId]
  if (phone?.state === 'running') phone.idleSince = at
}

function sortedWaiters(state: FleetState): Waiter[] {
  return Object.values(state.waiters).sort((a, b) => a.id - b.id)
}

function usedSlots(state: FleetState, slug: string): number {
  return Object.values(state.phones).filter((phone) => phone.host === slug && phone.state !== 'stored').length
}

function freeSlots(state: FleetState, host: Host): number {
  return host.slots - usedSlots(state, host.slug)
}

function usable(host: Host | undefined): host is Host {
  return !!host && host.online && host.enabled
}

function schedule({ state, at, actions }: { state: FleetState; at: number; actions: FleetAction[] }): void {
  // Stops in flight free a slot each; the first waiters in line claim them.
  const freeing = new Map<string, number>()
  for (const phone of Object.values(state.phones)) {
    if (phone.state === 'stopping' && phone.host) freeing.set(phone.host, (freeing.get(phone.host) ?? 0) + 1)
  }
  const reject = (waiter: Waiter, code: RejectCode, detail: string) => {
    delete state.waiters[waiter.id]
    actions.push({ type: 'reject', waiterId: waiter.id, code, detail })
  }

  for (const waiter of sortedWaiters(state)) {
    const phone = state.phones[waiter.phoneId]
    if (!phone || phone.orgId !== waiter.orgId) {
      reject(waiter, 'device-not-found', 'this account has no such cloud iPhone. Call list for its cloud iPhones.')
      continue
    }
    if (!phone.allowed) {
      reject(waiter, 'subscription-required', 'the subscription of this cloud iPhone ended. Renew it on the dashboard: its data is kept.')
      continue
    }
    if (phone.state === 'running') {
      // Its host went quiet: the VM may be gone. The next status decides (rule 7).
      if (!state.hosts[phone.host!]?.online) continue
      const lease = leaseOf(state, phone.id)
      if (lease && waiter.force) endLease({ state, n: lease.n, at })
      else if (lease) {
        if (!waiter.wait) reject(waiter, 'device-leased', `the cloud iPhone is in use by ${describeHolder(lease)}. Decide first: if that task is still active, give up or tell the user the iPhone is busy.`)
        continue
      }
      const n = state.nextLease++
      state.leases[n] = {
        n, phoneId: phone.id, orgId: waiter.orgId, label: waiter.label, reason: waiter.reason,
        idleTimeoutS: waiter.idleTimeoutS, acquiredAt: at, lastUsedAt: at,
      }
      phone.idleSince = null
      delete state.waiters[waiter.id]
      actions.push({ type: 'grant', waiterId: waiter.id, n, ...(lease && waiter.force ? { replaced: lease } : {}) })
      continue
    }
    if (phone.state !== 'stored') continue

    const home = phone.host ? state.hosts[phone.host] : undefined
    const start = (host: Host) => {
      Object.assign(phone, { state: 'starting', host: host.slug, since: at, callPending: true, idleSince: null } satisfies Partial<Phone>)
      actions.push({ type: 'start', phoneId: phone.id, host: host.slug, version: phone.version, template: phone.template })
    }
    // a. Its own host: no download.
    if (usable(home) && freeSlots(state, home) > 0) {
      start(home)
      continue
    }
    // b. Anywhere, from R2.
    if (!phone.unsaved) {
      const best = Object.values(state.hosts)
        .filter((host) => usable(host) && freeSlots(state, host) > 0)
        .sort((a, b) => freeSlots(state, b) - freeSlots(state, a) || a.slug.localeCompare(b.slug))[0]
      if (best) {
        start(best)
        continue
      }
    }
    // c. Make room: claim a stop in flight, or stop the phone idle longest.
    const candidates = phone.unsaved ? (usable(home) ? [home] : []) : Object.values(state.hosts).filter(usable)
    const claimed = candidates.find((host) => (freeing.get(host.slug) ?? 0) > 0)
    if (claimed) {
      freeing.set(claimed.slug, freeing.get(claimed.slug)! - 1)
      continue
    }
    const slugs = new Set(candidates.map((host) => host.slug))
    const victim = Object.values(state.phones)
      .filter((p) => p.state === 'running' && p.host && slugs.has(p.host) && p.idleSince !== null && p.idleSince + GRACE_MS <= at && !leaseOf(state, p.id))
      .sort((a, b) => a.idleSince! - b.idleSince! || a.id.localeCompare(b.id))[0]
    if (victim) {
      Object.assign(victim, { state: 'stopping', since: at, callPending: true } satisfies Partial<Phone>)
      actions.push({ type: 'stop', phoneId: victim.id, host: victim.host!, uploadVersion: victim.version + 1 })
    }
    // d. Keep waiting.
  }
}

function describeHolder(lease: Lease): string {
  return `${lease.label ? `"${lease.label}"` : 'an unlabeled client'} for "${lease.reason}"`
}
