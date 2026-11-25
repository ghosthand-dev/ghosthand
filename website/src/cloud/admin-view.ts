// The admin fleet page and `GET /api/cloud-admin/view` as one value. Pure: fleet.ts reads the
// rows (readFleet), admin.ts asks every host for its live status (never stored), and these
// functions build the view and list what is wrong.
//
//   loadFleetView() in admin.ts ──> readFleet() + GET /v1/status of each host
//        ──> buildFleetView() ──> fleetProblems() ──> /admin/fleet page, GET /api/cloud-admin/view

import { isCloudPhoneAllowed } from '../lib/billing.ts'
import type { HostStatus } from './host.ts'
import { GRACE_MS, HOST_ONLINE_MS, type HostPhone, type PhoneState } from './scheduler.ts'

const SECOND_MS = 1_000
const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const HOURS_BEFORE_DAYS = 48
const GIB = 1024 ** 3
const GB = 1e9
const TB = 1e12
/** Slot size and macOS reserve of hosts that do not report them (plans/decisions/cloud-vm-memory.md). */
export const DEFAULT_VM_MEMORY_BYTES = 2 * GIB
export const DEFAULT_RESERVE_BYTES = 4 * GIB
const SWAP_WARNING_BYTES = 1 * GIB
const LOW_DISK_BYTES = 50 * GB
const CRITICAL_DISK_BYTES = 15 * GB
/** A start or a stop that takes longer is stuck. */
const STUCK_MS = 15 * MINUTE_MS
const RECENT_EVENTS = 20
/** One color per org on every admin page, picked by orgColor(). */
export const ORG_COLORS = ['#5B7BD5', '#3E9C8F', '#C8924A', '#B86A84', '#8473C9', '#6B9A5A', '#4C93B8', '#B07A5E'] as const

// ── rows (fleet.ts readFleet) and live host answers (admin.ts) ──

export type FleetHostRow = { slug: string; address: string; slots: number; status: 'active' | 'draining'; lastSeenAt: number | null }

export type FleetPhoneRow = {
  phoneId: string
  name: string
  orgId: string
  state: PhoneState
  hostSlug: string | null
  /** first_run_at is set: its VM must be on its host. */
  ran: boolean
  stateChangedAt: number
  subscriptionStatus: string | null
  /** Running without a live lease: since when (fleet.ts idleSince). */
  idleSince: number | null
}

export type FleetLeaseRow = {
  n: number
  phoneId: string
  label: string | null
  reason: string
  idleTimeoutS: number
  lastCommand: string | null
  createdAt: number
  lastUsedAt: number
  endedAt: number | null
}

export type FleetRows = {
  environment: string
  hosts: FleetHostRow[]
  /** Every paid phone, of every environment. */
  phones: FleetPhoneRow[]
  liveLeases: FleetLeaseRow[]
  /** The latest lease activity, newest first. */
  recentLeases: FleetLeaseRow[]
  orgs: { orgId: string; emails: string[] }[]
}

/** One host's answer to GET /v1/status during this page load. */
export type HostProbe = { slug: string; ms: number; status: HostStatus | null; error: string | null }

// ── the view ──

export type FleetPhone = {
  phoneId: string
  name: string
  orgId: string
  email: string | null
  /** Index in ORG_COLORS. */
  color: number
  state: PhoneState
  host: string | null
  ran: boolean
  stateChangedAt: number
  lease: { n: number; label: string | null; reason: string; lastUsedAt: number; lastCommand: string | null; expiresAt: number } | null
  idleSince: number | null
  /** When the scheduler may stop it to free its slot: idle since + grace. */
  evictableAt: number | null
  /** Its host's report of it in this load. */
  report: HostPhone | null
}

export type FleetHost = {
  slug: string
  address: string
  status: 'active' | 'draining'
  slots: number
  lastSeenAt: number | null
  /** Seen by the cron within HOST_ONLINE_MS: the scheduler's view. */
  online: boolean
  /** Online and active: new phones may start here. */
  usable: boolean
  /** Round trip of this load's status call. */
  ms: number
  error: string | null
  report: Omit<HostStatus, 'phones'> | null
  /** Phones taking a slot: starting, running or stopping. */
  placed: FleetPhone[]
  /** Stopped phones pinned to this host: their VM is on its disk. */
  stopped: FleetPhone[]
  /** Phones that ran here and are missing from this load's report: their VM is lost. */
  lost: FleetPhone[]
  free: number
  /** Sum of the placed VMs' footprints, when every one reported it. */
  footprintBytes: number | null
}

export type LeaseEvent = {
  at: number
  kind: 'acquired' | 'ended' | 'expired'
  n: number
  phoneId: string
  color: number | null
  host: string | null
  label: string | null
  reason: string
  /** ended and expired: how long the lease lasted. */
  heldMs: number | null
}

export type FleetCustomer = { orgId: string; emails: string[]; color: number; phones: number; running: number; leased: number }

export type FleetView = {
  environment: string
  at: number
  totals: { slots: number; used: number; leased: number; transitions: number; hosts: number; online: number; sold: number }
  hosts: FleetHost[]
  contention: {
    /** Usable hosts with no free slot. */
    full: string[]
    /** Starting or stopping, oldest first. */
    transitions: FleetPhone[]
    /** Running without a lease, the next one the scheduler stops first. */
    idle: FleetPhone[]
  }
  leases: LeaseEvent[]
  customers: FleetCustomer[]
}

export type FleetProblem = {
  severity: 'critical' | 'warning'
  code: 'host-offline' | 'host-memory-pressure' | 'host-low-disk' | 'bundle-versions-differ' | 'phone-lost' | 'phone-stuck' | 'fleet-full' | 'no-usable-host'
  host?: string
  phone?: string
  detail: string
}

/** FNV-1a of the org id: the same color for an org on every page and every load. */
export function orgColor(orgId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < orgId.length; i++) hash = Math.imul(hash ^ orgId.charCodeAt(i), 0x01000193)
  return (hash >>> 0) % ORG_COLORS.length
}

export function buildFleetView({ rows, probes, now }: { rows: FleetRows; probes: HostProbe[]; now: number }): FleetView {
  const emails = new Map(rows.orgs.map((org) => [org.orgId, org.emails]))
  const live = new Map<string, FleetLeaseRow>()
  for (const row of rows.liveLeases) if ((live.get(row.phoneId)?.n ?? -1) < row.n) live.set(row.phoneId, row)
  const probeOf = new Map(probes.map((probe) => [probe.slug, probe]))

  const phones = rows.phones.map((row): FleetPhone => {
    const lease = live.get(row.phoneId)
    const report = row.hostSlug ? probeOf.get(row.hostSlug)?.status?.phones.find((p) => p.id === row.phoneId) ?? null : null
    return {
      phoneId: row.phoneId, name: row.name, orgId: row.orgId, email: emails.get(row.orgId)?.[0] ?? null, color: orgColor(row.orgId),
      state: row.state, host: row.hostSlug, ran: row.ran, stateChangedAt: row.stateChangedAt,
      lease: lease ? {
        n: lease.n, label: lease.label, reason: lease.reason, lastUsedAt: lease.lastUsedAt, lastCommand: lease.lastCommand,
        expiresAt: lease.lastUsedAt + lease.idleTimeoutS * SECOND_MS,
      } : null,
      idleSince: row.idleSince,
      evictableAt: row.idleSince === null ? null : row.idleSince + GRACE_MS,
      report,
    }
  })

  const hosts = rows.hosts.map((row): FleetHost => {
    const probe = probeOf.get(row.slug)
    const online = row.lastSeenAt !== null && now - row.lastSeenAt < HOST_ONLINE_MS
    const here = phones.filter((p) => p.host === row.slug)
    const placed = here.filter((p) => p.state !== 'stopped').sort((a, b) => cellOrder(a) - cellOrder(b) || a.phoneId.localeCompare(b.phoneId))
    const footprints = placed.map((p) => p.report?.footprintBytes)
    return {
      slug: row.slug, address: row.address, status: row.status, slots: row.slots, lastSeenAt: row.lastSeenAt, online,
      usable: online && row.status === 'active', ms: probe?.ms ?? 0, error: probe?.error ?? null,
      report: probe?.status ? hostReport(probe.status) : null,
      placed, stopped: here.filter((p) => p.state === 'stopped'), free: row.slots - placed.length,
      lost: probe?.status ? here.filter((p) => p.ran && !p.report) : [],
      footprintBytes: placed.length && footprints.every((f) => f !== undefined) ? footprints.reduce((sum, f) => sum + f!, 0) : null,
    }
  })

  const onHosts = hosts.flatMap((h) => h.placed)
  const byPhone = new Map(phones.map((p) => [p.phoneId, p]))
  const leases = rows.recentLeases.flatMap((row): LeaseEvent[] => {
    const phone = byPhone.get(row.phoneId)
    const base = { n: row.n, phoneId: row.phoneId, color: phone?.color ?? null, host: phone?.host ?? null, label: row.label, reason: row.reason }
    const events: LeaseEvent[] = [{ ...base, at: row.createdAt, kind: 'acquired', heldMs: null }]
    // A crashed VM ends leases that had already expired: the expiry came first.
    const expiry = row.lastUsedAt + row.idleTimeoutS * SECOND_MS
    if (row.endedAt !== null && row.endedAt <= expiry) events.push({ ...base, at: row.endedAt, kind: 'ended', heldMs: row.endedAt - row.createdAt })
    else if (expiry <= now) events.push({ ...base, at: expiry, kind: 'expired', heldMs: expiry - row.createdAt })
    return events
  }).sort((a, b) => b.at - a.at || b.n - a.n).slice(0, RECENT_EVENTS)

  const customers = rows.orgs.map((org): FleetCustomer => {
    const owned = phones.filter((p) => p.orgId === org.orgId)
    return {
      orgId: org.orgId, emails: org.emails, color: orgColor(org.orgId), phones: owned.length,
      running: owned.filter((p) => p.state === 'running').length, leased: owned.filter((p) => p.lease).length,
    }
  }).sort((a, b) => b.phones - a.phones || (a.emails[0] ?? a.orgId).localeCompare(b.emails[0] ?? b.orgId))

  return {
    environment: rows.environment,
    at: now,
    totals: {
      slots: hosts.reduce((sum, h) => sum + h.slots, 0), used: onHosts.length, leased: onHosts.filter((p) => p.lease).length,
      transitions: onHosts.filter((p) => p.state === 'starting' || p.state === 'stopping').length,
      hosts: hosts.length, online: hosts.filter((h) => h.online && !h.error).length,
      sold: rows.phones.filter((p) => isCloudPhoneAllowed(p.subscriptionStatus)).length,
    },
    hosts,
    contention: {
      full: hosts.filter((h) => h.usable && h.free <= 0).map((h) => h.slug),
      transitions: onHosts.filter((p) => p.state === 'starting' || p.state === 'stopping').sort((a, b) => a.stateChangedAt - b.stateChangedAt),
      idle: onHosts.filter((p) => p.state === 'running' && !p.lease && p.idleSince !== null).sort((a, b) => a.idleSince! - b.idleSince! || a.phoneId.localeCompare(b.phoneId)),
    },
    leases,
    customers,
  }
}

/** The host part of a status; its phones are in each FleetPhone's report. */
function hostReport({ phones: _phones, ...host }: HostStatus): Omit<HostStatus, 'phones'> {
  return host
}

/** Slot cells left to right: leased, unleased, then phones in a transition. */
function cellOrder(phone: FleetPhone): number {
  if (phone.state !== 'running') return 2
  return phone.lease ? 0 : 1
}

/** What needs the operator, critical first. The JSON route answers `ok` when this is empty. */
export function fleetProblems(view: FleetView, now: number): FleetProblem[] {
  const problems: FleetProblem[] = []
  for (const host of view.hosts) {
    const holds = host.placed.length + host.stopped.length
    const seen = host.lastSeenAt === null ? 'has never answered the cron' : `was last seen by the cron ${formatDuration(now - host.lastSeenAt)} ago`
    if (!host.online || host.error) {
      const why = host.error ? `did not answer now (${host.error})` : 'answered now'
      const phones = holds ? ` Its disk holds the only copy of ${holds} ${holds === 1 ? 'phone' : 'phones'}: they cannot start until it is back.` : ''
      problems.push({ severity: !host.online && holds ? 'critical' : 'warning', code: 'host-offline', host: host.slug, detail: `${host.slug} ${why} and ${seen}.${phones}` })
    }
    const report = host.report
    if (!report) continue
    const machine = report.machine
    const swap = machine?.swapUsedBytes ?? 0
    if (machine && (machine.pressure !== 'normal' || swap > SWAP_WARNING_BYTES)) {
      problems.push({
        severity: machine.pressure === 'critical' ? 'critical' : 'warning', code: 'host-memory-pressure', host: host.slug,
        detail: `${host.slug} is at memory pressure ${machine.pressure} with ${formatGiB(swap)} swap. Add the per-VM overhead constant (plans/decisions/cloud-vm-memory.md).`,
      })
    }
    if (report.freeDiskBytes < LOW_DISK_BYTES) {
      problems.push({
        severity: report.freeDiskBytes < CRITICAL_DISK_BYTES ? 'critical' : 'warning', code: 'host-low-disk', host: host.slug,
        detail: `${host.slug} has ${formatDisk(report.freeDiskBytes)} of free disk.`,
      })
    }
    for (const phone of host.lost) {
      problems.push({
        severity: 'critical', code: 'phone-lost', host: host.slug, phone: phone.phoneId,
        detail: `${host.slug} no longer reports ${phone.phoneId} (${phone.email ?? phone.orgId}), which ran there. Restore the host's disk from its machine backup; until then its user is told the phone is lost.`,
      })
    }
  }

  const versions = view.hosts.flatMap((h) => (h.report ? [`${h.slug} ${h.report.bundleVersion}`] : []))
  if (new Set(view.hosts.flatMap((h) => (h.report ? [h.report.bundleVersion] : []))).size > 1) {
    problems.push({ severity: 'warning', code: 'bundle-versions-differ', detail: `Hosts run different VPhone bundles: ${versions.join(', ')}.` })
  }

  for (const phone of view.contention.transitions) {
    if (now - phone.stateChangedAt <= STUCK_MS) continue
    const report = phone.report ? ` (host says ${phone.report.state}${phone.report.error ? `: ${phone.report.error}` : ''})` : ''
    problems.push({
      severity: 'warning', code: 'phone-stuck', host: phone.host ?? undefined, phone: phone.phoneId,
      detail: `${phone.phoneId} has been ${phone.state} on ${phone.host} for ${formatDuration(now - phone.stateChangedAt)}${report}.`,
    })
  }

  const usable = view.hosts.filter((h) => h.usable)
  if (!usable.length) {
    problems.push({ severity: 'critical', code: 'no-usable-host', detail: `No host can start a phone in ${view.environment}: every host is offline or draining.` })
  } else if (usable.every((h) => h.free <= 0)) {
    problems.push({
      severity: 'warning', code: 'fleet-full',
      detail: `Every usable host is full (${usable.map((h) => `${h.slug} ${h.placed.length}/${h.slots}`).join(', ')}): a stopped phone starts only after an idle one passes its ${formatDuration(GRACE_MS)} grace.`,
    })
  }
  return problems.sort((a, b) => Number(a.severity === 'warning') - Number(b.severity === 'warning'))
}

// ── text ──

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / SECOND_MS))
  if (seconds < 60) return `${seconds}s`
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)}m`
  if (ms < HOURS_BEFORE_DAYS * HOUR_MS) return `${Math.floor(ms / HOUR_MS)}h`
  return `${Math.floor(ms / DAY_MS)}d`
}

/** `19.1`: GiB with one decimal, no unit. */
export function toGiB(bytes: number): string {
  return (bytes / GIB).toFixed(1)
}

export function formatGiB(bytes: number): string {
  return `${toGiB(bytes)} GiB`
}

export function formatDisk(bytes: number): string {
  return bytes >= TB ? `${(bytes / TB).toFixed(1)} TB` : `${Math.round(bytes / GB)} GB`
}

/** `cph_…X4K2`: enough to tell phones apart on the page. */
export function shortPhoneId(phoneId: string): string {
  return `${phoneId.slice(0, 4)}…${phoneId.slice(-4)}`
}
