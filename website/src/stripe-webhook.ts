// Stripe webhook: POST /api/stripe/webhook. Stripe signs the raw body, so the handler
// reads request.text() once (no zod body, no request.json()) and verifies it with the
// async Web Crypto provider, the only one that works in Workers.
// The endpoint belongs to the account in STRIPE_ACCOUNT_ID. A second Stripe account
// gets its own endpoint and secret.

import { env } from 'cloudflare:workers'
import { Spiceflow } from 'spiceflow'
import Stripe from 'stripe'
import { stripeFor, syncSubscription } from './lib/stripe.ts'

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
      await syncSubscription({ accountId, subscriptionId })
    } catch (cause) {
      console.error(`Stripe webhook ${event.type} failed:`, cause)
      return new Response('sync failed', { status: 500 })
    }
    return new Response('ok')
  })
