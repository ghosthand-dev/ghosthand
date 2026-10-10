// Plan rules: pure functions, no I/O. The daemon asks /api/cli/account at every
// lease and does what `entitlementFor` says; it never computes dates itself.
//
//   signup ──── 7 days: trial ────▶ expired (every lease fails) ──▶ subscribe ──▶ pro
//
// The trial end is derived from org.createdAt, never stored, so it cannot drift.
// No Stripe trial: Checkout charges at once, because the trial already happened.

export const TRIAL_DAYS = 7
export const PRO_PRICE_LOOKUP_KEY = 'ghosthand_pro_monthly'
/** Products of other apps share the Stripe account; ours have metadata.app = ghosthand. */
export const STRIPE_PRODUCT_APP = 'ghosthand'

/** Stripe statuses that keep Pro. past_due: Stripe is still retrying the card. */
export const PRO_STATUSES = ['active', 'past_due'] as const
/** Statuses that must go to the billing portal instead of a second Checkout. */
export const EXISTING_STATUSES = ['active', 'past_due', 'trialing', 'incomplete', 'unpaid', 'paused'] as const

export function isProStatus(status: string): boolean {
  return PRO_STATUSES.some((s) => s === status)
}

export function isExistingStatus(status: string): boolean {
  return EXISTING_STATUSES.some((s) => s === status)
}

export type Plan = 'trial' | 'pro' | 'expired'

export type Entitlement = {
  plan: Plan
  /** True when the daemon may grant a lease. */
  allowed: boolean
  trialEndsAt: Date
  /** One line for the user, without links: the daemon adds the subscribe link. */
  notice: string | null
}

export function trialEndsAt(orgCreatedAt: Date): Date {
  return new Date(orgCreatedAt.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000)
}

export function entitlementFor({
  orgCreatedAt,
  subscriptions,
  now,
}: {
  orgCreatedAt: Date
  subscriptions: { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null }[]
  now: Date
}): Entitlement {
  const ends = trialEndsAt(orgCreatedAt)
  const pro = subscriptions.find((s) => isProStatus(s.status))
  if (pro) {
    const notice = pro.status === 'past_due'
      ? 'Your last ghosthand payment failed. Update the card before Stripe cancels the plan.'
      : pro.cancelAtPeriodEnd && pro.currentPeriodEnd
        ? `Your ghosthand plan ends on ${formatDay(pro.currentPeriodEnd)}.`
        : null
    return { plan: 'pro', allowed: true, trialEndsAt: ends, notice }
  }
  if (now < ends) {
    return {
      plan: 'trial',
      allowed: true,
      trialEndsAt: ends,
      notice: `The ghosthand trial ends on ${formatDay(ends)}. Then $99/month.`,
    }
  }
  return {
    plan: 'expired',
    allowed: false,
    trialEndsAt: ends,
    notice: `The 7-day ghosthand trial ended on ${formatDay(ends)}. Ghosthand Pro is $99/month.`,
  }
}

/** "Oct 15, 2026" in UTC, the same on server and client. */
export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
