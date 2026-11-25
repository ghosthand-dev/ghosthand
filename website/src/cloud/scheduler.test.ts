// The fleet rules as tables: placements of a stopped phone, and what each host report means
// for a phone in each state.
import { expect, test } from 'vitest'
import { GRACE_MS, place, reconcile, type HostPhone, type HostSlot, type PlacedPhone, type Placement, type Step } from './scheduler.ts'

const MIN = 60_000
const NOW = 100 * MIN

const online = (slug: string, slots: number): HostSlot => ({ slug, slots, online: true, active: true })
const offline = (slug: string, slots: number): HostSlot => ({ slug, slots, online: false, active: true })
const draining = (slug: string, slots: number): HostSlot => ({ slug, slots, online: true, active: false })
const running = (id: string, host: string, idleMinutes: number | null): PlacedPhone => ({ id, host, state: 'running', idleSince: idleMinutes === null ? null : NOW - idleMinutes * MIN })

function describePlacement(placement: Placement): string {
  switch (placement.kind) {
    case 'start': return `start on ${placement.host}`
    case 'stop': return `stop ${placement.victim} on ${placement.host}`
    case 'wait': return `wait (${placement.reason})`
  }
}

test('a pinned phone starts only on its host; a new phone gets the host with the most free slots', () => {
  const pinned = { host: 'mint' }
  const fresh = { host: null }
  const show = (label: string, input: Parameters<typeof place>[0]) => `${label}: ${describePlacement(place(input))}`
  expect('\n' + [
    show('pinned, its host has a free slot', { phone: pinned, hosts: [online('mint', 1), online('studio', 4)], placed: [], now: NOW }),
    show('pinned, its host is draining', { phone: pinned, hosts: [draining('mint', 1)], placed: [], now: NOW }),
    show('pinned, its host is offline', { phone: pinned, hosts: [offline('mint', 4), online('studio', 4)], placed: [], now: NOW }),
    show('pinned, its host is in another environment', { phone: pinned, hosts: [online('studio', 4)], placed: [], now: NOW }),
    show('pinned, full, idle less than the grace time', { phone: pinned, hosts: [online('mint', 1)], placed: [running('A', 'mint', 9)], now: NOW }),
    show('pinned, full, idle exactly the grace time', { phone: pinned, hosts: [online('mint', 1)], placed: [running('A', 'mint', GRACE_MS / MIN)], now: NOW }),
    show('pinned, full: only its own host makes room', { phone: pinned, hosts: [online('mint', 1), online('studio', 1)], placed: [running('A', 'mint', 11), running('B', 'studio', 60)], now: NOW }),
    show('pinned, full: a leased phone never stops', { phone: pinned, hosts: [online('mint', 1), online('studio', 2)], placed: [running('A', 'mint', null)], now: NOW }),
    show('pinned, full: a stop in flight frees the slot', { phone: pinned, hosts: [online('mint', 2)], placed: [{ id: 'A', host: 'mint', state: 'stopping', idleSince: null }, running('B', 'mint', 60)], now: NOW }),
    show('new: most free slots, then slug', { phone: fresh, hosts: [online('mint', 2), online('studio', 2), online('zeta', 1)], placed: [running('A', 'mint', null)], now: NOW }),
    show('new: drained and offline hosts take nothing', { phone: fresh, hosts: [offline('mint', 4), draining('neo', 4), online('studio', 1)], placed: [], now: NOW }),
    show('new: every host full, the phone idle longest stops', { phone: fresh, hosts: [online('mint', 1), online('studio', 1)], placed: [running('A', 'mint', 20), running('B', 'studio', 30)], now: NOW }),
    show('new: no usable host', { phone: fresh, hosts: [offline('mint', 4), draining('neo', 4)], placed: [], now: NOW }),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    pinned, its host has a free slot: start on mint
    pinned, its host is draining: start on mint
    pinned, its host is offline: wait (host-offline)
    pinned, its host is in another environment: wait (host-offline)
    pinned, full, idle less than the grace time: wait (full)
    pinned, full, idle exactly the grace time: stop A on mint
    pinned, full: only its own host makes room: stop A on mint
    pinned, full: a leased phone never stops: wait (full)
    pinned, full: a stop in flight frees the slot: wait (freeing)
    new: most free slots, then slug: start on studio
    new: drained and offline hosts take nothing: start on studio
    new: every host full, the phone idle longest stops: stop B on studio
    new: no usable host: wait (full)"
  `)
})

function describeStep(next: Step): string {
  const parts = [
    next.state && `-> ${next.state}`,
    next.ran && 'first run',
    next.endLeases && 'end leases',
    next.lost && 'LOST',
    next.call && `call ${next.call}`,
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'nothing'
}

test('a host report moves a phone through start, stop and crash, and a lost VM is never cloned again', () => {
  const report = (state: HostPhone['state'], error?: string): HostPhone => ({ id: 'A', state, ...(error ? { error } : {}) })
  const show = (label: string, phone: Parameters<typeof reconcile>[0]['phone'], hostPhone: HostPhone | undefined) =>
    `${label}: ${describeStep(reconcile({ phone, report: hostPhone }))}`
  const at = (state: 'stopped' | 'starting' | 'running' | 'stopping', ran = true) => ({ state, ran })
  expect('\n' + [
    show('starting, new phone, host never saw it', at('starting', false), undefined),
    show('starting, host has it stopped', at('starting'), report('stopped')),
    show('starting, host busy', at('starting'), report('starting')),
    show('starting, last start failed', at('starting'), report('stopped', 'vphoned did not answer')),
    show('starting, first boot up', at('starting', false), report('running')),
    show('starting, VM up', at('starting'), report('running')),
    show('starting, host lost a VM that ran', at('starting'), undefined),
    show('running, VM up', at('running'), report('running')),
    show('running, VM crashed', at('running'), report('stopped')),
    show('running, host lost it', at('running'), undefined),
    show('stopping, in flight', at('stopping'), report('stopping')),
    show('stopping, still running (call lost)', at('stopping'), report('running')),
    show('stopping, done', at('stopping'), report('stopped')),
    show('stopped, on its host', at('stopped'), report('stopped')),
    show('stopped, never ran, host never saw it', at('stopped', false), undefined),
    show('stopped, host lost it', at('stopped'), undefined),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    starting, new phone, host never saw it: call start
    starting, host has it stopped: call start
    starting, host busy: nothing
    starting, last start failed: call start
    starting, first boot up: -> running, first run
    starting, VM up: -> running
    starting, host lost a VM that ran: -> stopped, end leases, LOST
    running, VM up: nothing
    running, VM crashed: -> stopped, end leases
    running, host lost it: -> stopped, end leases, LOST
    stopping, in flight: nothing
    stopping, still running (call lost): call stop
    stopping, done: -> stopped
    stopped, on its host: nothing
    stopped, never ran, host never saw it: nothing
    stopped, host lost it: LOST"
  `)
})
