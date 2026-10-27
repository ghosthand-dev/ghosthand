// POST /api/cli/lease-check against the real Worker and a fresh Postgres: binding, limits
// and the race for the last paid Mac slot.
import { afterAll, beforeAll, expect, test } from 'vitest'
import crypto from 'node:crypto'
import { startTestRuntime } from './test-runtime.ts'

let runtime: Awaited<ReturnType<typeof startTestRuntime>>
beforeAll(async () => { runtime = await startTestRuntime() })
afterAll(async () => { await runtime?.close() })

async function newAccount() {
  const response = await runtime.worker.fetch('/__test/session', { method: 'POST' })
  expect(response.status).toBe(200)
  return await response.json() as { user: { id: string }; session: { token: string } }
}

const id = (name: string) => crypto.createHash('sha256').update(`ghosthand-device:${name}`).digest('hex')

async function check(token: string, phone: string, mac: string) {
  const response = await runtime.worker.fetch('/api/cli/lease-check', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ phone: { id: id(phone), name: phone }, mac: { id: id(mac), name: mac } }),
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const body = await response.json() as { allowed: boolean; plan: string; message: string | null }
  return `${phone} on ${mac}: ${body.plan} ${body.allowed ? 'allowed' : `refused | ${body.message}`}`
}

async function subscribe(orgId: string, paidMacs: number) {
  await runtime.sql(
    `INSERT INTO subscription (subscription_id, org_id, stripe_account_id, stripe_customer_id, price_id, product_id, status, paid_macs, created_at, updated_at)
     VALUES ($1, $2, 'acct_test', 'cus_test', 'price_test', 'prod_test', 'active', ${paidMacs}, now(), now())`,
    [`sub_${crypto.randomUUID()}`, orgId],
  )
}

test('free binds one iPhone; Pro takes any iPhone on its paid Mac', async () => {
  const { user, session } = await newAccount()
  const lines = [
    await check(session.token, 'iPhone A', 'studio'),
    await check(session.token, 'iPhone A', 'laptop'),
    await check(session.token, 'iPhone B', 'studio'),
  ]
  await subscribe(user.id, 1)
  lines.push(
    await check(session.token, 'iPhone B', 'studio'),
    await check(session.token, 'iPhone C', 'studio'),
    await check(session.token, 'iPhone C', 'laptop'),
    await check(session.token, 'iPhone A', 'laptop'),
  )
  expect('\n' + lines.join('\n')).toMatchInlineSnapshot(`
    "
    iPhone A on studio: free allowed
    iPhone A on laptop: free allowed
    iPhone B on studio: free refused | The free plan covers one iPhone: iPhone A. Remove it on the dashboard to switch, or subscribe to Pro ($99/month per Mac) for unlimited iPhones.
    iPhone B on studio: pro allowed
    iPhone C on studio: pro allowed
    iPhone C on laptop: pro refused | laptop is not a paid Mac: the plan pays for 1 Mac (studio). Here only the free iPhone (iPhone A) can be leased. Add a Mac in billing, or remove one on the dashboard.
    iPhone A on laptop: pro allowed"
  `)
})

test('two Macs racing for the last paid slot: exactly one wins', async () => {
  const { user, session } = await newAccount()
  // The free iPhone is taken first, so the loser has no fallback.
  expect(await check(session.token, 'iPhone A', 'mini')).toContain('allowed')
  await subscribe(user.id, 1)
  const results = await Promise.all([
    check(session.token, 'iPhone B', 'mac-1'),
    check(session.token, 'iPhone C', 'mac-2'),
  ])
  expect(results.filter((r) => r.includes(': pro allowed'))).toHaveLength(1)
  const macs = await runtime.sql(`SELECT slot FROM org_device WHERE org_id = $1 AND kind = 'mac'`, [user.id])
  expect(macs).toEqual([{ slot: 0 }])
})
