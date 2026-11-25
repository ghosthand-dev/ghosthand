// Where cloud iPhones run: Postgres holds every fact (cloud_host, the runtime columns of
// cloud_phone, cloud_lease), this file reads and writes it and calls the hosts. The rules
// are pure functions in scheduler.ts. Nothing runs on a timer here: expiry and grace are
// compared with now() in SQL, and a cron every minute moves the fleet forward.
//
//   acquire ──> decide(): one transaction, the phone row FOR UPDATE ──> lease, or a start or
//               a stop committed ──> waitUntil(advance()): the host call ──> poll, decide again
//   each command ──> useLease(): one UPDATE ... RETURNING, joined to the org and subscription
//   cron ──> runFleetCron(): host status, advance() for every placed phone, saves to R2
//
// advance() is level-triggered: it compares a phone's row with its host's report (reconcile)
// and writes the change with compare-and-set before any host call, so the cron and an acquire
// can both run it for one phone. The host refuses a second start or restore while one runs.

import { env, waitUntil } from 'cloudflare:workers'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getDb } from '../db.ts'
import { CLOUD_PHONE_ALLOWED_STATUSES, isCloudPhoneAllowed } from '../lib/billing.ts'
import { captureException, trackEvent } from '../telemetry.ts'
import { HostError, hostClient, type HostStatus } from './host.ts'
import { loadBatch, saveBatch } from './storage.ts'
import type { FleetLeaseRow, FleetRows } from './admin-view.ts'
import { DEFAULT_START_WAIT_S, HOST_ONLINE_MS, place, reconcile, type HostPhone, type PhoneState, type Placement } from './scheduler.ts'

const SECOND_MS = 1_000
/** Between two attempts of a waiting acquire. */
const ACQUIRE_POLL_MS = 3_000
/** One advance of one phone, host calls and a copy batch included. */
const ADVANCE_TIMEOUT_MS = 5 * 60_000
const POLL_TIMEOUT_MS = 6_000
/** Each chunk copy is 2 subrequests; an invocation may make 10,000. */
const CHUNKS_PER_RUN = 500
/** An acquire copies less per poll, so it answers on time. */
const CHUNKS_PER_ACQUIRE = 50
const HTTP_CONFLICT = 409
/** Leases on the admin page's activity list. */
const RECENT_LEASES = 30

/** Who holds a phone, like the daemon's LeaseInfo. Never the lease number. */
export type LeaseInfo = { label?: string; reason: string; acquiredAt: number; lastUsedAt: number; lastCommand?: string; expiresAt: number }

export type LeaseView = { n: number; phoneId: string; label?: string; reason: string; idleTimeoutS: number; expiresAt: number; replaced?: LeaseInfo }

export type RejectCode = 'device-not-found' | 'device-leased' | 'subscription-required' | 'tunnel-offline' | 'no-device' | 'cancelled'

export type AcquireResult = { ok: true; lease: LeaseView } | { ok: false; code: RejectCode; detail: string }

/** One of the org's paid cloud iPhones. */
export type FleetPhone = { phoneId: string; name: string; template: string; allowed: boolean; state: PhoneState; lease?: LeaseInfo }

/** What an input route needs for a live lease: the phone and where to reach it. */
export type LeaseTarget = { phoneId: string; template: string; address: string }

type LeaseRow = typeof schema.cloudLease.$inferSelect
type HostRow = typeof schema.cloudHost.$inferSelect
type Db = ReturnType<typeof getDb>

/** preview and production share the database; each Worker runs only the hosts its HOSTS binding reaches. */
function environment(): string {
  return env.ENVIRONMENT
}

const lease = schema.cloudLease
const phone = schema.cloudPhone
const host = schema.cloudHost
const liveLease = orm.sql`${lease.endedAt} is null and ${lease.lastUsedAt} + ${lease.idleTimeoutS} * interval '1 second' > now()`
const allowedStatuses = orm.sql.join(CLOUD_PHONE_ALLOWED_STATUSES.map((status) => orm.sql`${status}`), orm.sql`, `)

function leaseInfo(row: LeaseRow): LeaseInfo {
  return {
    label: row.label ?? undefined, reason: row.reason, acquiredAt: row.createdAt.getTime(), lastUsedAt: row.lastUsedAt.getTime(),
    lastCommand: row.lastCommand ?? undefined, expiresAt: row.lastUsedAt.getTime() + row.idleTimeoutS * SECOND_MS,
  }
}

function isOnline(row: HostRow, now: number): boolean {
  return row.lastSeenAt !== null && now - row.lastSeenAt.getTime() < HOST_ONLINE_MS
}

// ── tenants ──

/** The org's paid cloud iPhones (pending ones are not phones yet), oldest first. */
export async function listPhones({ orgId }: { orgId: string }): Promise<FleetPhone[]> {
  const rows = await getDb().query.cloudPhone.findMany({
    where: { orgId, subscriptionId: { isNotNull: true } },
    orderBy: { createdAt: 'asc' },
    with: { subscription: true, leases: { where: { endedAt: { isNull: true } }, orderBy: { cloudLeaseId: 'desc' }, limit: 1 } },
  })
  const now = Date.now()
  return rows.map((row) => {
    const live = row.leases[0] && leaseInfo(row.leases[0])
    return {
      phoneId: row.cloudPhoneId, name: row.name, template: row.template, allowed: isCloudPhoneAllowed(row.subscription?.status), state: row.state,
      ...(live && live.expiresAt > now ? { lease: live } : {}),
    }
  })
}

type AcquireInput = { orgId: string; phoneId: string; label?: string; reason: string; idleTimeoutS: number; waitS?: number; force?: boolean }

type Decision =
  | { kind: 'lease'; lease: LeaseView }
  | { kind: 'reject'; code: RejectCode; detail: string }
  | { kind: 'leased'; holder: LeaseRow }
  /** `advance`: phones whose state this decision changed: their host calls run after commit. */
  | { kind: 'wait'; reason: 'starting' | 'host-quiet' | Extract<Placement, { kind: 'wait' }>['reason']; advance: string[] }

/** Leases the phone now, or starts it (stopping an idle one for its slot) and polls until it
 *  runs. `waitS`: also wait for another lease to end, like `ghosthand wait`. */
export async function acquire(input: AcquireInput & { signal: AbortSignal }): Promise<AcquireResult> {
  const started = Date.now()
  const deadline = started + (input.waitS ?? DEFAULT_START_WAIT_S) * SECOND_MS
  let hostError: string | undefined
  for (;;) {
    // Pushes a start along, and checks the VM of a running phone still runs before leasing it.
    const pushed = advance({ phoneId: input.phoneId, budget: CHUNKS_PER_ACQUIRE, saves: false })
    waitUntil(pushed)
    const progress = await untilDeadline(pushed, deadline)
    hostError = progress?.error ?? hostError
    const decision = await decide({ ...input, hostAnswered: progress?.answered ?? false })
    if (decision.kind === 'lease') return { ok: true, lease: decision.lease }
    if (decision.kind === 'reject') return { ok: false, code: decision.code, detail: decision.detail }
    if (decision.kind === 'leased' && input.waitS === undefined) {
      return { ok: false, code: 'device-leased', detail: `the cloud iPhone is in use by ${describeHolder(decision.holder)}. Decide first: if that task is still active, give up or tell the user the iPhone is busy.` }
    }
    if (decision.kind === 'wait') {
      for (const phoneId of decision.advance) waitUntil(advance({ phoneId, budget: CHUNKS_PER_ACQUIRE, saves: false }))
    }
    if (input.signal.aborted) return { ok: false, code: 'cancelled', detail: 'the client went away' }
    if (Date.now() + ACQUIRE_POLL_MS > deadline) return timedOut({ decision, hostError, waitedS: Math.round((Date.now() - started) / SECOND_MS) })
    await sleep({ ms: ACQUIRE_POLL_MS, signal: input.signal })
  }
}

function timedOut({ decision, hostError, waitedS }: { decision: Decision; hostError?: string; waitedS: number }): AcquireResult {
  const waited = `waited ${waitedS}s`
  if (decision.kind === 'leased') return { ok: false, code: 'device-leased', detail: `${waited}; the cloud iPhone is still used by ${describeHolder(decision.holder)}. Give up or tell the user it is busy.` }
  const reason = decision.kind === 'wait' ? decision.reason : 'full'
  if (reason === 'host-offline' || reason === 'host-quiet') {
    return { ok: false, code: 'tunnel-offline', detail: `${waited}; the server that holds this cloud iPhone is offline. Try again later.` }
  }
  if (reason === 'starting') {
    return { ok: false, code: 'no-device', detail: `${waited}; the cloud iPhone is still starting${hostError ? ` (last server error: ${hostError})` : ''}. Acquire again to keep waiting.` }
  }
  return { ok: false, code: 'no-device', detail: `${waited}; every cloud server is full right now. Acquire again later.` }
}

/** One acquire attempt, in one transaction: the phone row is locked, so two acquires of one
 *  phone take turns, and the environment's host rows are locked before a placement, so two
 *  starts never count the same free slot. Host calls happen after commit. */
function decide(input: AcquireInput & { hostAnswered: boolean }): Promise<Decision> {
  const { orgId, phoneId } = input
  return getDb().transaction(async (tx): Promise<Decision> => {
    const [row] = await tx.select({ phone, status: schema.subscription.status })
      .from(phone)
      .leftJoin(schema.subscription, orm.eq(schema.subscription.subscriptionId, phone.subscriptionId))
      .where(orm.and(orm.eq(phone.cloudPhoneId, phoneId), orm.eq(phone.orgId, orgId), orm.isNotNull(phone.subscriptionId)))
      .for('update', { of: phone })
    if (!row) return { kind: 'reject', code: 'device-not-found', detail: 'this account has no such cloud iPhone. Call list for its cloud iPhones.' }
    if (!isCloudPhoneAllowed(row.status)) return { kind: 'reject', code: 'subscription-required', detail: 'the subscription of this cloud iPhone ended. Renew it on the dashboard: its data is kept.' }
    // Lock every unended lease, expired ones too: a command renewing one at its expiry commits
    // first, and the liveness read below sees its new last_used_at.
    await tx.select({ n: lease.cloudLeaseId }).from(lease).where(orm.and(orm.eq(lease.cloudPhoneId, phoneId), orm.isNull(lease.endedAt))).for('update')
    const [live] = await tx.select().from(lease).where(orm.and(orm.eq(lease.cloudPhoneId, phoneId), liveLease)).orderBy(orm.desc(lease.cloudLeaseId)).limit(1)
    if (live && !input.force) return { kind: 'leased', holder: live }

    if (row.phone.state === 'running') {
      // Its host did not answer just now: the VM may be gone. The next poll decides.
      if (!input.hostAnswered) return { kind: 'wait', reason: 'host-quiet', advance: [] }
      if (live) await tx.update(lease).set({ endedAt: orm.sql`now()` }).where(orm.eq(lease.cloudLeaseId, live.cloudLeaseId))
      const [created] = await tx.insert(lease).values({ cloudPhoneId: phoneId, label: input.label ?? null, reason: input.reason, idleTimeoutS: input.idleTimeoutS }).returning()
      const view = leaseInfo(created!)
      return {
        kind: 'lease',
        lease: {
          n: created!.cloudLeaseId, phoneId, label: view.label, reason: view.reason, idleTimeoutS: created!.idleTimeoutS,
          expiresAt: view.expiresAt, ...(live ? { replaced: leaseInfo(live) } : {}),
        },
      }
    }
    if (row.phone.state !== 'stored') return { kind: 'wait', reason: 'starting', advance: [] }

    const hosts = await tx.select().from(host).where(orm.eq(host.environment, environment())).orderBy(host.slug).for('update')
    const clock = (await tx.execute<{ now: Date }>(orm.sql`select now() as now`)).rows[0]!
    const nowMs = new Date(clock.now).getTime()
    const slugs = hosts.map((h) => h.slug)
    const placed = slugs.length ? await tx.select({ id: phone.cloudPhoneId, host: phone.hostSlug, state: phone.state, idleSince: idleSince() })
      .from(phone).where(orm.and(orm.inArray(phone.hostSlug, slugs), orm.ne(phone.state, 'stored'))) : []
    const placement = place({
      phone: { host: row.phone.hostSlug, version: row.phone.version, savedVersion: row.phone.savedVersion },
      hosts: hosts.map((h) => ({ slug: h.slug, slots: h.slots, usable: h.status === 'active' && isOnline(h, nowMs) })),
      placed: placed.map((p) => ({ id: p.id, host: p.host!, state: p.state, idleSince: p.idleSince ? new Date(p.idleSince).getTime() : null })),
      now: nowMs,
    })
    // Pushes the stops it waits for, so their slots free before the next cron.
    if (placement.kind === 'wait') return { kind: 'wait', reason: placement.reason, advance: placement.reason === 'freeing' ? placement.stopping : [] }
    if (placement.kind === 'start') {
      await tx.update(phone).set({ state: 'starting', hostSlug: placement.host, stateChangedAt: orm.sql`now()`, updatedAt: new Date() })
        .where(orm.eq(phone.cloudPhoneId, phoneId))
      return { kind: 'wait', reason: 'starting', advance: [phoneId] }
    }
    // A victim being acquired right now is locked: skip it and decide again at the next poll.
    const [victim] = await tx.select({ id: phone.cloudPhoneId }).from(phone)
      .where(orm.and(
        orm.eq(phone.cloudPhoneId, placement.victim), orm.eq(phone.state, 'running'),
        orm.notExists(tx.select({ n: lease.cloudLeaseId }).from(lease).where(orm.and(orm.eq(lease.cloudPhoneId, phone.cloudPhoneId), liveLease))),
      ))
      .for('update', { skipLocked: true })
    if (!victim) return { kind: 'wait', reason: 'full', advance: [] }
    await tx.update(phone).set({ state: 'stopping', stateChangedAt: orm.sql`now()`, updatedAt: new Date() }).where(orm.eq(phone.cloudPhoneId, victim.id))
    return { kind: 'wait', reason: 'freeing', advance: [victim.id] }
  })
}

/** A running phone without a live lease: when its last lease ended, or when it started. */
function idleSince() {
  return orm.sql<Date | null>`case when ${phone.state} <> 'running' then null
    when exists (select 1 from ${lease} where ${lease.cloudPhoneId} = ${phone.cloudPhoneId} and ${liveLease}) then null
    else greatest(${phone.stateChangedAt}, (select max(least(coalesce(${lease.endedAt}, 'infinity'), ${lease.lastUsedAt} + ${lease.idleTimeoutS} * interval '1 second'))
      from ${lease} where ${lease.cloudPhoneId} = ${phone.cloudPhoneId})) end`
}

/** False when the lease had already ended. */
export async function release({ orgId, n }: { orgId: string; n: number }): Promise<boolean> {
  const db = getDb()
  const ended = await db.update(lease).set({ endedAt: orm.sql`now()` })
    .where(orm.and(
      orm.eq(lease.cloudLeaseId, n), liveLease,
      orm.exists(db.select({ id: phone.cloudPhoneId }).from(phone).where(orm.and(orm.eq(phone.cloudPhoneId, lease.cloudPhoneId), orm.eq(phone.orgId, orgId)))),
    ))
    .returning()
  return ended.length > 0
}

/** The running phone of a live lease of this org, in one statement; it restarts the idle timeout.
 *  Another org's number, an ended subscription or a stopped VM all answer null. */
export async function useLease({ orgId, n, command }: { orgId: string; n: number; command: string }): Promise<LeaseTarget | null> {
  const { rows } = await getDb().execute<{ cloud_phone_id: string; template: string; address: string }>(orm.sql`
    update ${lease} set last_used_at = now(), last_command = ${command}
    from ${phone}
    join ${schema.subscription} on ${schema.subscription.subscriptionId} = ${phone.subscriptionId}
    join ${host} on ${host.slug} = ${phone.hostSlug}
    where ${lease.cloudLeaseId} = ${n} and ${lease.cloudPhoneId} = ${phone.cloudPhoneId} and ${phone.orgId} = ${orgId}
      and ${liveLease} and ${phone.state} = 'running' and ${schema.subscription.status} in (${allowedStatuses})
    returning ${phone.cloudPhoneId}, ${phone.template}, ${host.address}`)
  const row = rows[0]
  return row ? { phoneId: row.cloud_phone_id, template: row.template, address: row.address } : null
}

// ── moving phones forward ──

type Progress = {
  /** The phone's host answered its status call. */
  answered: boolean
  /** Chunks copied. */
  copied: number
  /** The host's last error for this phone, or a failed call. */
  error?: string
}

/** One advance per phone at a time in this isolate: an acquire's poll joins the one its
 *  waitUntil started. The cron runs in another isolate; the host refuses its overlapping calls. */
const advancing = new Map<string, Promise<Progress>>()

/** Reads the phone, asks its host, and takes the next step (scheduler.ts reconcile).
 *  `saves: false`: an acquire leaves copying a stored phone to R2 to the cron. */
function advance({ phoneId, budget, saves }: { phoneId: string; budget: number; saves: boolean }): Promise<Progress> {
  const running = advancing.get(phoneId)
  if (running) return running
  const work = (async (): Promise<Progress> => {
    const signal = AbortSignal.timeout(ADVANCE_TIMEOUT_MS)
    const db = getDb()
    const row = await db.query.cloudPhone.findFirst({ where: { cloudPhoneId: phoneId }, with: { host: true } })
    if (!row?.host || row.host.environment !== environment()) return { answered: false, copied: 0 }
    const status = await pollHost({ db, row: row.host, signal })
    if (status instanceof Error) return { answered: false, copied: 0, error: status.message }
    return { answered: true, ...await step({ db, row, hostRow: row.host, report: status.phones.find((p) => p.id === phoneId), budget, saves, signal }) }
  })().catch((cause) => {
    captureException(cause, { tags: { handler: 'cloud.advance' } })
    return { answered: false, copied: 0, error: cause instanceof Error ? cause.message : String(cause) }
  }).finally(() => advancing.delete(phoneId))
  advancing.set(phoneId, work)
  return work
}

/** Status of a host; an answer refreshes its last_seen_at and its slots (the host derives them
 *  from its RAM, so it is their only source). */
async function pollHost({ db, row, signal }: { db: Db; row: HostRow; signal: AbortSignal }): Promise<HostStatus | HostError> {
  const status = await hostClient(row.address).status({ signal: AbortSignal.any([signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]) })
  if (status instanceof Error) return status
  await db.update(host).set({ lastSeenAt: orm.sql`now()`, slots: status.slots }).where(orm.eq(host.slug, row.slug))
  return status
}

/** reconcile() for one phone, read before its host's report. The row is written only if it is
 *  still as read, and the host call is made only after that write. */
async function step({ db, row, hostRow, report, budget, saves, signal }: {
  db: Db; row: typeof schema.cloudPhone.$inferSelect; hostRow: HostRow; report: HostPhone | undefined; budget: number; saves: boolean; signal: AbortSignal
}): Promise<{ copied: number; error?: string }> {
  const next = reconcile({ phone: row, report })
  if (next.call === 'save' && !saves) return { copied: 0 }
  if (!next.state && next.version === undefined && !next.clearHost && !next.call) return { copied: 0, error: report?.error }
  const written = await db.update(phone)
    .set({
      updatedAt: new Date(),
      ...(next.state ? { state: next.state, stateChangedAt: orm.sql`now()` } : {}),
      ...(next.version !== undefined ? { version: next.version, saveCursor: 0 } : {}),
      ...(next.clearHost ? { hostSlug: null } : {}),
    })
    .where(orm.and(
      orm.eq(phone.cloudPhoneId, row.cloudPhoneId), orm.eq(phone.state, row.state), orm.eq(phone.version, row.version), orm.eq(phone.hostSlug, hostRow.slug),
      // Also claims the step: of two advances that read the same row, one sends the host call.
      // Milliseconds, as the row was read into a Date.
      orm.sql`date_trunc('milliseconds', ${phone.updatedAt}) = ${row.updatedAt}`,
    ))
    .returning()
  // Someone else moved or claimed the phone since it was read: their step wins.
  if (!written.length) return { copied: 0 }
  if (next.endLeases) await db.update(lease).set({ endedAt: orm.sql`now()` }).where(orm.and(orm.eq(lease.cloudPhoneId, row.cloudPhoneId), orm.isNull(lease.endedAt)))
  if (!next.call) return { copied: 0, error: report?.error }

  const client = hostClient(hostRow.address)
  const phoneId = row.cloudPhoneId
  const failed = (error: Error, copied = 0) => {
    // 409: the host is busy with this phone (another advance got there first).
    if (!(error instanceof HostError && error.status === HTTP_CONFLICT)) captureException(error, { tags: { handler: `cloud.${next.call}` } })
    return { copied, error: error.message }
  }
  switch (next.call) {
    case 'start': {
      const started = await client.start({ phoneId, version: row.version, template: row.template, signal })
      if (started instanceof Error) return failed(started)
      trackEvent('cloud_phone_started', { org_id: row.orgId, cloud_phone_id: phoneId })
      return { copied: 0 }
    }
    case 'stop': {
      const stopped = await client.stop({ phoneId, version: row.version + 1, signal })
      return stopped instanceof Error ? failed(stopped) : { copied: 0 }
    }
    case 'load': {
      const batch = await loadBatch({ host: client, phoneId, version: row.version, budget, signal })
      return batch instanceof Error ? failed(batch) : { copied: batch.copied }
    }
    case 'save': {
      const batch = await saveBatch({ host: client, phoneId, template: row.template, version: row.version, previous: row.savedVersion, next: row.saveCursor, budget, signal })
      if (batch instanceof Error) return failed(batch)
      await db.update(phone)
        .set(batch.done ? { savedVersion: row.version, saveCursor: 0, updatedAt: new Date() } : { saveCursor: batch.next, updatedAt: new Date() })
        .where(orm.and(orm.eq(phone.cloudPhoneId, phoneId), orm.eq(phone.version, row.version)))
      return { copied: batch.copied }
    }
  }
}

/** Every minute: asks each host of this environment for its status, then moves every phone
 *  placed on one (start, stop, crash, save to R2), CHUNKS_PER_RUN chunks at most. */
export async function runFleetCron(): Promise<{ hosts: number; online: number; phones: number; copied: number }> {
  const signal = AbortSignal.timeout(ADVANCE_TIMEOUT_MS)
  const db = getDb()
  const hosts = await db.query.cloudHost.findMany({ where: { environment: environment() } })
  // Rows first, reports second: a report is never older than the row it is compared with.
  const phones = hosts.length ? await db.query.cloudPhone.findMany({ where: { hostSlug: { in: hosts.map((h) => h.slug) } }, orderBy: { cloudPhoneId: 'asc' } }) : []
  const statuses = new Map(await Promise.all(hosts.map(async (h) => [h.slug, await pollHost({ db, row: h, signal })] as const)))
  let budget = CHUNKS_PER_RUN
  let copied = 0
  for (const row of phones) {
    const hostRow = hosts.find((h) => h.slug === row.hostSlug)!
    const status = statuses.get(hostRow.slug)
    if (!status || status instanceof Error) continue
    const done = await step({ db, row, hostRow, report: status.phones.find((p) => p.id === row.cloudPhoneId), budget: Math.max(budget, 0), saves: budget > 0, signal })
    budget -= done.copied
    copied += done.copied
  }
  const online = [...statuses.values()].filter((s) => !(s instanceof Error)).length
  return { hosts: hosts.length, online, phones: phones.length, copied }
}

// ── operator (scripts/cloud-host.ts through admin.ts) ──

export type HostView = { slug: string; address: string; slots: number; status: 'active' | 'draining'; online: boolean; lastSeenAt: number | null; running: number; cached: number }

export async function listHosts(): Promise<HostView[]> {
  const rows = await getDb().query.cloudHost.findMany({ where: { environment: environment() }, orderBy: { slug: 'asc' }, with: { phones: true } })
  const now = Date.now()
  return rows.map((row) => ({
    slug: row.slug, address: row.address, slots: row.slots, status: row.status, online: isOnline(row, now), lastSeenAt: row.lastSeenAt?.getTime() ?? null,
    running: row.phones.filter((p) => p.state !== 'stored').length, cached: row.phones.filter((p) => p.state === 'stored').length,
  }))
}

/** Adds or changes a host of this environment, then asks it for its status once. A new host has
 *  0 slots until it answers. */
export async function setHost({ slug, address, status }: { slug: string; address: string; status: 'active' | 'draining' }): Promise<HostView[] | Error> {
  const [row] = await getDb().insert(host).values({ slug, environment: environment(), address, slots: 0, status })
    .onConflictDoUpdate({ target: host.slug, set: { address, status }, setWhere: orm.eq(host.environment, environment()) })
    .returning()
  if (!row) return new Error(`host ${slug} belongs to another environment`)
  // An unreachable host is added anyway: the list shows it offline.
  const answer = await pollHost({ db: getDb(), row, signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
  if (answer instanceof Error) console.warn(`host ${slug} did not answer: ${answer.message}`)
  return listHosts()
}

/** Refused while the host runs a phone or holds the only copy of one. */
export async function removeHost({ slug }: { slug: string }): Promise<{ ok: true } | { ok: false; detail: string }> {
  const db = getDb()
  const busy = await db.query.cloudPhone.findMany({ where: { hostSlug: slug, OR: [{ state: { ne: 'stored' } }, { RAW: (t) => orm.sql`${t.version} > ${t.savedVersion}` }] } })
  if (busy.length) return { ok: false, detail: `${slug} runs or holds the newest copy of ${busy.map((p) => p.cloudPhoneId).join(', ')}: drain it and wait for the saves, or recover those phones first` }
  await db.delete(host).where(orm.and(orm.eq(host.slug, slug), orm.eq(host.environment, environment())))
  return { ok: true }
}

/** The host with the newest copy is gone: the phone restarts from its newest R2 version. */
export async function recover({ phoneId }: { phoneId: string }): Promise<{ version: number } | null> {
  const db = getDb()
  const [row] = await db.update(phone)
    .set({ state: 'stored', hostSlug: null, version: orm.sql`${phone.savedVersion}`, saveCursor: 0, stateChangedAt: orm.sql`now()`, updatedAt: new Date() })
    .where(orm.eq(phone.cloudPhoneId, phoneId))
    .returning()
  if (!row) return null
  await db.update(lease).set({ endedAt: orm.sql`now()` }).where(orm.and(orm.eq(lease.cloudPhoneId, phoneId), orm.isNull(lease.endedAt)))
  return { version: row.version }
}

/** Rows of the admin fleet page (admin-view.ts): this environment's hosts, every paid phone
 *  with its live lease and idle time, the latest lease activity, and each org's emails. */
export async function readFleet(): Promise<FleetRows> {
  const db = getDb()
  // Ordered by its newest event: its end (release, or the idle expiry if that came first) once
  // passed, else when it was acquired. A recover ends expired leases late; their expiry counts.
  const endedAt = orm.sql`least(coalesce(${lease.endedAt}, 'infinity'), ${lease.lastUsedAt} + ${lease.idleTimeoutS} * interval '1 second')`
  const activity = orm.sql`case when ${endedAt} <= now() then ${endedAt} else ${lease.createdAt} end`
  const [hosts, phones, live, recent] = await Promise.all([
    db.query.cloudHost.findMany({ where: { environment: environment() }, orderBy: { slug: 'asc' } }),
    db.select({ phone, subscriptionStatus: schema.subscription.status, idleSince: idleSince() })
      .from(phone)
      .leftJoin(schema.subscription, orm.eq(schema.subscription.subscriptionId, phone.subscriptionId))
      .where(orm.isNotNull(phone.subscriptionId))
      .orderBy(phone.cloudPhoneId),
    db.select().from(lease).where(liveLease),
    db.select().from(lease).orderBy(orm.desc(activity)).limit(RECENT_LEASES),
  ])
  const orgIds = [...new Set(phones.map((p) => p.phone.orgId))]
  const members = orgIds.length ? await db.query.orgMember.findMany({ where: { orgId: { in: orgIds } }, orderBy: { createdAt: 'asc' }, with: { user: true } }) : []
  const leaseRow = (row: LeaseRow): FleetLeaseRow => ({
    n: row.cloudLeaseId, phoneId: row.cloudPhoneId, label: row.label, reason: row.reason, idleTimeoutS: row.idleTimeoutS, lastCommand: row.lastCommand,
    createdAt: row.createdAt.getTime(), lastUsedAt: row.lastUsedAt.getTime(), endedAt: row.endedAt?.getTime() ?? null,
  })
  return {
    environment: environment(),
    hosts: hosts.map((h) => ({ slug: h.slug, address: h.address, slots: h.slots, status: h.status, lastSeenAt: h.lastSeenAt?.getTime() ?? null })),
    phones: phones.map(({ phone: p, subscriptionStatus, idleSince }) => ({
      phoneId: p.cloudPhoneId, name: p.name, orgId: p.orgId, state: p.state, hostSlug: p.hostSlug, version: p.version, savedVersion: p.savedVersion,
      stateChangedAt: p.stateChangedAt.getTime(), subscriptionStatus, idleSince: idleSince ? new Date(idleSince).getTime() : null,
    })),
    liveLeases: live.map(leaseRow),
    recentLeases: recent.map(leaseRow),
    orgs: orgIds.map((orgId) => ({ orgId, emails: members.filter((m) => m.orgId === orgId).flatMap((m) => (m.user ? [m.user.email] : [])) })),
  }
}

/** Every phone's runtime columns, for debugging a decision. */
export async function listFleetPhones() {
  const rows = await getDb().query.cloudPhone.findMany({ where: { subscriptionId: { isNotNull: true } }, orderBy: { cloudPhoneId: 'asc' } })
  return rows.map(({ cloudPhoneId, orgId, state, hostSlug, version, savedVersion, saveCursor, stateChangedAt }) => ({ cloudPhoneId, orgId, state, hostSlug, version, savedVersion, saveCursor, stateChangedAt }))
}

function describeHolder(row: LeaseRow): string {
  return `${row.label ? `"${row.label}"` : 'an unlabeled client'} for "${row.reason}"`
}

/** The promise's value, or undefined when the deadline passes first (the work goes on). */
async function untilDeadline<T>(promise: Promise<T>, deadline: number): Promise<T | undefined> {
  const done = new AbortController()
  const timeout = sleep({ ms: Math.max(0, deadline - Date.now()), signal: done.signal }).then(() => undefined)
  try {
    return await Promise.race([promise, timeout])
  } finally {
    done.abort()
  }
}

function sleep({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    if (signal.aborted) return done()
    signal.addEventListener('abort', done, { once: true })
  })
}
