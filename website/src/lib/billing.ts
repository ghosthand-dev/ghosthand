// Plan rules: pure functions, no I/O. Plans limit devices, never time.
//
//   free ── one iPhone (any Mac) ──▶ subscribe ──▶ pro: $99/month per Mac, unlimited
//                                                       iPhones on each paid Mac, plus
//                                                       read access to the daemon source
//
// The daemon asks /api/cli/lease-check at every acquire and does what `leaseDecision`
// says, so a running lease is never stopped. Devices bind on their first lease; the
// dashboard removes them to switch.

export const PRO_PRICE_LOOKUP_KEY = 'ghosthand_pro_monthly'
/** Products of other apps share the Stripe account; ours have metadata.app = ghosthand. */
export const STRIPE_PRODUCT_APP = 'ghosthand'
/** USD per paid Mac per month (the Stripe price; only for page text). */
export const PRO_PRICE_PER_MAC = 99
/** Highest Mac quantity Checkout offers; more through support. */
export const MAX_PAID_MACS = 50

/** Stripe statuses that keep Pro. past_due: Stripe is still retrying the card. */
export const PRO_STATUSES = ['active', 'past_due'] as const
/** Statuses that must go to the billing portal instead of a second Checkout. */
export const EXISTING_STATUSES = ['active', 'past_due', 'trialing', 'incomplete', 'unpaid', 'paused'] as const

const DAY_MS = 24 * 60 * 60 * 1000
/** How long the daemon may allow a known iPhone offline after the last answer. */
const FREE_OFFLINE_DAYS = 7
/** Pro offline grace after the paid period ends, so a late renewal webhook stops nobody. */
const PRO_GRACE_DAYS = 3

export function isProStatus(status: string): boolean {
  return PRO_STATUSES.some((s) => s === status)
}

export function isExistingStatus(status: string): boolean {
  return EXISTING_STATUSES.some((s) => s === status)
}

export type Plan = 'free' | 'pro'

export type Entitlement = {
  plan: Plan
  /** Subscription quantity: Macs with unlimited iPhones. 0 on free. */
  paidMacs: number
  /** Read access to ghosthand-dev/ghosthand-daemon. */
  sourceAccess: boolean
  /** One line for the user, without links: the daemon adds them. */
  notice: string | null
  /** The daemon caches an allowed iPhone until then when ghosthand.dev is unreachable. */
  validUntil: Date
}

type SubscriptionRow = { status: string; cancelAtPeriodEnd: boolean; currentPeriodEnd: Date | null; paidMacs: number }

export function entitlementFor({ subscriptions, now }: { subscriptions: SubscriptionRow[]; now: Date }): Entitlement {
  const pro = subscriptions.filter((s) => isProStatus(s.status))
  if (!pro.length) {
    return { plan: 'free', paidMacs: 0, sourceAccess: false, notice: null, validUntil: new Date(now.getTime() + FREE_OFFLINE_DAYS * DAY_MS) }
  }
  const first = pro[0]!
  const notice = first.status === 'past_due'
    ? 'Your last ghosthand payment failed. Update the card before Stripe cancels the plan.'
    : first.cancelAtPeriodEnd && first.currentPeriodEnd
      ? `Your ghosthand plan ends on ${formatDay(first.currentPeriodEnd)}.`
      : null
  const periodEnd = first.currentPeriodEnd ?? now
  return {
    plan: 'pro',
    paidMacs: pro.reduce((sum, s) => sum + s.paidMacs, 0),
    sourceAccess: true,
    notice,
    validUntil: new Date(Math.max(periodEnd.getTime(), now.getTime()) + PRO_GRACE_DAYS * DAY_MS),
  }
}

export type DeviceKind = 'phone' | 'mac'
export type BoundDevice = { kind: DeviceKind; deviceHash: string; name: string; slot: number }
export type DeviceRef = { hash: string; name: string }

export type LeaseDecision =
  | { allowed: true; bind: { kind: DeviceKind; slot: number } | null }
  | { allowed: false; limit: 'phone' | 'mac'; message: string }

/**
 * May this iPhone on this Mac be leased? A paid Mac (slot below `paidMacs`) takes any
 * iPhone, and the one free iPhone works on any Mac. Another iPhone on an unpaid Mac binds
 * this Mac to a free paid slot, if one is left. `bind` is the slot to upsert for this device first; it can lose a race
 * (unique slot), then the caller decides again.
 */
export function leaseDecision({ entitlement, devices, phone, mac }: {
  entitlement: Entitlement
  devices: BoundDevice[]
  phone: DeviceRef
  mac: DeviceRef
}): LeaseDecision {
  const macs = devices.filter((d) => d.kind === 'mac')
  const thisMac = macs.find((d) => d.deviceHash === mac.hash)
  if (thisMac && thisMac.slot < entitlement.paidMacs) return { allowed: true, bind: null }
  // The free iPhone first: using it on a laptop must not take a paid Mac slot.
  const freePhone = devices.find((d) => d.kind === 'phone' && d.slot === 0)
  if (!freePhone) return { allowed: true, bind: { kind: 'phone', slot: 0 } }
  if (freePhone.deviceHash === phone.hash) return { allowed: true, bind: null }
  // Also moves a bound Mac left above a lowered quantity into a slot freed since.
  const freeSlot = firstFreeSlot(macs, entitlement.paidMacs)
  if (freeSlot !== null) return { allowed: true, bind: { kind: 'mac', slot: freeSlot } }

  if (entitlement.paidMacs > 0) {
    const paid = macs.filter((d) => d.slot < entitlement.paidMacs).map((d) => d.name)
    return {
      allowed: false,
      limit: 'mac',
      message: `${mac.name} is not a paid Mac: the plan pays for ${plural(entitlement.paidMacs, 'Mac')} (${paid.join(', ')}). `
        + `Here only the free iPhone (${freePhone.name}) can be leased. Add a Mac in billing, or remove one on the dashboard.`,
    }
  }
  return {
    allowed: false,
    limit: 'phone',
    message: `The free plan covers one iPhone: ${freePhone.name}. Remove it on the dashboard to switch, `
      + `or subscribe to Pro ($99/month per Mac) for unlimited iPhones.`,
  }
}

function firstFreeSlot(rows: BoundDevice[], limit: number): number | null {
  for (let slot = 0; slot < limit; slot++) {
    if (!rows.some((r) => r.slot === slot)) return slot
  }
  return null
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

/** "Oct 15, 2026" in UTC, the same on server and client. */
export function formatDay(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
