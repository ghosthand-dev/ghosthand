// Stripe: clients per account, customers, Checkout, portal, and the webhook mirror.
//
// Rows store the Stripe account id (stripe_customer, subscription). Today one account
// is configured (STRIPE_ACCOUNT_ID + STRIPE_SECRET_KEY, shared with Playwriter). To move
// to a new account: add its keys to `stripeAccounts()`, point STRIPE_ACCOUNT_ID at it.
// Old subscriptions keep renewing and opening the portal on their own account.

import { env } from 'cloudflare:workers'
import Stripe from 'stripe'
import * as schema from 'db/schema'
import { getDb, type Org } from '../db.ts'
import { isExistingStatus, MAX_PAID_MACS, PRO_PRICE_LOOKUP_KEY, STRIPE_PRODUCT_APP } from './billing.ts'
import { captureException, trackEvent } from '../telemetry.ts'

/** Secret key per Stripe account id. */
function stripeAccounts(): Record<string, string> {
  return { [env.STRIPE_ACCOUNT_ID]: env.STRIPE_SECRET_KEY }
}

/** The account new customers and checkouts use. */
export function checkoutAccountId(): string {
  return env.STRIPE_ACCOUNT_ID
}

export function stripeFor(accountId: string): Stripe {
  const key = stripeAccounts()[accountId]
  if (!key) throw new Error(`no secret key configured for Stripe account ${accountId}`)
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })
}

/** The only place that creates Stripe customers: one per (org, account). */
export async function getOrCreateStripeCustomer({ org, email, accountId }: { org: Org; email: string; accountId: string }): Promise<string> {
  const db = getDb()
  const existing = await db.query.stripeCustomer.findFirst({ where: { orgId: org.orgId, stripeAccountId: accountId } })
  if (existing) return existing.stripeCustomerId
  const customer = await stripeFor(accountId).customers.create({ email, name: org.name, metadata: { orgId: org.orgId, app: STRIPE_PRODUCT_APP } })
  const inserted = await db.insert(schema.stripeCustomer)
    .values({ stripeCustomerId: customer.id, orgId: org.orgId, stripeAccountId: accountId })
    .onConflictDoNothing({ target: [schema.stripeCustomer.orgId, schema.stripeCustomer.stripeAccountId] })
    .returning()
  if (inserted.length) return customer.id
  // A concurrent request won the insert: use its customer, drop ours.
  await stripeFor(accountId).customers.del(customer.id).catch((cause) => {
    captureException(cause, { tags: { handler: 'getOrCreateStripeCustomer' } })
  })
  const winner = await db.query.stripeCustomer.findFirst({ where: { orgId: org.orgId, stripeAccountId: accountId } })
  if (!winner) throw new Error(`stripe customer for org ${org.orgId} vanished`)
  return winner.stripeCustomerId
}

/**
 * Where /subscribe sends the browser: the billing portal when the org already has a
 * subscription (any account, any live status), otherwise a new Checkout.
 */
export async function subscribeRedirectUrl({ org, email, returnUrl }: { org: Org; email: string; returnUrl: string }): Promise<string> {
  const live = org.subscriptions.find((s) => isExistingStatus(s.status))
  if (live) return portalUrl({ accountId: live.stripeAccountId, customerId: live.stripeCustomerId, returnUrl })

  const accountId = checkoutAccountId()
  const stripe = stripeFor(accountId)
  const customerId = await getOrCreateStripeCustomer({ org, email, accountId })
  // The webhook can lag behind a finished Checkout: ask Stripe too.
  const remote = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
  if (remote.data.some((s) => isExistingStatus(s.status))) {
    return portalUrl({ accountId, customerId, returnUrl })
  }
  // Two /subscribe tabs must not become two subscriptions: reuse the open Checkout.
  const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 })
  const reusable = open.data.find((c) => c.mode === 'subscription' && c.metadata?.app === STRIPE_PRODUCT_APP && c.url)
  if (reusable?.url) return reusable.url
  const prices = await stripe.prices.list({ lookup_keys: [PRO_PRICE_LOOKUP_KEY], active: true })
  const price = prices.data[0]
  if (!price) throw new Error(`no active Stripe price with lookup key ${PRO_PRICE_LOOKUP_KEY}`)
  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    // Pro is priced per Mac: the quantity is the number of paid Macs.
    line_items: [{ price: price.id, quantity: 1, adjustable_quantity: { enabled: true, minimum: 1, maximum: MAX_PAID_MACS } }],
    success_url: returnUrl,
    cancel_url: returnUrl,
    allow_promotion_codes: true,
    client_reference_id: org.orgId,
    metadata: { orgId: org.orgId, app: STRIPE_PRODUCT_APP },
    subscription_data: { metadata: { orgId: org.orgId, app: STRIPE_PRODUCT_APP } },
  }, {
    // Concurrent requests within a day get the same session instead of a second one.
    idempotencyKey: `ghosthand-checkout:${customerId}:${price.id}:${new Date().toISOString().slice(0, 10)}`,
  })
  if (!checkout.url) throw new Error('Stripe Checkout session has no URL')
  return checkout.url
}

export async function portalUrl({ accountId, customerId, returnUrl }: { accountId: string; customerId: string; returnUrl: string }): Promise<string> {
  const portal = await stripeFor(accountId).billingPortal.sessions.create({ customer: customerId, return_url: returnUrl })
  return portal.url
}

/**
 * Mirrors one subscription into Postgres. Re-fetches it, because events can arrive out of
 * order. Ignores subscriptions of other apps on the same Stripe account. Returns the org.
 */
export async function syncSubscription({ accountId, subscriptionId }: { accountId: string; subscriptionId: string }): Promise<string | null> {
  const stripe = stripeFor(accountId)
  const sub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price.product'] })
  const item = sub.items.data[0]
  const product = item?.price.product
  if (!item || !product || typeof product === 'string' || product.deleted || product.metadata.app !== STRIPE_PRODUCT_APP) return null

  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id
  const db = getDb()
  const customer = await db.query.stripeCustomer.findFirst({ where: { stripeCustomerId: customerId } })
  const orgId = customer?.orgId ?? sub.metadata.orgId
  if (!orgId || !(await db.query.org.findFirst({ where: { orgId } }))) {
    console.warn(`subscription ${sub.id}: no org for customer ${customerId}`)
    return null
  }
  const record = {
    orgId,
    stripeAccountId: accountId,
    stripeCustomerId: customerId,
    priceId: item.price.id,
    productId: product.id,
    status: sub.status,
    // Stripe moved the period to the item in API 2025-03-31.
    currentPeriodEnd: item.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    paidMacs: item.quantity ?? 1,
    updatedAt: new Date(),
  }
  await db.insert(schema.subscription)
    .values({ subscriptionId: sub.id, ...record })
    .onConflictDoUpdate({ target: schema.subscription.subscriptionId, set: record })
  trackEvent('subscription_updated', { org_id: orgId, status: sub.status, cancel_at_period_end: sub.cancel_at_period_end })
  return orgId
}
