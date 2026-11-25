// The fleet rules as tables: placements of a stored phone, and what each host report means
// for a phone in each state.
import { expect, test } from 'vitest'
import { GRACE_MS, place, reconcile, type HostPhone, type HostSlot, type PlacedPhone, type Placement, type Step } from './scheduler.ts'

const MIN = 60_000
const NOW = 100 * MIN

const usable = (slug: string, slots: number): HostSlot => ({ slug, slots, usable: true })
const running = (id: string, host: string, idleMinutes: number | null): PlacedPhone => ({ id, host, state: 'running', idleSince: idleMinutes === null ? null : NOW - idleMinutes * MIN })

function describePlacement(placement: Placement): string {
  switch (placement.kind) {
    case 'start': return `start on ${placement.host}`
    case 'stop': return `stop ${placement.victim} on ${placement.host}`
    case 'wait': return `wait (${placement.reason})`
  }
}

test('a stored phone starts on its own host, else anywhere from R2, else after an idle phone stops', () => {
  const saved = { host: null, version: 3, savedVersion: 3 }
  const unsaved = { host: 'mint', version: 4, savedVersion: 3 }
  const show = (label: string, input: Parameters<typeof place>[0]) => `${label}: ${describePlacement(place(input))}`
  expect('\n' + [
    show('own host has a free slot', { phone: { ...saved, host: 'mint' }, hosts: [usable('mint', 1), usable('studio', 4)], placed: [], now: NOW }),
    show('in R2: most free slots, then slug', { phone: saved, hosts: [usable('mint', 2), usable('studio', 2), usable('zeta', 1)], placed: [running('A', 'mint', null)], now: NOW }),
    show('in R2: drained and offline hosts take nothing', { phone: saved, hosts: [{ slug: 'mint', slots: 4, usable: false }, usable('studio', 1)], placed: [], now: NOW }),
    show('only copy on an offline host', { phone: unsaved, hosts: [{ slug: 'mint', slots: 4, usable: false }, usable('studio', 4)], placed: [], now: NOW }),
    show('full, idle less than the grace time', { phone: saved, hosts: [usable('mint', 1)], placed: [running('A', 'mint', 9)], now: NOW }),
    show('full, idle exactly the grace time', { phone: saved, hosts: [usable('mint', 1)], placed: [running('A', 'mint', GRACE_MS / MIN)], now: NOW }),
    show('full: the phone idle longest stops', { phone: saved, hosts: [usable('mint', 1), usable('studio', 1)], placed: [running('A', 'mint', 20), running('B', 'studio', 30)], now: NOW }),
    show('full: a leased phone never stops', { phone: saved, hosts: [usable('mint', 1)], placed: [running('A', 'mint', null)], now: NOW }),
    show('full: a stop in flight frees the slot', { phone: saved, hosts: [usable('mint', 2)], placed: [{ id: 'A', host: 'mint', state: 'stopping', idleSince: null }, running('B', 'mint', 60)], now: NOW }),
    show('unsaved: only its own host makes room', { phone: unsaved, hosts: [usable('mint', 1), usable('studio', 1)], placed: [running('A', 'mint', 11), running('B', 'studio', 60)], now: NOW }),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    own host has a free slot: start on mint
    in R2: most free slots, then slug: start on studio
    in R2: drained and offline hosts take nothing: start on studio
    only copy on an offline host: wait (host-offline)
    full, idle less than the grace time: wait (full)
    full, idle exactly the grace time: stop A on mint
    full: the phone idle longest stops: stop B on studio
    full: a leased phone never stops: wait (full)
    full: a stop in flight frees the slot: wait (freeing)
    unsaved: only its own host makes room: stop A on mint"
  `)
})

function describeStep(next: Step): string {
  const parts = [
    next.state && `-> ${next.state}`,
    next.version !== undefined && `v${next.version}`,
    next.clearHost && 'forget host',
    next.endLeases && 'end leases',
    next.call && `call ${next.call}`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'nothing'
}

test('a host report moves a phone through start, stop, crash and save', () => {
  const report = (state: HostPhone['state'], version: number | null, error?: string): HostPhone => ({ id: 'A', state, version, ...(error ? { error } : {}) })
  const show = (label: string, phone: Parameters<typeof reconcile>[0]['phone'], hostPhone: HostPhone | undefined) =>
    `${label}: ${describeStep(reconcile({ phone, report: hostPhone }))}`
  const at = (state: 'stored' | 'starting' | 'running' | 'stopping', version: number, savedVersion = version) => ({ state, version, savedVersion })
  expect('\n' + [
    show('starting, new phone, host never saw it', at('starting', 0), undefined),
    show('starting, host has this version', at('starting', 2), report('stopped', 2)),
    show('starting, host has an older copy', at('starting', 2), report('stopped', 1)),
    show('starting, host restoring', at('starting', 2), report('restoring', null)),
    show('starting, last start failed', at('starting', 2), report('stopped', 2, 'vphoned did not answer')),
    show('starting, VM up', at('starting', 2), report('running', 2)),
    show('running, VM up', at('running', 2), report('running', 2)),
    show('running, VM crashed', at('running', 2), report('stopped', 2)),
    show('running, host lost it', at('running', 2), undefined),
    show('stopping, hashing', at('stopping', 2), report('stopping', null)),
    show('stopping, still running (call lost)', at('stopping', 2), report('running', 2)),
    show('stopping, cut off', at('stopping', 2), report('damaged', null)),
    show('stopping, hashed', at('stopping', 2), report('stopped', 3)),
    show('stored, not yet in R2', at('stored', 3, 2), report('stopped', 3)),
    show('stored, in R2', at('stored', 3), report('stopped', 3)),
    show('stored, host evicted its saved copy', at('stored', 3), undefined),
    show('stored, host lost its only copy', at('stored', 3, 2), undefined),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    starting, new phone, host never saw it: call start
    starting, host has this version: call start
    starting, host has an older copy: call load
    starting, host restoring: nothing
    starting, last start failed: call start
    starting, VM up: -> running
    running, VM up: nothing
    running, VM crashed: -> stopping, end leases, call stop
    running, host lost it: -> stopping, end leases, call stop
    stopping, hashing: nothing
    stopping, still running (call lost): call stop
    stopping, cut off: call stop
    stopping, hashed: -> stored, v3
    stored, not yet in R2: call save
    stored, in R2: nothing
    stored, host evicted its saved copy: forget host
    stored, host lost its only copy: nothing"
  `)
})
