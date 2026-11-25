// The admin fleet view from rows and host answers, and the problems it reports.
import { expect, test } from 'vitest'
import { buildFleetView, fleetProblems, type FleetLeaseRow, type FleetPhoneRow, type FleetRows, type HostProbe } from './admin-view.ts'
import type { HostStatus } from './host.ts'
import type { HostPhone } from './scheduler.ts'

const MIN = 60_000
const NOW = 1_000 * MIN
const GIB = 1024 ** 3

const phone = (id: string, fields: Partial<FleetPhoneRow>): FleetPhoneRow => ({
  phoneId: id, name: `Phone ${id}`, orgId: `org_${id}`, state: 'stored', hostSlug: null, version: 1, savedVersion: 1,
  stateChangedAt: NOW - 60 * MIN, subscriptionStatus: 'active', idleSince: null, ...fields,
})

const lease = (n: number, phoneId: string, fields: Partial<FleetLeaseRow>): FleetLeaseRow => ({
  n, phoneId, label: null, reason: `task ${n}`, idleTimeoutS: 600, lastCommand: 'tap', createdAt: NOW - 30 * MIN, lastUsedAt: NOW - MIN, endedAt: null, ...fields,
})

const answer = (slug: string, fields: Partial<HostStatus>, phones: HostPhone[]): HostProbe => ({
  slug, ms: 50, error: null,
  status: {
    host: slug, slots: 2, freeDiskBytes: 600e9, bundleVersion: '2.18.0', templates: ['13e3716a2e12'], phones,
    machine: { memoryBytes: 24 * GIB, usedBytes: 19 * GIB, compressedBytes: GIB, swapUsedBytes: 0, pressure: 'normal', load1: 3.1, cores: 10, uptimeS: 86_400 },
    ...fields,
  },
})

const rows: FleetRows = {
  environment: 'production',
  hosts: [
    { slug: 'mini-3', address: '10.77.0.3:7400', slots: 6, status: 'active', lastSeenAt: NOW - 14 * MIN },
    { slug: 'mint', address: '10.77.0.1:7400', slots: 2, status: 'active', lastSeenAt: NOW - MIN },
    { slug: 'studio', address: '10.77.0.2:7400', slots: 1, status: 'active', lastSeenAt: NOW - MIN },
  ],
  phones: [
    phone('A', { state: 'running', hostSlug: 'mint' }),
    phone('B', { state: 'starting', hostSlug: 'mint', stateChangedAt: NOW - 20 * MIN }),
    phone('C', { state: 'running', hostSlug: 'studio', idleSince: NOW - 15 * MIN }),
    phone('D', { hostSlug: 'mini-3', version: 3, savedVersion: 2 }),
    phone('E', { hostSlug: 'mint', version: 2, savedVersion: 1, stateChangedAt: NOW - 40 * MIN }),
    phone('F', { subscriptionStatus: 'canceled' }),
  ],
  liveLeases: [lease(7, 'A', {})],
  recentLeases: [
    lease(7, 'A', {}),
    lease(6, 'C', { createdAt: NOW - 40 * MIN, lastUsedAt: NOW - 25 * MIN }),
    lease(5, 'A', { createdAt: NOW - 50 * MIN, endedAt: NOW - 31 * MIN }),
    // Expired, then ended late by a recover: the expiry is its end.
    lease(4, 'E', { createdAt: NOW - 120 * MIN, lastUsedAt: NOW - 100 * MIN, endedAt: NOW - 45 * MIN }),
  ],
  orgs: ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => ({ orgId: `org_${id}`, emails: [`${id.toLowerCase()}@example.com`] })),
}

const probes: HostProbe[] = [
  { slug: 'mini-3', ms: 3_000, status: null, error: 'ProxyError: destination_unavailable' },
  answer('mint', {
    freeDiskBytes: 12e9,
    machine: { memoryBytes: 24 * GIB, usedBytes: 23 * GIB, compressedBytes: 4 * GIB, swapUsedBytes: 2.4 * GIB, pressure: 'warning', load1: 9.8, cores: 10, uptimeS: 172_800 },
  }, [
    { id: 'A', state: 'running', version: 1, footprintBytes: 2.2 * GIB },
    { id: 'B', state: 'restoring', version: null },
    { id: 'E', state: 'stopped', version: 2 },
  ]),
  answer('studio', { bundleVersion: '2.17.1', slots: 1 }, [{ id: 'C', state: 'running', version: 1, footprintBytes: 2.1 * GIB }]),
]

test('every problem of a fleet in trouble, critical first', () => {
  const view = buildFleetView({ rows, probes, now: NOW })
  expect('\n' + fleetProblems(view, NOW).map((p) => `${p.severity} ${p.code}${p.host ? ` [${p.host}]` : ''}: ${p.detail}`).join('\n')).toMatchInlineSnapshot(`
    "
    critical host-offline [mini-3]: mini-3 did not answer now (ProxyError: destination_unavailable) and was last seen by the cron 14m ago. It holds the newest copy of 1 phone. Wait for the host, or run cloud-host.ts recover <phone>.
    critical host-low-disk [mint]: mint has 12 GB of free disk.
    warning host-memory-pressure [mint]: mint is at memory pressure warning with 2.4 GiB swap. Add the per-VM overhead constant (plans/decisions/cloud-vm-memory.md).
    warning save-backlog [mint]: mint holds 1 stopped phone not saved to R2, the oldest for 40m.
    warning bundle-versions-differ: Hosts run different VPhone bundles: mint 2.18.0, studio 2.17.1.
    warning phone-stuck [mint]: B has been starting on mint for 20m (host says restoring).
    warning fleet-full: Every usable host is full (mint 2/2, studio 1/1): a stored phone starts only after an idle one passes its 10m grace."
  `)
})

test('a healthy fleet has no problems; one with no usable host has one', () => {
  const healthy: FleetRows = { ...rows, hosts: [{ slug: 'mint', address: '10.77.0.1:7400', slots: 2, status: 'active', lastSeenAt: NOW - MIN }], phones: [phone('A', { state: 'running', hostSlug: 'mint' })] }
  const answered = [answer('mint', {}, [{ id: 'A', state: 'running', version: 1 }])]
  expect(fleetProblems(buildFleetView({ rows: healthy, probes: answered, now: NOW }), NOW)).toEqual([])
  const drained: FleetRows = { ...healthy, hosts: [{ ...healthy.hosts[0]!, status: 'draining' }] }
  expect(fleetProblems(buildFleetView({ rows: drained, probes: answered, now: NOW }), NOW)).toMatchInlineSnapshot(`
    [
      {
        "code": "no-usable-host",
        "detail": "No host can start a phone in production: every host is offline or draining.",
        "severity": "critical",
      },
    ]
  `)
})

test('slot cells, contention, lease events and customers', () => {
  const view = buildFleetView({ rows, probes, now: NOW })
  const ids = (phones: { phoneId: string }[]) => phones.map((p) => p.phoneId).join(' ')
  expect({
    totals: view.totals,
    hosts: view.hosts.map((h) => `${h.slug}: placed ${ids(h.placed)}, cached ${ids(h.cached)}, free ${h.free}, footprint ${h.footprintBytes === null ? '–' : (h.footprintBytes / GIB).toFixed(1)}`),
    contention: { full: view.contention.full, transitions: ids(view.contention.transitions), idle: view.contention.idle.map((p) => `${p.phoneId} stoppable at -${(NOW - p.evictableAt!) / MIN}m`) },
    leases: view.leases.map((e) => `-${(NOW - e.at) / MIN}m ${e.kind} cloud:${e.n}${e.heldMs === null ? '' : ` after ${e.heldMs / MIN}m`}`),
    customers: view.customers.map((c) => `${c.emails[0]} ${c.phones}/${c.running}/${c.leased} color ${c.color}`),
  }).toMatchInlineSnapshot(`
    {
      "contention": {
        "full": [
          "mint",
          "studio",
        ],
        "idle": [
          "C stoppable at -5m",
        ],
        "transitions": "B",
      },
      "customers": [
        "a@example.com 1/1/1 color 1",
        "b@example.com 1/0/0 color 0",
        "c@example.com 1/1/0 color 3",
        "d@example.com 1/0/0 color 2",
        "e@example.com 1/0/0 color 5",
        "f@example.com 1/0/0 color 4",
      ],
      "hosts": [
        "mini-3: placed , cached D, free 6, footprint –",
        "mint: placed A B, cached E, free 0, footprint –",
        "studio: placed C, cached , free 0, footprint 2.1",
      ],
      "leases": [
        "-15m expired cloud:6 after 25m",
        "-30m acquired cloud:7",
        "-31m ended cloud:5 after 19m",
        "-40m acquired cloud:6",
        "-50m acquired cloud:5",
        "-90m expired cloud:4 after 30m",
        "-120m acquired cloud:4",
      ],
      "totals": {
        "hosts": 3,
        "leased": 1,
        "online": 2,
        "slots": 9,
        "sold": 5,
        "transitions": 1,
        "used": 3,
      },
    }
  `)
})
