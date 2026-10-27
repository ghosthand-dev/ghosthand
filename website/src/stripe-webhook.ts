// Stripe webhook: POST /api/stripe/webhook. Stripe signs the raw body, so the handler
// reads request.text() once (no zod body, no request.json()) and verifies it with the
// async Web Crypto provider, the only one that works in Workers.
// The endpoint belongs to the account in STRIPE_ACCOUNT_ID. A second Stripe account
// gets its own endpoint and secret.

import { env } from 'cloudflare:workers'
import { Spiceflow } from 'spiceflow'
import Stripe from 'stripe'
import { stripeFor, syncSubscription } from './lib/stripe.ts'
import { syncSourceAccess } from './lib/github.ts'
import { captureException } from './telemetry.ts'

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

    try {
      const orgId = await syncSubscription({ accountId, subscriptionId })
      // Pro gives read access to the daemon repo; cancel takes it away at period end.
      if (orgId) await syncSourceAccess(orgId, request.signal)
    } catch (cause) {
      console.error(`Stripe webhook ${event.type} failed:`, cause)
      captureException(cause, { tags: { route: '/api/stripe/webhook', stripe_event: event.type } })
      return new Response('sync failed', { status: 500 })
    }
    return new Response('ok')
  })
