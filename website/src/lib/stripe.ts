// Stripe: clients per account, customers, Checkout, portal, and the webhook mirror.
//
// Rows store the Stripe account id (stripe_customer, subscription). Today one account
// is configured (STRIPE_ACCOUNT_ID + STRIPE_SECRET_KEY, shared with Playwriter). To move
// to a new account: add its keys to `stripeAccounts()`, point STRIPE_ACCOUNT_ID at it.
// Old subscriptions keep renewing and opening the portal on their own account.

import { env } from 'cloudflare:workers'
import Stripe from 'stripe'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getDb, type Org } from '../db.ts'
import {
  CLOUD_PHONE_ALLOWED_STATUSES, CLOUD_PHONE_PRICE_LOOKUP_KEY, EXISTING_STATUSES, isCloudPhoneAllowed, isExistingStatus, linksCloudPhone,
  MAX_PAID_MACS, PRO_PRICE_LOOKUP_KEY, STRIPE_PRODUCT_APP, subscriptionKind, type SubscriptionKind,
} from './billing.ts'
import { DEFAULT_TEMPLATE } from '../cloud/storage.ts'
import { captureException } from '../telemetry.ts'

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
 * Where /subscribe sends the browser: the billing portal when the org already has a Pro
 * subscription (any account, any live status), otherwise a new Checkout. Cloud phone
 * subscriptions are ignored: they never stand for Pro.
 */
export async function subscribeRedirectUrl({ org, email, returnUrl }: { org: Org; email: string; returnUrl: string }): Promise<string> {
  const live = org.subscriptions.find((s) => s.kind === 'pro' && isExistingStatus(s.status))
  if (live) return portalUrl({ accountId: live.stripeAccountId, customerId: live.stripeCustomerId, returnUrl })

  const accountId = checkoutAccountId()
  const stripe = stripeFor(accountId)
  const customerId = await getOrCreateStripeCustomer({ org, email, accountId })
  // The webhook can lag behind a finished Checkout: ask Stripe too.
  const remote = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
  if (remote.data.some((s) => subscriptionKind(s.metadata) === 'pro' && isExistingStatus(s.status))) {
    return portalUrl({ accountId, customerId, returnUrl })
  }
  // Two /subscribe tabs must not become two subscriptions: reuse the open Checkout.
  const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 })
  const reusable = open.data.find((c) => c.mode === 'subscription' && c.metadata?.app === STRIPE_PRODUCT_APP && subscriptionKind(c.metadata) === 'pro' && c.url)
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
    metadata: { orgId: org.orgId, app: STRIPE_PRODUCT_APP, kind: 'pro' },
    subscription_data: { metadata: { orgId: org.orgId, app: STRIPE_PRODUCT_APP, kind: 'pro' } },
  }, {
    // Concurrent requests (double click) get the same session instead of a second one. Per
    // minute, not per day: a key reused after a cancel returns the completed session's URL.
    idempotencyKey: `ghosthand-checkout:${customerId}:${price.id}:${new Date().toISOString().slice(0, 16)}`,
  })
  if (!checkout.url) throw new Error('Stripe Checkout session has no URL')
  return checkout.url
}

/**
 * Where /cloud-phones/new sends the browser. Without `cloudPhoneId`: Checkout for a new
 * phone. The org's unpaid pending phone is reused, so double clicks and abandoned Checkouts
 * never pile up rows. With `cloudPhoneId`: renew that canceled phone (same id, same
 * storage), or the portal when it is still paid.
 */
export async function cloudPhoneCheckoutUrl({ org, email, returnUrl, cloudPhoneId }: {
  org: Org
  email: string
  returnUrl: string
  cloudPhoneId?: string
}): Promise<{ url: string; cloudPhoneId: string }> {
  const db = getDb()
  const accountId = checkoutAccountId()
  const stripe = stripeFor(accountId)
  const customerId = await getOrCreateStripeCustomer({ org, email, accountId })

  const phone = await (async () => {
    if (cloudPhoneId) {
      const existing = org.cloudPhones.find((p) => p.cloudPhoneId === cloudPhoneId)
      if (!existing) throw new Error(`cloud phone ${cloudPhoneId} not found in org ${org.orgId}`)
      return { cloudPhoneId, allowed: isCloudPhoneAllowed(existing.subscription?.status) }
    }
    // The unique index on the org's unpaid phone makes concurrent clicks share one row. The
    // cron deletes unpaid rows by updatedAt: a reused one starts its day again.
    const [unpaid] = await db.insert(schema.cloudPhone)
      .values({ orgId: org.orgId, name: `Cloud iPhone ${org.cloudPhones.length + 1}`, template: DEFAULT_TEMPLATE })
      .onConflictDoUpdate({
        target: schema.cloudPhone.orgId,
        targetWhere: orm.sql`${schema.cloudPhone.subscriptionId} is null`,
        set: { updatedAt: new Date() },
      })
      .returning()
    return { cloudPhoneId: unpaid!.cloudPhoneId, allowed: false }
  })()
  if (phone.allowed) {
    return { url: await portalUrl({ accountId, customerId, returnUrl }), cloudPhoneId: phone.cloudPhoneId }
  }
  // The webhook can lag behind a finished Checkout: a live subscription for this phone goes
  // to the portal, never to a second Checkout that would bill the phone twice.
  const remote = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
  const live = remote.data.find((s) => s.metadata.cloudPhoneId === phone.cloudPhoneId && isExistingStatus(s.status))
  if (live) {
    await syncSubscription({ accountId, subscriptionId: live.id })
    return { url: await portalUrl({ accountId, customerId, returnUrl }), cloudPhoneId: phone.cloudPhoneId }
  }

  const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 })
  const reusable = open.data.find((c) => c.metadata?.cloudPhoneId === phone.cloudPhoneId && c.url)
  if (reusable?.url) return { url: reusable.url, cloudPhoneId: phone.cloudPhoneId }

  const prices = await stripe.prices.list({ lookup_keys: [CLOUD_PHONE_PRICE_LOOKUP_KEY], active: true })
  const price = prices.data[0]
  if (!price) throw new Error(`no active Stripe price with lookup key ${CLOUD_PHONE_PRICE_LOOKUP_KEY}`)
  const metadata = { orgId: org.orgId, app: STRIPE_PRODUCT_APP, kind: 'cloud_phone', cloudPhoneId: phone.cloudPhoneId }
  const checkout = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    // One subscription per phone, so each phone cancels and renews on its own.
    line_items: [{ price: price.id, quantity: 1 }],
    success_url: returnUrl,
    cancel_url: returnUrl,
    allow_promotion_codes: true,
    client_reference_id: org.orgId,
    metadata,
    subscription_data: { metadata },
  }, {
    idempotencyKey: `ghosthand-cloud-checkout:${phone.cloudPhoneId}:${price.id}:${new Date().toISOString().slice(0, 16)}`,
  })
  if (!checkout.url) throw new Error('Stripe Checkout session has no URL')
  return { url: checkout.url, cloudPhoneId: phone.cloudPhoneId }
}

const PENDING_CLOUD_PHONE_TTL_MS = 24 * 60 * 60 * 1000

/** Cron: drops phones nobody paid for within a day. A late payment recreates the row (syncSubscription). */
export async function deleteAbandonedCloudPhones(): Promise<number> {
  const deleted = await getDb().delete(schema.cloudPhone)
    .where(orm.and(
      orm.isNull(schema.cloudPhone.subscriptionId),
      // Never ran: a paid phone whose subscription row is gone keeps its data.
      orm.isNull(schema.cloudPhone.firstRunAt),
      orm.lt(schema.cloudPhone.updatedAt, new Date(Date.now() - PENDING_CLOUD_PHONE_TTL_MS)),
    ))
    .returning()
  return deleted.length
}

/**
 * The portal opens our own configuration (metadata.app = ghosthand): the account's default
 * belongs to Playwriter too. Ours lets customers change the number of paid Macs (1-50) of the
 * Pro price, cancel at period end, and update cards and invoices. Made once per Stripe account
 * with the API; see docs/plans/pricing-and-repo-split.md (Task 8).
 */
export async function portalUrl({ accountId, customerId, returnUrl }: { accountId: string; customerId: string; returnUrl: string }): Promise<string> {
  const stripe = stripeFor(accountId)
  const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
  const configuration = configurations.data.find((c) => c.metadata?.app === STRIPE_PRODUCT_APP)
  if (!configuration) throw new Error(`no active billing portal configuration with metadata.app=${STRIPE_PRODUCT_APP} on Stripe account ${accountId}`)
  const portal = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl, configuration: configuration.id })
  return portal.url
}

export type SyncedSubscription = {
  orgId: string
  status: string
  cancelAtPeriodEnd: boolean
  kind: SubscriptionKind
  /** Cloud phone subscriptions only: the status of the subscription linked to the phone before and after this sync. */
  cloudPhone: { cloudPhoneId: string; before: string | null; after: string | null } | null
}

/**
 * Mirrors one subscription into Postgres. Re-fetches it, because events can arrive out of
 * order. Ignores subscriptions of other apps on the same Stripe account. A cloud phone
 * subscription may also become the one linked to its `cloud_phone` row (see
 * `linksCloudPhone`). Returns what changed, so the webhook can track it (the daily reconcile must not).
 */
export async function syncSubscription({ accountId, subscriptionId }: { accountId: string; subscriptionId: string }): Promise<SyncedSubscription | null> {
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
  const kind = subscriptionKind(product.metadata)
  const cloudPhoneId = kind === 'cloud_phone' ? sub.metadata.cloudPhoneId : undefined
  if (kind === 'cloud_phone' && !cloudPhoneId) console.warn(`cloud phone subscription ${sub.id} has no metadata.cloudPhoneId`)
  // Read before the upsert: the linked subscription may be this one.
  const phone = cloudPhoneId ? await db.query.cloudPhone.findFirst({ where: { cloudPhoneId }, with: { subscription: true } }) : undefined
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
    kind,
    updatedAt: new Date(),
  }
  await db.insert(schema.subscription)
    .values({ subscriptionId: sub.id, ...record })
    .onConflictDoUpdate({ target: schema.subscription.subscriptionId, set: record })
  const synced = { orgId, status: sub.status, cancelAtPeriodEnd: sub.cancel_at_period_end, kind }
  if (!cloudPhoneId) return { ...synced, cloudPhone: null }
  if (phone && phone.orgId !== orgId) {
    console.warn(`cloud phone ${cloudPhoneId} belongs to org ${phone.orgId}, subscription ${sub.id} to ${orgId}`)
    return { ...synced, cloudPhone: null }
  }
  const before = phone?.subscription?.status ?? null
  const linked = { subscriptionId: phone?.subscriptionId ?? null, subscriptionStatus: phone?.subscription?.status ?? null }
  if (linksCloudPhone({ phone: phone ? linked : null, subscription: { subscriptionId: sub.id, status: sub.status } })) {
    const t = schema.cloudPhone
    const allowed = orm.sql.join(CLOUD_PHONE_ALLOWED_STATUSES.map((status) => orm.sql`${status}`), orm.sql`, `)
    await db.insert(t)
      // No row: the cron deleted the pending phone before a late payment.
      .values({ cloudPhoneId, orgId, name: 'Cloud iPhone', template: DEFAULT_TEMPLATE, subscriptionId: sub.id })
      .onConflictDoUpdate({
        target: t.cloudPhoneId,
        set: { subscriptionId: sub.id, updatedAt: new Date() },
        // linksCloudPhone again, on the row as it is now: two webhooks that read the same
        // canceled row must not let the old subscription overwrite the renewal.
        setWhere: orm.sql`${t.orgId} = ${orgId} and (${t.subscriptionId} is null or ${t.subscriptionId} = ${sub.id}
          or (${isCloudPhoneAllowed(sub.status)} and not exists (select 1 from ${schema.subscription}
            where ${schema.subscription.subscriptionId} = ${t.subscriptionId} and ${schema.subscription.status} in (${allowed}))))`,
      })
  }
  const current = await db.query.cloudPhone.findFirst({ where: { cloudPhoneId }, with: { subscription: true } })
  return { ...synced, cloudPhone: { cloudPhoneId, before, after: current?.subscription?.status ?? null } }
}

/**
 * Daily: mirrors every subscription that is not canceled again. Repairs a missed webhook
 * and two webhooks that wrote out of order (one fetched before a cancel, wrote after it).
 */
export async function reconcileSubscriptions(): Promise<{ synced: number; failed: number }> {
  const rows = await getDb().query.subscription.findMany({ where: { status: { in: [...EXISTING_STATUSES] } } })
  let synced = 0
  let failed = 0
  for (const row of rows) {
    try {
      await syncSubscription({ accountId: row.stripeAccountId, subscriptionId: row.subscriptionId })
      synced++
    } catch (cause) {
      failed++
      captureException(cause, { tags: { handler: 'reconcileSubscriptions' } })
    }
  }
  return { synced, failed }
}
