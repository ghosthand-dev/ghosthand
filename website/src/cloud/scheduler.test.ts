// Event log replays: each test is a log of fleet events and the actions each one caused.
import { expect, test } from 'vitest'
import { GRACE_MS, POLL_WAITING_MS, nextWake, replay, type FleetAction, type FleetEvent, type HostPhone } from './scheduler.ts'

const MIN = 60_000
const T = 'tpl'

const host = (slug: string, slots: number, at = 0): FleetEvent => ({ type: 'host-set', at, slug, address: `10.77.0.${slug.length}:7400`, slots, enabled: true })
const online = (slug: string, at: number, phones: HostPhone[] = []): FleetEvent => ({ type: 'host-status', at, slug, online: true, phones })
const phone = (id: string, at = 0, orgId = 'org'): FleetEvent => ({ type: 'access', at, phoneId: id, orgId, template: T, allowed: true })
const acquire = (waiterId: number, phoneId: string, at: number, more: Partial<Extract<FleetEvent, { type: 'acquire' }>> = {}): FleetEvent => ({
  type: 'acquire', at, waiterId, phoneId, orgId: 'org', reason: `job ${waiterId}`, idleTimeoutS: 600, ...more,
})
const running = (id: string, version = 0): HostPhone => ({ id, state: 'running', version, uploadedVersion: version })
const stopped = (id: string, version: number): HostPhone => ({ id, state: 'stopped', version, uploadedVersion: version })

/** One line per event that caused actions: `<minute> <event> -> <actions>`. */
function log(events: FleetEvent[]): string {
  const { actions } = replay(events)
  const lines = events.flatMap((event, i) => {
    const done = actions[i]!
    if (!done.length) return []
    const what = event.type === 'acquire' ? `acquire#${event.waiterId} ${event.phoneId}` : 'phoneId' in event ? `${event.type} ${event.phoneId}` : 'slug' in event ? `${event.type} ${event.slug}` : event.type
    return [`${String(event.at / MIN).padStart(4)}m ${what} -> ${done.map(describe).join(', ')}`]
  })
  return `\n${lines.join('\n')}\n`
}

function describe(action: FleetAction): string {
  switch (action.type) {
    case 'start': return `start ${action.phoneId}@${action.host} v${action.version}`
    case 'stop': return `stop ${action.phoneId}@${action.host} upload v${action.uploadVersion}`
    case 'grant': return `grant#${action.waiterId} lease ${action.n}${action.replaced ? ` (replaced ${action.replaced.n})` : ''}`
    case 'reject': return `reject#${action.waiterId} ${action.code}`
  }
}

test('an idle phone is stopped for a waiting one only after the grace time', () => {
  const t = 5 * MIN
  expect(log([
    host('mint', 1), online('mint', 0), phone('A'), phone('B'),
    acquire(1, 'A', MIN),
    online('mint', 2 * MIN, [running('A')]),
    { type: 'release', at: t, orgId: 'org', n: 1 },
    acquire(2, 'B', t + MIN, { waitS: 3600 }),
    { type: 'tick', at: t + GRACE_MS - 1 },
    { type: 'tick', at: t + GRACE_MS },
    online('mint', t + GRACE_MS + MIN, [stopped('A', 1)]),
    online('mint', t + GRACE_MS + 2 * MIN, [stopped('A', 1), running('B')]),
  ])).toMatchInlineSnapshot(`
    "
       1m acquire#1 A -> start A@mint v0
       2m host-status mint -> grant#1 lease 1
      15m tick -> stop A@mint upload v1
      16m host-status mint -> start B@mint v0
      17m host-status mint -> grant#2 lease 2
    "
  `)
})

test('waiters are served in FIFO order and one stop frees one slot', () => {
  const idle = GRACE_MS + MIN
  const { state } = replay([
    host('mint', 1), online('mint', 0), phone('A'), phone('B'), phone('C'),
    acquire(1, 'A', 0), online('mint', 0, [running('A')]), { type: 'release', at: 0, orgId: 'org', n: 1 },
    acquire(2, 'B', idle, { waitS: 3600 }),
    acquire(3, 'C', idle, { waitS: 3600 }),
  ])
  expect(Object.keys(state.waiters)).toEqual(['2', '3'])
  expect(log([
    host('mint', 1), online('mint', 0), phone('A'), phone('B'), phone('C'),
    acquire(1, 'A', 0), online('mint', 0, [running('A')]), { type: 'release', at: 0, orgId: 'org', n: 1 },
    acquire(2, 'B', idle, { waitS: 3600 }),
    acquire(3, 'C', idle, { waitS: 3600 }),
    { type: 'tick', at: idle + MIN },
    online('mint', idle + 2 * MIN, [stopped('A', 1)]),
    online('mint', idle + 3 * MIN, [stopped('A', 1), running('B')]),
    { type: 'release', at: idle + 4 * MIN, orgId: 'org', n: 2 },
    { type: 'tick', at: idle + 4 * MIN + GRACE_MS },
    online('mint', idle + 5 * MIN + GRACE_MS, [stopped('A', 1), stopped('B', 1)]),
  ])).toMatchInlineSnapshot(`
    "
       0m acquire#1 A -> start A@mint v0
       0m host-status mint -> grant#1 lease 1
      11m acquire#2 B -> stop A@mint upload v1
      13m host-status mint -> start B@mint v0
      14m host-status mint -> grant#2 lease 2
      25m tick -> stop B@mint upload v1
      26m host-status mint -> start C@mint v0
    "
  `)
})

test('a phone runs once: a second acquire waits for the lease or fails at once, force takes it', () => {
  expect(log([
    host('mint', 2), online('mint', 0), phone('A'),
    acquire(1, 'A', 0), online('mint', MIN, [running('A')]),
    acquire(2, 'A', 2 * MIN),
    acquire(3, 'A', 3 * MIN, { waitS: 600 }),
    { type: 'release', at: 4 * MIN, orgId: 'org', n: 1 },
    acquire(4, 'A', 5 * MIN, { force: true }),
    { type: 'release', at: 6 * MIN, orgId: 'other-org', n: 3 },
    acquire(5, 'A', 7 * MIN, { waitS: 60 }),
    { type: 'tick', at: 8 * MIN },
  ])).toMatchInlineSnapshot(`
    "
       0m acquire#1 A -> start A@mint v0
       1m host-status mint -> grant#1 lease 1
       2m acquire#2 A -> reject#2 device-leased
       4m release -> grant#3 lease 2
       5m acquire#4 A -> grant#4 lease 3 (replaced 2)
       8m tick -> reject#5 device-leased
    "
  `)
})

test('a phone whose newest copy is on an offline host waits for it, even with another host free', () => {
  expect(log([
    host('mint', 1), host('studio', 2), online('mint', 0), online('studio', 0), phone('A'),
    acquire(1, 'A', 0), online('studio', 0, [running('A')]),
    // The VM died without our stop: only studio has its last changes.
    online('studio', MIN, []),
    { type: 'host-status', at: 2 * MIN, slug: 'studio', online: false },
    acquire(2, 'A', 3 * MIN, { waitS: 3600 }),
    online('mint', 4 * MIN),
    online('studio', 5 * MIN, [stopped('A', 0)]),
    online('studio', 6 * MIN, [running('A')]),
    // The operator moves a phone off a dead host: it restarts from its R2 copy anywhere.
    { type: 'host-status', at: 7 * MIN, slug: 'studio', online: false },
    { type: 'recover', at: 8 * MIN, phoneId: 'A' },
    acquire(3, 'A', 9 * MIN),
  ])).toMatchInlineSnapshot(`
    "
       0m acquire#1 A -> start A@studio v0
       0m host-status studio -> grant#1 lease 1
       5m host-status studio -> start A@studio v0
       6m host-status studio -> grant#2 lease 2
       9m acquire#3 A -> start A@mint v0
    "
  `)
})

test('removed access ends the lease and rejects waiters; renewing gives the same phone back', () => {
  const { state, actions } = replay([
    host('mint', 1), online('mint', 0), phone('A'),
    acquire(1, 'A', 0), online('mint', 0, [running('A')]),
    acquire(2, 'A', MIN, { waitS: 600 }),
    { type: 'access', at: 2 * MIN, phoneId: 'A', orgId: 'org', template: T, allowed: false },
    acquire(3, 'A', 3 * MIN),
    { type: 'access', at: 4 * MIN, phoneId: 'A', orgId: 'org', template: T, allowed: true },
    acquire(4, 'A', 5 * MIN),
  ])
  expect(actions.flat().map(describe)).toMatchInlineSnapshot(`
    [
      "start A@mint v0",
      "grant#1 lease 1",
      "reject#2 subscription-required",
      "reject#3 subscription-required",
      "grant#4 lease 2",
    ]
  `)
  expect(state.phones.A).toMatchObject({ state: 'running', host: 'mint' })
})

test('a drained host starts nothing; an uploaded phone cached there starts elsewhere from R2', () => {
  const t = GRACE_MS + MIN
  expect(log([
    host('mint', 1), online('mint', 0), phone('A'), phone('B'),
    acquire(1, 'A', 0), online('mint', 0, [running('A')]), { type: 'release', at: 0, orgId: 'org', n: 1 },
    // B takes A's slot: A is uploaded as v1 and stays in mint's cache.
    acquire(2, 'B', t, { waitS: 3600 }),
    online('mint', t + MIN, [stopped('A', 1)]),
    online('mint', t + 2 * MIN, [stopped('A', 1), running('B')]),
    { type: 'release', at: t + 3 * MIN, orgId: 'org', n: 2 },
    host('studio', 1, t + 4 * MIN), online('studio', t + 4 * MIN),
    { type: 'host-set', at: t + 5 * MIN, slug: 'mint', address: '10.77.0.4:7400', slots: 2, enabled: false },
    acquire(3, 'A', t + 6 * MIN),
  ])).toMatchInlineSnapshot(`
    "
       0m acquire#1 A -> start A@mint v0
       0m host-status mint -> grant#1 lease 1
      11m acquire#2 B -> stop A@mint upload v1
      12m host-status mint -> start B@mint v0
      13m host-status mint -> grant#2 lease 2
      17m acquire#3 A -> start A@studio v1
    "
  `)
})

test('a failed host call frees nothing: only the host status does', () => {
  // The start may have reached host a: P stays placed there while a is silent.
  expect(log([
    host('a', 1), host('b', 1), online('a', 0), online('b', 0), phone('P'),
    acquire(1, 'P', 0),
    { type: 'call-failed', at: MIN, phoneId: 'P', error: 'connection lost' },
    { type: 'host-status', at: MIN, slug: 'a', online: false },
    acquire(2, 'P', 2 * MIN, { waitS: 3600 }),
    // a answers: it never got the start, so P starts again.
    online('a', 3 * MIN, []),
  ])).toMatchInlineSnapshot(`
    "
       0m acquire#1 P -> start P@a v0
       1m call-failed P -> reject#1 internal-error
       3m host-status a -> start P@a v0
    "
  `)
  // The stop may not have happened: P keeps its slot until the host reports, then is stopped again.
  const t = GRACE_MS + MIN
  expect(log([
    host('a', 1), online('a', 0), phone('P'), phone('Q'),
    acquire(1, 'P', 0), online('a', 0, [running('P')]), { type: 'release', at: 0, orgId: 'org', n: 1 },
    acquire(2, 'Q', t, { waitS: 3600 }),
    { type: 'call-failed', at: t, phoneId: 'P', error: 'HTTP 500' },
    { type: 'tick', at: t + MIN },
    online('a', t + 2 * MIN, [running('P')]),
    online('a', t + 3 * MIN, [stopped('P', 1)]),
  ])).toMatchInlineSnapshot(`
    "
       0m acquire#1 P -> start P@a v0
       0m host-status a -> grant#1 lease 1
      11m acquire#2 Q -> stop P@a upload v1
      13m host-status a -> stop P@a upload v1
      14m host-status a -> start Q@a v0
    "
  `)
})

test('a running phone on a silent host is leased only after the host reports it', () => {
  expect(log([
    host('mint', 1), online('mint', 0), phone('P'),
    acquire(1, 'P', 0), online('mint', 0, [running('P')]), { type: 'release', at: MIN, orgId: 'org', n: 1 },
    { type: 'host-status', at: 2 * MIN, slug: 'mint', online: false },
    acquire(2, 'P', 3 * MIN, { waitS: 3600 }),
    online('mint', 4 * MIN, [running('P')]),
  ])).toMatchInlineSnapshot(`
    "
       0m acquire#1 P -> start P@mint v0
       0m host-status mint -> grant#1 lease 1
       4m host-status mint -> grant#2 lease 2
    "
  `)
})

test('a passed grace deadline does not wake the fleet at once', () => {
  const { state } = replay([
    host('mint', 1), online('mint', 0), phone('P'), phone('Q'),
    acquire(1, 'P', 0), online('mint', 0, [running('P')]), { type: 'release', at: 0, orgId: 'org', n: 1 },
    { type: 'host-set', at: MIN, slug: 'mint', address: 'x', slots: 1, enabled: false },
    acquire(2, 'Q', GRACE_MS + MIN, { waitS: 3600 }),
  ])
  expect(nextWake(state, GRACE_MS + 2 * MIN)! - (GRACE_MS + 2 * MIN)).toBe(POLL_WAITING_MS)
})
