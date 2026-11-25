// Stripe webhook: POST /api/stripe/webhook. Stripe signs the raw body, so the handler
// reads request.text() once (no zod body, no request.json()) and verifies it with the
// async Web Crypto provider, the only one that works in Workers.
// The endpoint belongs to the account in STRIPE_ACCOUNT_ID. A second Stripe account
// gets its own endpoint and secret.
// Pro subscriptions sync the daemon repo access; cloud phone subscriptions may relink their
// cloud_phone row (syncSubscription). A phone's access is its linked subscription's status,
// read at every lease and command, so nothing else needs telling.

import { env } from 'cloudflare:workers'
import { Spiceflow } from 'spiceflow'
import Stripe from 'stripe'
import { stripeFor, syncSubscription, type SyncedSubscription } from './lib/stripe.ts'
import { cloudPhoneStatus, isCloudPhoneAllowed } from './lib/billing.ts'
import { syncSourceAccess } from './lib/github.ts'
import { captureException, trackEvent } from './telemetry.ts'

export const stripeWebhookApp = new Spiceflow({ basePath: '/api/stripe' })
  .post('/webhook', async ({ request }) => {
    const signature = request.headers.get('stripe-signature')
    if (!signature) return new Response('missing stripe-signature', { status: 400 })
    const accountId = env.STRIPE_ACCOUNT_ID
    const stripe = stripeFor(accountId)
    const body = await request.text()
    let event: Stripe.Event
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, env.STRIPE_WEBHOOK_SECRET, undefined, Stripe.createSubtleCryptoProvider())
    } catch (cause) {
      console.error('Stripe webhook signature check failed:', cause)
      // A wrong STRIPE_WEBHOOK_SECRET fails every webhook: report it.
      captureException(cause, { tags: { route: '/api/stripe/webhook' } })
      return new Response('bad signature', { status: 400 })
    }

    const subscriptionId = (() => {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          return event.data.object.id
        case 'checkout.session.completed': {
          const sub = event.data.object.subscription
          return typeof sub === 'string' ? sub : sub?.id ?? null
        }
        default:
          return null
      }
    })()
    if (!subscriptionId) return new Response('ignored')

    let synced: SyncedSubscription | null
    try {
      synced = await syncSubscription({ accountId, subscriptionId })
    } catch (cause) {
      console.error(`Stripe webhook ${event.type} failed:`, cause)
      captureException(cause, { tags: { route: '/api/stripe/webhook', stripe_event: event.type } })
      return new Response('sync failed', { status: 500 })
    }
    if (!synced) return new Response('ok')
    trackEvent('subscription_updated', { org_id: synced.orgId, kind: synced.kind, status: synced.status, cancel_at_period_end: synced.cancelAtPeriodEnd })
    if (synced.kind === 'pro') {
      // Pro gives read access to the daemon repo; cancel takes it away at period end. A GitHub
      // failure still answers 200: Stripe retrying cannot fix GitHub, the daily cron does, and
      // failing webhooks for days would make Stripe disable the endpoint.
      await syncSourceAccess(synced.orgId, request.signal).catch((cause) => {
        captureException(cause, { tags: { route: '/api/stripe/webhook', handler: 'syncSourceAccess' } })
      })
      return new Response('ok')
    }
    const phone = synced.cloudPhone
    if (!phone) return new Response('ok')
    const [before, after] = [cloudPhoneStatus(phone.before), cloudPhoneStatus(phone.after)]
    const props = { org_id: synced.orgId, cloud_phone_id: phone.cloudPhoneId }
    if (isCloudPhoneAllowed(phone.after) && !isCloudPhoneAllowed(phone.before)) trackEvent('cloud_phone_activated', props)
    if (after === 'canceled' && before !== 'canceled') trackEvent('cloud_phone_canceled', props)
    console.log(`cloud phone ${phone.cloudPhoneId}: ${before} -> ${after} (${event.type}, ${subscriptionId} ${synced.status})`)
    return new Response('ok')
  })
