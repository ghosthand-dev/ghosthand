import { expect, test } from 'vitest'
import { entitlementFor } from './billing.ts'

const signup = new Date('2026-10-01T10:00:00Z')
const day = 24 * 60 * 60 * 1000

function at(ms: number, subscriptions: Parameters<typeof entitlementFor>[0]['subscriptions'] = []) {
  const e = entitlementFor({ userCreatedAt: signup, subscriptions, now: new Date(signup.getTime() + ms) })
  return `${e.plan} allowed=${e.allowed} | ${e.notice}`
}

test('trial ends exactly 7 days after signup; Pro statuses win over the trial', () => {
  const sub = (status: string, cancelAtPeriodEnd = false) => ({ status, cancelAtPeriodEnd, currentPeriodEnd: new Date('2026-11-08T00:00:00Z') })
  expect([
    at(0),
    at(7 * day - 1),
    at(7 * day),
    at(30 * day, [sub('canceled'), sub('incomplete')]),
    at(30 * day, [sub('canceled'), sub('active')]),
    at(1 * day, [sub('active', true)]),
    at(30 * day, [sub('past_due')]),
  ].join('\n')).toMatchInlineSnapshot(`
    "trial allowed=true | The ghosthand trial ends on Oct 8, 2026. Then $99/month.
    trial allowed=true | The ghosthand trial ends on Oct 8, 2026. Then $99/month.
    expired allowed=false | The 7-day ghosthand trial ended on Oct 8, 2026. Ghosthand Pro is $99/month.
    expired allowed=false | The 7-day ghosthand trial ended on Oct 8, 2026. Ghosthand Pro is $99/month.
    pro allowed=true | null
    pro allowed=true | Your ghosthand plan ends on Nov 8, 2026.
    pro allowed=true | Your last ghosthand payment failed. Update the card before Stripe cancels the plan."
  `)
})
