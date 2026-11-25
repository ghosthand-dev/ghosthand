// CloudFleet: the one Durable Object that decides where cloud iPhones run. It is the only
// writer of runtime state (hosts, placement, versions, leases, waiting acquires), so every
// decision is serialized. Postgres keeps what was bought (cloud_phone); this keeps where it runs.
//
//   api.ts, webhook, scripts ──RPC──> apply(event) ──step()──> state + actions
//                                        │ saves changed rows      │ grant / reject: settle the acquire
//                                        │ logs the event          │ start / stop: host.ts, 202, then poll
//                                        ▼                         ▼
//                                 alarm: lease expiry, waiter deadlines, host polling every 3 s
//                                 only while a start or stop is in flight (no timer when idle),
//                                 and storage transfers (storage.ts), 500 chunks per run:
//                                   save: a stopped phone's new version, host to R2
//                                   load: before a start on a host without the copy, R2 to host
//
// Storage (SQLite KV), one row per entry so a tap writes two rows (its lease and its event):
//   host:<slug>  phone:<id>  lease:<n>  waiter:<id>  counters  event:<seq>  (last 1000 events)
//   transfer:<phone id>  a save or load in progress

import { DurableObject, env } from 'cloudflare:workers'
import { getHub } from '../tunnel.ts'
import { captureException, reportErrors, trackEvent } from '../telemetry.ts'
import { hostClient } from './host.ts'
import { loadBatch, saveBatch } from './storage.ts'
import {
  POLL_WAITING_MS,
  emptyFleet,
  leaseExpiresAt,
  leaseOf,
  needsPolling,
  nextWake,
  pendingSaves,
  step,
  type FleetAction,
  type FleetEvent,
  type FleetState,
  type Host,
  type Lease,
  type PhoneState,
  type RejectCode,
} from './scheduler.ts'

const EVENT_LOG_SIZE = 1000
const SEQ_DIGITS = 12
const POLL_TIMEOUT_MS = 6_000
const HOST_CALL_TIMEOUT_MS = 20_000
/** Each chunk copy is 2 subrequests; an invocation may make 10,000. */
const CHUNKS_PER_RUN = 500
/** A failed transfer batch is tried again after this. */
const TRANSFER_RETRY_MS = POLL_WAITING_MS
/** One batch, including the restore of a whole disk on the host. */
const TRANSFER_TIMEOUT_MS = 10 * 60_000
const TRANSFER_PREFIX = 'transfer:'
const COLLECTIONS = ['hosts', 'phones', 'leases', 'waiters'] as const
const PREFIX: Record<(typeof COLLECTIONS)[number], string> = { hosts: 'host:', phones: 'phone:', leases: 'lease:', waiters: 'waiter:' }

/** Who holds a phone, like the daemon's LeaseInfo. Never the lease number. */
export type LeaseInfo = { label?: string; reason: string; acquiredAt: number; lastUsedAt: number; lastCommand?: string; expiresAt: number }

export type LeaseView = { n: number; phoneId: string; label?: string; reason: string; idleTimeoutS: number; expiresAt: number; replaced?: LeaseInfo }

export type AcquireResult =
  | { ok: true; lease: LeaseView }
  | { ok: false; code: RejectCode | 'cancelled'; detail: string }

export type FleetPhone = {
  phoneId: string
  template: string
  allowed: boolean
  state: PhoneState
  lease?: LeaseInfo
  waiting: { label?: string; reason: string; since: number }[]
}

/** What an input route needs for a lease: the phone and where to reach it. */
export type LeaseTarget = { phoneId: string; template: string; host: string; address: string }

export type HostView = Host & { running: number; cached: number }

/** A save or load of one phone version, persisted across alarm runs. `next`: the first chunk
 *  of the next save batch (a load asks the host what is still missing instead). */
type Transfer = { kind: 'save' | 'load'; host: string; version: number; next: number; retryAt: number }

export function getFleet() {
  return env.CLOUD_FLEET.getByName('fleet')
}

export class CloudFleet extends DurableObject<Env> {
  private state: FleetState
  private alarmAt: number | null = null
  private lastEvent: { seq: number; event: FleetEvent } | null = null
  /** Acquires waiting in waitFor(), by waiter id. */
  private waiting = new Map<number, (result: AcquireResult) => void>()
  /** Settled before their client called waitFor(). */
  private settled = new Map<number, AcquireResult>()
  /** By phone id. Saves are created when pendingSaves lists a phone, loads by a start action. */
  private transfers: Record<string, Transfer> = {}

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.state = load(ctx.storage.kv)
    for (const [key, value] of ctx.storage.kv.list<Transfer>({ prefix: TRANSFER_PREFIX })) this.transfers[key.slice(TRANSFER_PREFIX.length)] = value
    void ctx.blockConcurrencyWhile(async () => {
      this.alarmAt = await ctx.storage.getAlarm()
      // The clients of waiting acquires lost their connection with the old instance.
      if (Object.keys(this.state.waiters).length) this.apply({ type: 'reset', at: this.now() })
    })
  }

  /** The org's cloud iPhones with their state, for `/v1/devices` and `list`. */
  async devices({ orgId }: { orgId: string }): Promise<FleetPhone[]> {
    const waiters = Object.values(this.state.waiters).sort((a, b) => a.id - b.id)
    return Object.values(this.state.phones)
      .filter((phone) => phone.orgId === orgId)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((phone) => {
        const lease = leaseOf(this.state, phone.id)
        return {
          phoneId: phone.id, template: phone.template, allowed: phone.allowed, state: phone.state,
          lease: lease && leaseInfo(lease),
          waiting: waiters.filter((w) => w.phoneId === phone.id).map((w) => ({ label: w.label, reason: w.reason, since: w.createdAt })),
        }
      })
  }

  /** Leases now, or starts the phone, or queues. `result` is set when it is decided at once;
   *  otherwise call waitFor(waiterId), and cancel(waiterId) when the client goes away. */
  async acquire(input: { orgId: string; phoneId: string; label?: string; reason: string; idleTimeoutS: number; waitS?: number; force?: boolean }): Promise<{ waiterId: number; result?: AcquireResult }> {
    // A running phone is leased only if its host still runs it: ask the host first.
    const phone = this.state.phones[input.phoneId]
    if (phone?.orgId === input.orgId && phone.state === 'running' && phone.host) await this.pollHost(phone.host)
    const waiterId = this.state.nextWaiter
    this.apply({ type: 'acquire', at: this.now(), waiterId, ...input })
    const result = this.settled.get(waiterId)
    this.settled.delete(waiterId)
    return { waiterId, result }
  }

  async waitFor({ waiterId }: { waiterId: number }): Promise<AcquireResult> {
    const done = this.settled.get(waiterId)
    if (done) {
      this.settled.delete(waiterId)
      return done
    }
    if (!this.state.waiters[waiterId]) return { ok: false, code: 'cancelled', detail: 'the wait ended (server restart). Acquire again.' }
    return new Promise((resolve) => this.waiting.set(waiterId, resolve))
  }

  async cancel({ waiterId }: { waiterId: number }): Promise<void> {
    if (this.state.waiters[waiterId]) this.apply({ type: 'cancel', at: this.now(), waiterId })
    this.settle(waiterId, { ok: false, code: 'cancelled', detail: 'the client went away' })
    this.settled.delete(waiterId)
  }

  /** False when the lease had already ended. */
  async release({ orgId, n }: { orgId: string; n: number }): Promise<boolean> {
    const lease = this.state.leases[n]
    if (!lease || lease.orgId !== orgId || leaseExpiresAt(lease) <= this.now()) return false
    this.apply({ type: 'release', at: this.now(), orgId, n })
    return true
  }

  /** The phone of a live lease of this org, and its host. Each call restarts the idle timeout. */
  async lease({ orgId, n, command }: { orgId: string; n: number; command: string }): Promise<LeaseTarget | null> {
    const now = this.now()
    const lease = this.state.leases[n]
    // Another org's number is unknown here: it must not even keep that lease alive.
    if (!lease || lease.orgId !== orgId) return null
    if (leaseExpiresAt(lease) <= now) {
      this.apply({ type: 'tick', at: now })
      return null
    }
    this.apply({ type: 'used', at: now, orgId, n, command })
    const phone = this.state.phones[lease.phoneId]
    const host = phone?.host ? this.state.hosts[phone.host] : undefined
    if (!phone || phone.state !== 'running' || !host) return null
    return { phoneId: phone.id, template: phone.template, host: host.slug, address: host.address }
  }

  /** From the Stripe webhook: a new phone, a renewal (allowed) or a cancel. Storage is kept. */
  async setAccess({ phoneId, orgId, template, allowed }: { phoneId: string; orgId: string; template: string; allowed: boolean }): Promise<void> {
    this.apply({ type: 'access', at: this.now(), phoneId, orgId, template, allowed })
    await getHub(orgId).setCloud(true)
  }

  // ── operator (scripts/cloud-host.ts through admin.ts) ──

  async setHost(host: { slug: string; address: string; slots: number; enabled: boolean }): Promise<HostView[]> {
    this.apply({ type: 'host-set', at: this.now(), ...host })
    await this.pollHost(host.slug)
    return this.hosts()
  }

  /** Refuses while the host runs a phone or holds the only copy of one. */
  async removeHost({ slug }: { slug: string }): Promise<{ ok: true } | { ok: false; detail: string }> {
    const busy = Object.values(this.state.phones).filter((p) => p.host === slug && (p.state !== 'stored' || p.unsaved))
    if (busy.length) return { ok: false, detail: `${slug} runs or holds the newest copy of ${busy.map((p) => p.id).join(', ')}: drain it and wait, or recover those phones first` }
    this.apply({ type: 'host-removed', at: this.now(), slug })
    return { ok: true }
  }

  /** The host with the newest copy is gone: the phone restarts from its newest R2 version. */
  async recover({ phoneId }: { phoneId: string }): Promise<{ ok: boolean; version?: number }> {
    if (!this.state.phones[phoneId]) return { ok: false }
    this.apply({ type: 'recover', at: this.now(), phoneId })
    return { ok: true, version: this.state.phones[phoneId]!.version }
  }

  async hosts(): Promise<HostView[]> {
    const phones = Object.values(this.state.phones)
    return Object.values(this.state.hosts).sort((a, b) => a.slug.localeCompare(b.slug)).map((host) => ({
      ...host,
      running: phones.filter((p) => p.host === host.slug && p.state !== 'stored').length,
      cached: phones.filter((p) => p.host === host.slug && p.state === 'stored').length,
    }))
  }

  /** The whole state and the newest events, for debugging a decision. */
  async snapshot({ events = 100 }: { events?: number } = {}): Promise<{ state: FleetState; events: FleetEvent[] }> {
    // kv.list throws on limit 0.
    const log = events ? [...this.ctx.storage.kv.list<FleetEvent>({ prefix: 'event:', reverse: true, limit: events })].map(([, event]) => event).reverse() : []
    return { state: this.state, events: log }
  }

  async alarm(): Promise<void> {
    await reportErrors('CloudFleet.alarm', async () => {
      this.alarmAt = null
      this.apply({ type: 'tick', at: this.now() })
      if (needsPolling(this.state)) await Promise.all(Object.keys(this.state.hosts).map((slug) => this.pollHost(slug)))
      await this.runTransfers()
      this.scheduleAlarm()
    })
  }

  /** Overridden by tests to move the clock. */
  protected now(): number {
    return Date.now()
  }

  /** The transfers that still apply to the fleet state; others are dropped (e.g. a phone that
   *  started again before its save ended: its next stop makes a newer version). */
  private liveTransfers(): [string, Transfer][] {
    const live: [string, Transfer][] = []
    for (const phone of pendingSaves(this.state)) {
      const saved = this.transfers[phone.id]
      const fresh = saved?.kind === 'save' && saved.version === phone.version && saved.host === phone.host
      live.push([phone.id, fresh ? saved : { kind: 'save', host: phone.host!, version: phone.version, next: 0, retryAt: 0 }])
    }
    for (const [phoneId, transfer] of Object.entries(this.transfers)) {
      const phone = this.state.phones[phoneId]
      if (transfer.kind === 'load' && phone?.state === 'starting' && phone.callPending && phone.host === transfer.host) live.push([phoneId, transfer])
    }
    return live
  }

  private setTransfer(phoneId: string, transfer: Transfer | null): void {
    if (transfer) this.transfers[phoneId] = transfer
    else delete this.transfers[phoneId]
    if (transfer) this.ctx.storage.kv.put(TRANSFER_PREFIX + phoneId, transfer)
    else this.ctx.storage.kv.delete(TRANSFER_PREFIX + phoneId)
  }

  /** Copies up to CHUNKS_PER_RUN chunks, one transfer after another; the alarm comes back for more. */
  private async runTransfers(): Promise<void> {
    const live = this.liveTransfers()
    const ids = new Set(live.map(([phoneId]) => phoneId))
    for (const phoneId of Object.keys(this.transfers)) if (!ids.has(phoneId)) this.setTransfer(phoneId, null)
    let budget = CHUNKS_PER_RUN
    for (const [phoneId, transfer] of live) {
      if (budget <= 0) return
      if (transfer.retryAt > this.now()) continue
      const phone = this.state.phones[phoneId]!
      const host = this.state.hosts[transfer.host]
      if (!host) continue
      const client = hostClient(host.address)
      const signal = AbortSignal.timeout(TRANSFER_TIMEOUT_MS)
      const batch = transfer.kind === 'save'
        ? await saveBatch({ host: client, phoneId, template: phone.template, version: transfer.version, previous: phone.r2Version, next: transfer.next, budget, signal })
        : await loadBatch({ host: client, phoneId, version: transfer.version, budget, signal })
      if (batch instanceof Error) {
        captureException(batch, { tags: { handler: `CloudFleet.${transfer.kind}` } })
        if (transfer.kind === 'load') {
          // Like a failed start call: the waiters hear it, the host's status decides the rest.
          this.setTransfer(phoneId, null)
          this.apply({ type: 'call-failed', at: this.now(), phoneId, error: `copying its data to the server failed: ${batch.message}` })
          continue
        }
        this.setTransfer(phoneId, { ...transfer, retryAt: this.now() + TRANSFER_RETRY_MS })
        // An offline host drops the save from pendingSaves until it answers again.
        await this.pollHost(transfer.host)
        continue
      }
      budget -= batch.copied
      if (!batch.done) {
        this.setTransfer(phoneId, { ...transfer, next: batch.next })
        continue
      }
      this.setTransfer(phoneId, null)
      if (transfer.kind === 'save') {
        this.apply({ type: 'saved', at: this.now(), phoneId, version: transfer.version })
        continue
      }
      await this.callHost({ type: 'start', phoneId, host: transfer.host, version: transfer.version, template: phone.template, load: false })
    }
  }

  private async pollHost(slug: string): Promise<void> {
    const host = this.state.hosts[slug]
    if (!host) return
    const status = await hostClient(host.address).status({ signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
    if (status instanceof Error) return void this.apply({ type: 'host-status', at: this.now(), slug, online: false })
    this.apply({ type: 'host-status', at: this.now(), slug, online: true, phones: status.phones })
  }

  /** One step: save the changed rows and the event, then run the actions. Synchronous up to
   *  the host calls, so no other event can interleave with a decision. */
  private apply(event: FleetEvent): void {
    const { state, actions } = step(this.state, event)
    const changed = save({ kv: this.ctx.storage.kv, before: this.state, after: state })
    this.state = state
    // An event that changed nothing cannot change a replay: no row for it.
    if (changed || actions.length) this.log(event)
    for (const action of actions) this.perform(action)
    this.scheduleAlarm()
  }

  private perform(action: FleetAction): void {
    switch (action.type) {
      case 'grant': {
        const lease = this.state.leases[action.n]!
        return this.settle(action.waiterId, {
          ok: true,
          lease: {
            n: lease.n, phoneId: lease.phoneId, label: lease.label, reason: lease.reason, idleTimeoutS: lease.idleTimeoutS,
            expiresAt: leaseExpiresAt(lease), replaced: action.replaced && leaseInfo(action.replaced),
          },
        })
      }
      case 'reject':
        return this.settle(action.waiterId, { ok: false, code: action.code, detail: action.detail })
      case 'start':
        if (action.load) return this.setTransfer(action.phoneId, { kind: 'load', host: action.host, version: action.version, next: 0, retryAt: 0 })
        return this.ctx.waitUntil(this.callHost(action))
      case 'stop':
        return this.ctx.waitUntil(this.callHost(action))
    }
  }

  /** The host answers 202 at once; polling sees the end. The call's outcome is an event. */
  private async callHost(action: Extract<FleetAction, { type: 'start' | 'stop' }>): Promise<void> {
    const host = this.state.hosts[action.host]
    const phone = this.state.phones[action.phoneId]
    if (!host || !phone) return
    const client = hostClient(host.address)
    const signal = AbortSignal.timeout(HOST_CALL_TIMEOUT_MS)
    const result = action.type === 'start'
      ? await client.start({ phoneId: action.phoneId, version: action.version, template: action.template, signal })
      : await client.stop({ phoneId: action.phoneId, version: action.version, signal })
    if (!(result instanceof Error)) {
      if (action.type === 'start') trackEvent('cloud_phone_started', { org_id: phone.orgId, cloud_phone_id: phone.id })
      return this.apply({ type: 'call-answered', at: this.now(), phoneId: action.phoneId })
    }
    captureException(result, { tags: { handler: `CloudFleet.${action.type}` } })
    this.apply({ type: 'call-failed', at: this.now(), phoneId: action.phoneId, error: result.message })
  }

  private settle(waiterId: number, result: AcquireResult): void {
    const resolve = this.waiting.get(waiterId)
    this.waiting.delete(waiterId)
    if (resolve) resolve(result)
    else this.settled.set(waiterId, result)
  }

  /** One alarm at the next deadline; it never moves later while one is set. */
  private scheduleAlarm(): void {
    const now = this.now()
    const times = [nextWake(this.state, now), ...this.liveTransfers().map(([, t]) => Math.max(now, t.retryAt))].filter((t) => t !== null)
    const wake = times.length ? Math.min(...times) : null
    if (wake === null) {
      if (this.alarmAt === null) return
      this.alarmAt = null
      void this.ctx.storage.deleteAlarm()
      return
    }
    if (this.alarmAt !== null && this.alarmAt <= wake) return
    this.alarmAt = wake
    void this.ctx.storage.setAlarm(wake)
  }

  /** Appends the event; repeated `used` of one lease replace each other (only the last counts). */
  private log(event: FleetEvent): void {
    const kv = this.ctx.storage.kv
    const last = this.lastEvent ?? { seq: kv.get<number>('eventSeq') ?? 0, event: null }
    const coalesce = event.type === 'used' && last.event?.type === 'used' && last.event.n === event.n
    const seq = coalesce ? last.seq : last.seq + 1
    kv.put(`event:${pad(seq)}`, event)
    if (!coalesce) {
      kv.put('eventSeq', seq)
      if (seq > EVENT_LOG_SIZE) kv.delete(`event:${pad(seq - EVENT_LOG_SIZE)}`)
    }
    this.lastEvent = { seq, event }
  }
}

function leaseInfo(lease: Lease): LeaseInfo {
  return { label: lease.label, reason: lease.reason, acquiredAt: lease.acquiredAt, lastUsedAt: lease.lastUsedAt, lastCommand: lease.lastCommand, expiresAt: leaseExpiresAt(lease) }
}

function load(kv: SyncKvStorage): FleetState {
  const state = emptyFleet()
  for (const name of COLLECTIONS) {
    const target = state[name] as Record<string, unknown>
    for (const [key, value] of kv.list({ prefix: PREFIX[name] })) target[key.slice(PREFIX[name].length)] = value
  }
  const counters = kv.get<{ nextLease: number; nextWaiter: number }>('counters')
  if (counters) Object.assign(state, counters)
  return state
}

/** Writes the rows that differ. Returns how many. */
function save({ kv, before, after }: { kv: SyncKvStorage; before: FleetState; after: FleetState }): number {
  let changed = 0
  for (const name of COLLECTIONS) {
    const old = before[name] as Record<string, unknown>
    const next = after[name] as Record<string, unknown>
    for (const [key, value] of Object.entries(next)) {
      if (JSON.stringify(old[key]) === JSON.stringify(value)) continue
      kv.put(PREFIX[name] + key, value)
      changed++
    }
    for (const key of Object.keys(old)) {
      if (key in next) continue
      kv.delete(PREFIX[name] + key)
      changed++
    }
  }
  if (before.nextLease !== after.nextLease || before.nextWaiter !== after.nextWaiter) {
    kv.put('counters', { nextLease: after.nextLease, nextWaiter: after.nextWaiter })
    changed++
  }
  return changed
}

function pad(n: number): string {
  return String(n).padStart(SEQ_DIGITS, '0')
}
