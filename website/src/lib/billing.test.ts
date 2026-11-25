import { expect, test } from 'vitest'
import { cloudPhoneStatus, entitlementFor, linksCloudPhone, leaseDecision, taskDecision, taskMonthStart, type BoundDevice, type SubscriptionKind } from './billing.ts'

const now = new Date('2026-10-27T10:00:00Z')
const periodEnd = new Date('2026-11-08T00:00:00Z')
const sub = (status: string, { paidMacs = 1, cancelAtPeriodEnd = false, kind = 'pro' as SubscriptionKind } = {}) => ({ kind, status, cancelAtPeriodEnd, currentPeriodEnd: periodEnd, paidMacs })

test('entitlement: free without a live subscription, Pro counts paid Macs', () => {
  const show = (subscriptions: ReturnType<typeof sub>[]) => {
    const e = entitlementFor({ subscriptions, now })
    return `${e.plan} macs=${e.paidMacs} source=${e.sourceAccess} until=${e.validUntil.toISOString().slice(0, 10)} | ${e.notice}`
  }
  expect([
    show([]),
    show([sub('canceled'), sub('incomplete')]),
    show([sub('active', { paidMacs: 3 })]),
    show([sub('active', { cancelAtPeriodEnd: true })]),
    show([sub('past_due')]),
  ].join('\n')).toMatchInlineSnapshot(`
    "free macs=0 source=false until=2026-11-03 | null
    free macs=0 source=false until=2026-11-03 | null
    pro macs=3 source=true until=2026-11-11 | null
    pro macs=1 source=true until=2026-11-11 | Your ghosthand plan ends on Nov 8, 2026.
    pro macs=1 source=true until=2026-11-11 | Your last ghosthand payment failed. Update the card before Stripe cancels the plan."
  `)
})

test('cloud phone subscriptions never make an org Pro; an allowed one lifts the task limit', () => {
  const cloud = (status: string) => sub(status, { kind: 'cloud_phone', paidMacs: 1 })
  const show = (label: string, subscriptions: ReturnType<typeof sub>[]) => {
    const e = entitlementFor({ subscriptions, now })
    const task = taskDecision({ entitlement: e, used: 10, now, subscribeUrl: 'https://ghosthand.dev/subscribe' })
    return `${label}: ${e.plan} macs=${e.paidMacs} cloud=${e.cloudPhones} source=${e.sourceAccess} tasks=${task.allowed ? 'unlimited' : 'limit'}`
  }
  expect('\n' + [
    show('one active cloud phone', [cloud('active')]),
    show('two cloud phones, one past_due', [cloud('active'), cloud('past_due')]),
    show('canceled cloud phone', [cloud('canceled')]),
    show('cloud phone and Pro for 2 Macs', [cloud('active'), sub('active', { paidMacs: 2 })]),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    one active cloud phone: free macs=0 cloud=1 source=false tasks=unlimited
    two cloud phones, one past_due: free macs=0 cloud=2 source=false tasks=unlimited
    canceled cloud phone: free macs=0 cloud=0 source=false tasks=limit
    cloud phone and Pro for 2 Macs: pro macs=2 cloud=1 source=true tasks=unlimited"
  `)
})

test('cloud phone row: its linked subscription stays, a renewal takes over a canceled phone', () => {
  const show = (label: string, phone: Parameters<typeof linksCloudPhone>[0]['phone'], subscriptionId: string, status: string) => {
    const links = linksCloudPhone({ phone, subscription: { subscriptionId, status } })
    return `${label}: ${links ? `links ${subscriptionId} (${cloudPhoneStatus(status)})` : 'unchanged'}`
  }
  const linked = (subscriptionId: string | null, subscriptionStatus: string | null) => ({ subscriptionId, subscriptionStatus })
  expect('\n' + [
    show('checkout done, row missing (cron deleted it)', null, 'sub_1', 'active'),
    show('unpaid row, first event incomplete', linked(null, null), 'sub_1', 'incomplete'),
    show('unpaid row, active', linked(null, null), 'sub_1', 'active'),
    show('own sub cancels', linked('sub_1', 'active'), 'sub_1', 'canceled'),
    show('own sub unpaid', linked('sub_1', 'past_due'), 'sub_1', 'unpaid'),
    show('renewal active on canceled phone', linked('sub_1', 'canceled'), 'sub_2', 'active'),
    show('renewal still incomplete', linked('sub_1', 'canceled'), 'sub_2', 'incomplete'),
    show('late event of old sub after renewal', linked('sub_2', 'active'), 'sub_1', 'canceled'),
    show('second active sub on an active phone', linked('sub_1', 'active'), 'sub_2', 'active'),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    checkout done, row missing (cron deleted it): links sub_1 (active)
    unpaid row, first event incomplete: links sub_1 (pending)
    unpaid row, active: links sub_1 (active)
    own sub cancels: links sub_1 (canceled)
    own sub unpaid: links sub_1 (canceled)
    renewal active on canceled phone: links sub_2 (active)
    renewal still incomplete: unchanged
    late event of old sub after renewal: unchanged
    second active sub on an active phone: unchanged"
  `)
})

test('task decision: 10 prompts per UTC month on Free, unlimited on Pro', () => {
  const free = entitlementFor({ subscriptions: [], now })
  const pro = entitlementFor({ subscriptions: [sub('active')], now })
  const december = new Date('2026-12-31T23:59:00Z')
  const show = (label: string, entitlement: typeof free, used: number, at = now) => {
    const d = taskDecision({ entitlement, used, now: at, subscribeUrl: 'https://ghosthand.dev/subscribe' })
    return `${label}: ${d.allowed ? 'allowed' : `refused | ${d.message}`}`
  }
  expect('\n' + [
    `month start: ${taskMonthStart(now).toISOString()}`,
    show('free, 9 used', free, 9),
    show('free, 10 used', free, 10),
    show('free, 10 used on Dec 31', free, 10, december),
    show('pro, 500 used', pro, 500),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    month start: 2026-10-01T00:00:00.000Z
    free, 9 used: allowed
    free, 10 used: refused | The free plan includes 10 phone tasks per month, and this month's are used up (they reset on Nov 1, 2026). Subscribe to Pro ($99/month per Mac) for unlimited tasks: https://ghosthand.dev/subscribe
    free, 10 used on Dec 31: refused | The free plan includes 10 phone tasks per month, and this month's are used up (they reset on Jan 1, 2027). Subscribe to Pro ($99/month per Mac) for unlimited tasks: https://ghosthand.dev/subscribe
    pro, 500 used: allowed"
  `)
})

test('lease decision: one free iPhone anywhere, any iPhone on a paid Mac', () => {
  const free = entitlementFor({ subscriptions: [], now })
  const pro1 = entitlementFor({ subscriptions: [sub('active')], now })
  const phone = (hash: string, slot = 0): BoundDevice => ({ kind: 'phone', deviceHash: hash, name: `iPhone ${hash}`, slot })
  const mac = (hash: string, slot: number): BoundDevice => ({ kind: 'mac', deviceHash: hash, name: `mac-${hash}`, slot })
  const show = (label: string, entitlement: typeof free, devices: BoundDevice[], p: string, m: string) => {
    const d = leaseDecision({ entitlement, devices, phone: { hash: p, name: `iPhone ${p}` }, mac: { hash: m, name: `mac-${m}` } })
    return `${label}: ${d.allowed ? `allowed bind=${d.bind ? `${d.bind.kind}@${d.bind.slot}` : '-'}` : `refused ${d.limit} | ${d.message}`}`
  }
  expect('\n' + [
    show('free, first iPhone', free, [], 'a', 'm1'),
    show('free, same iPhone on another Mac', free, [phone('a')], 'a', 'm2'),
    show('free, second iPhone', free, [phone('a')], 'b', 'm1'),
    show('pro, free iPhone on a new Mac takes no slot', pro1, [phone('a')], 'a', 'laptop'),
    show('pro, first Mac', pro1, [phone('a')], 'b', 'm1'),
    show('pro, paid Mac, 5th iPhone', pro1, [phone('a'), mac('m1', 0)], 'e', 'm1'),
    show('pro, unpaid Mac, free iPhone', pro1, [phone('a'), mac('m1', 0)], 'a', 'm2'),
    show('pro, unpaid Mac, other iPhone', pro1, [phone('a'), mac('m1', 0)], 'b', 'm2'),
    show('pro lowered to 1, Mac in slot 1', pro1, [phone('a'), mac('m1', 0), mac('m2', 1)], 'b', 'm2'),
    show('pro, slot 0 removed, new Mac fills it', pro1, [phone('a'), mac('m2', 1)], 'b', 'm3'),
    show('pro, slot 0 removed, Mac in slot 1 moves down', pro1, [phone('a'), mac('m2', 1)], 'b', 'm2'),
  ].join('\n')).toMatchInlineSnapshot(`
    "
    free, first iPhone: allowed bind=phone@0
    free, same iPhone on another Mac: allowed bind=-
    free, second iPhone: refused phone | The free plan covers one iPhone: iPhone a. Remove it on the dashboard to switch, or subscribe to Pro ($99/month per Mac) for unlimited iPhones.
    pro, free iPhone on a new Mac takes no slot: allowed bind=-
    pro, first Mac: allowed bind=mac@0
    pro, paid Mac, 5th iPhone: allowed bind=-
    pro, unpaid Mac, free iPhone: allowed bind=-
    pro, unpaid Mac, other iPhone: refused mac | mac-m2 is not a paid Mac: the plan pays for 1 Mac (mac-m1). Here only the free iPhone (iPhone a) can be leased. Add a Mac in billing, or remove one on the dashboard.
    pro lowered to 1, Mac in slot 1: refused mac | mac-m2 is not a paid Mac: the plan pays for 1 Mac (mac-m1). Here only the free iPhone (iPhone a) can be leased. Add a Mac in billing, or remove one on the dashboard.
    pro, slot 0 removed, new Mac fills it: allowed bind=mac@0
    pro, slot 0 removed, Mac in slot 1 moves down: allowed bind=mac@0"
  `)
})
