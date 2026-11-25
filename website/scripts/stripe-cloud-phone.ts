// Creates the Stripe product and price of cloud phones, once per Stripe account. Idempotent:
// it finds the price by lookup key and creates only what is missing.
//
//   STRIPE_SECRET_KEY=sk_test_... bun scripts/stripe-cloud-phone.ts          # test mode
//   sigillo run -c prod -- bun scripts/stripe-cloud-phone.ts --live          # live mode, only with Tommy's go
//
// Product `ghosthand cloud iPhone` (metadata app=ghosthand, kind=cloud_phone): syncSubscription
// reads `kind` from it. Price $49 and €49 per month, lookup key CLOUD_PHONE_PRICE_LOOKUP_KEY.
//
// The billing portal configuration (metadata.app=ghosthand) is checked, not changed: it must
// cancel at period end, and the cloud product must stay out of its subscription_update
// products. Listed there, a customer could switch a cloud phone subscription to the Pro price
// (or back), which would turn a phone into a Pro plan. Unlisted, the portal still shows the
// cloud subscription with cancel and card update, at quantity 1.
import { parseArgs } from 'node:util'
import Stripe from 'stripe'
import { CLOUD_PHONE_PRICE, CLOUD_PHONE_PRICE_LOOKUP_KEY, STRIPE_PRODUCT_APP } from '../src/lib/billing.ts'

const { values } = parseArgs({ options: { live: { type: 'boolean', default: false } } })
const key = process.env.STRIPE_SECRET_KEY
if (!key) {
  console.error('STRIPE_SECRET_KEY is not set')
  process.exit(1)
}
const live = /^(sk|rk)_live_/.test(key)
if (live !== values.live) {
  console.error(live ? 'STRIPE_SECRET_KEY is a live key: pass --live to change live mode.' : '--live given with a test key.')
  process.exit(1)
}
const stripe = new Stripe(key)
const account = await stripe.accounts.retrieve()
console.log(`stripe account ${account.id} (${live ? 'LIVE' : 'test'} mode)`)

const existing = await stripe.prices.list({ lookup_keys: [CLOUD_PHONE_PRICE_LOOKUP_KEY], expand: ['data.product', 'data.currency_options'] })
const price = existing.data[0] ?? await (async () => {
  const products = await stripe.products.search({ query: `metadata['app']:'${STRIPE_PRODUCT_APP}' AND metadata['kind']:'cloud_phone' AND active:'true'` })
  const product = products.data[0] ?? await stripe.products.create({
    name: 'ghosthand cloud iPhone',
    description: 'A virtual iPhone on ghosthand Macs, controlled with the ghosthand MCP, CLI and API.',
    metadata: { app: STRIPE_PRODUCT_APP, kind: 'cloud_phone' },
  })
  console.log(`${products.data[0] ? 'found' : 'created'} product ${product.id}`)
  const cents = CLOUD_PHONE_PRICE * 100
  const created = await stripe.prices.create({
    product: product.id,
    currency: 'usd',
    unit_amount: cents,
    tax_behavior: 'exclusive',
    currency_options: { eur: { unit_amount: cents, tax_behavior: 'exclusive' } },
    recurring: { interval: 'month' },
    lookup_key: CLOUD_PHONE_PRICE_LOOKUP_KEY,
    nickname: 'Cloud iPhone Monthly',
  }, { idempotencyKey: `ghosthand-cloud-phone-price:${product.id}:${cents}` })
  console.log(`created price ${created.id}`)
  return created
})()
const productId = typeof price.product === 'string' ? price.product : price.product.id
console.log(`price ${price.id}: ${price.unit_amount} ${price.currency}/${price.recurring?.interval}, eur ${price.currency_options?.eur?.unit_amount ?? '(not expanded)'}, product ${productId}`)

const configurations = await stripe.billingPortal.configurations.list({ active: true, limit: 100 })
const portal = configurations.data.find((c) => c.metadata?.app === STRIPE_PRODUCT_APP)
if (!portal) {
  console.warn(`no billing portal configuration with metadata.app=${STRIPE_PRODUCT_APP}: create it first (docs/plans/pricing-and-repo-split.md, Task 8)`)
  process.exit(1)
}
const cancel = portal.features.subscription_cancel
const listed = portal.features.subscription_update.products?.some((p) => p.product === productId)
console.log(`portal ${portal.id}: cancel ${cancel.enabled ? cancel.mode : 'off'}, cloud product in plan switching: ${listed}`)
if (!cancel.enabled || cancel.mode !== 'at_period_end' || listed) {
  console.warn('portal configuration does not match: cancel must be at_period_end and the cloud product must not be listed in subscription_update')
  process.exit(1)
}
console.log('done')
