// Cloud iPhones end to end: the real Worker, hub Durable Object, Postgres fleet and MCP OAuth.
// Only the host Mac is scripted: an HTTP server speaking the fleet API
// (`vphone-cli fleet serve`, docs/cloud-phones.md) with a small Settings app on vphone.sock.
// The task test calls the real model (Vercel AI Gateway): run with `sigillo run -- pnpm test`.
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { mcpAccessToken, startTestRuntime } from '../test-runtime.ts'
import mcpManual from '../../mcp-tools.json'

/** DEFAULT_TEMPLATE of storage.ts, which imports cloudflare:workers. */
const DEFAULT_TEMPLATE = '13e3716a2e12'

let runtime: Awaited<ReturnType<typeof startTestRuntime>>
let host: Awaited<ReturnType<typeof fakeHost>>
/** API key of a user in CLOUD_ADMINS, for the operator routes. */
let adminKey: string
beforeAll(async () => {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is missing: run `sigillo run -- pnpm test`')
  runtime = await startTestRuntime()
  host = await fakeHost('fake', { slots: 2 })
  // The operator route scripts/cloud-host.ts calls, with an API key of a user in CLOUD_ADMINS.
  const admin = (token?: string) => runtime.worker.fetch('/api/cloud-admin/hosts/fake', {
    method: 'PUT', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: JSON.stringify({ address: host.address, status: 'active' }),
  })
  const stranger = await (await runtime.worker.fetch('/__test/session', { method: 'POST' })).json() as { session: { token: string } }
  expect([(await admin()).status, (await admin(stranger.session.token)).status]).toEqual([401, 403])
  await runtime.sql(`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at) VALUES ('cloud-admin-test', 'Operator', 'operator@example.com', true, now(), now())`)
  const operator = await (await runtime.worker.fetch('/__test/session?userId=cloud-admin-test', { method: 'POST' })).json() as { session: { token: string } }
  const key = await (await runtime.worker.fetch('/api/cli/tokens', {
    method: 'POST', headers: { authorization: `Bearer ${operator.session.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'cloud-host.ts' }),
  })).json() as { token: string }
  adminKey = key.token
  const added = await admin(key.token)
  expect(added.status).toBe(200)
  // The slots are the ones the host reported, never the operator's.
  expect(await added.json()).toMatchObject({ hosts: [{ slug: 'fake', online: true, running: 0, slots: 2 }] })
})
const hosts: { server: http.Server }[] = []
afterAll(async () => {
  for (const h of hosts) h.server.close()
  await runtime?.close()
})

/** The fleet's minute cron (host status, starts, stops, crashes), run now. */
const cron = async () => (await runtime.worker.fetch('/__test/cloud-cron')).json()
/** Adds or changes a host like scripts/cloud-host.ts: the route asks the host for its slots. */
const setHost = async (fake: { name: string; address: string }, status: 'active' | 'draining') => {
  const response = await runtime.worker.fetch(`/api/cloud-admin/hosts/${fake.name}`, {
    method: 'PUT', headers: { authorization: `Bearer ${adminKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ address: fake.address, status }),
  })
  expect(response.status).toBe(200)
}

const SCREENS: Record<string, string[]> = {
  home: ['Settings', 'Photos', 'TikTok'],
  settings: ['Settings', 'General', 'Accessibility'],
  general: ['General', 'About', 'Software Update'],
  about: ['About', 'Name', 'Morse iPhone'],
}
const TAPS: Record<string, Record<string, string>> = { home: { Settings: 'settings' }, settings: { General: 'general' }, general: { About: 'about' } }
const ROW_HEIGHT = 44

/** One host Mac speaking the fleet API, a Settings app on every phone. `slots` is what its
 *  status reports and `down` makes it answer nothing (a test may change both). Starts and
 *  stops finish at once; deleting from `phones` is a host that lost a VM. `lines` records each
 *  vphone.sock line, `calls` the start, stop and push calls, `puts` each blob the Worker sent. */
async function fakeHost(name: string, { slots }: { slots: number }) {
  type FakePhone = { state: 'running' | 'stopped'; template: string; screen: string }
  const phones = new Map<string, FakePhone>()
  const blobs = new Set<string>()
  const lines: Record<string, unknown>[] = []
  const calls: string[] = []
  const puts: { sha256: string; bytes: number }[] = []
  // A block per row, centers in points: src/fixtures/task-<screen>.jpg draws them there.
  const blocks = (screen: string) => SCREENS[screen]!.map((text, i) => ({ text, confidence: 0.99, x: 80, y: 110 + i * ROW_HEIGHT, width: 120, height: 20 }))
  const image = (screen: string) => readFileSync(new URL(`../fixtures/task-${screen}.jpg`, import.meta.url)).toString('base64')

  const sock = (id: string, line: Record<string, unknown>) => {
    lines.push(line)
    const phone = phones.get(id)!
    const params = (line.params ?? {}) as Record<string, any>
    const reply = (result: Record<string, unknown> = {}) => ({ ok: true, result, ...(line.screen === true || line.t === 'screenshot' ? { image: image(phone.screen) } : {}) })
    if (line.t === 'screenshot') return reply()
    switch (line.method) {
      case 'ui.ocr': return reply({ blocks: blocks(phone.screen), count: SCREENS[phone.screen]!.length, engine: 'vision' })
      case 'input.tap': {
        const row = blocks(phone.screen).find((b) => Math.abs(b.y - params.y) <= ROW_HEIGHT / 2)
        if (row) phone.screen = TAPS[phone.screen]?.[row.text] ?? phone.screen
        return reply({ x: params.x, y: params.y })
      }
      case 'input.button': if (params.name === 'home') phone.screen = 'home'
        return reply({ button: params.name })
      case 'input.type': return reply({ sent: String(params.text).length })
      case 'input.key': return reply({ dispatched: true, key: params.name })
      case 'apps.list': return reply({ apps: [{ bundle_id: 'com.zhiliaoapp.musically', name: 'TikTok', version: '33.8.0', type: 'user' }] })
      case 'device.info': return reply({ model: 'iPhone17,3', ios_version: '27.0.1', ios_build: '24A446' })
      case 'apps.install': return reply({ bundle_id: 'com.reddit.Reddit', msg: `installed ${params.path}` })
      default: return { ok: false, error: `unknown method ${String(line.method)}` }
    }
  }

  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks)
    const body = request.headers['content-type'] === 'application/json' && raw.length ? JSON.parse(raw.toString()) : {}
    const send = (status: number, value?: object) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(value ? JSON.stringify(value) : '')
    }
    if (fake.down) return send(503, { error: 'down' })
    const url = request.url!
    if (url === '/v1/status') {
      return send(200, {
        host: name, slots: fake.slots, freeDiskBytes: 100e9, bundleVersion: 'test', templates: [DEFAULT_TEMPLATE],
        phones: [...phones].map(([id, p]) => ({ id, state: p.state, template: p.template })),
      })
    }
    if (url === '/v1/blobs/missing') return send(200, { missing: (body.hashes as string[]).filter((h) => !blobs.has(h)) })
    const blob = url.match(/^\/v1\/blobs\/([0-9a-f]{64})$/)
    if (blob && request.method === 'PUT') {
      // The real host refuses bytes that do not match the hash; this one records them.
      puts.push({ sha256: blob[1]!, bytes: raw.length })
      blobs.add(blob[1]!)
      return send(204)
    }
    const [, id, op] = url.match(/^\/v1\/phones\/([^/]+)\/([a-z-]+)$/) ?? []
    const phone = phones.get(id!)
    if (op === 'start') {
      calls.push(`start ${id}${body.create ? ' create' : ''}`)
      // Like fleet serve: create clones only a phone that is not here; without it the phone must exist.
      if (!phone && !body.create) return send(409, { error: `${id} is not on this host` })
      phones.set(id!, { state: 'running', template: body.template, screen: phone?.screen ?? 'home' })
      return send(202)
    }
    if (op === 'stop' && phone) {
      calls.push(`stop ${id}`)
      phone.state = 'stopped'
      return send(202)
    }
    if (op === 'push') {
      if (!blobs.has(body.sha256)) return send(404, { error: 'no such blob' })
      calls.push(`push ${body.sha256.slice(0, 8)} ${body.path}`)
      return send(200, { ok: true, result: { path: body.path } })
    }
    if (op === 'sock') return send(200, sock(id!, body))
    send(404, { error: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const fake = { name, slots, down: false, server, address: `127.0.0.1:${(server.address() as AddressInfo).port}`, phones, lines, calls, puts }
  hosts.push(fake)
  return fake
}

let renters = 0
/** A user whose personal org rents one cloud iPhone, and an MCP token for it. */
async function renter(name: string) {
  const identity = await (await runtime.worker.fetch('/__test/session', { method: 'POST' })).json() as { user: { id: string }; session: { token: string } }
  const orgId = identity.user.id
  const phoneId = `cph_${String(++renters).padStart(26, '0')}`
  const subscriptionId = `sub_${phoneId}`
  await runtime.sql(`INSERT INTO subscription (subscription_id, org_id, stripe_account_id, stripe_customer_id, price_id, product_id, status, kind, created_at, updated_at)
    VALUES ($1, $2, 'acct_test', 'cus_test', 'price_test', 'prod_test', 'active', 'cloud_phone', now(), now())`, [subscriptionId, orgId])
  await runtime.sql('INSERT INTO cloud_phone (cloud_phone_id, org_id, name, subscription_id, template, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())', [phoneId, orgId, name, subscriptionId, DEFAULT_TEMPLATE])
  const token = identity.session.token
  const api = (path: string, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => runtime.worker.fetch(`/macs/cloud/v1${path}`, {
    ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
  })
  const mcpToken = await mcpAccessToken({ runtime, sessionToken: token })
  let rpcId = 0
  const tool = async (name: string, args: Record<string, unknown>) => {
    const response = await runtime.worker.fetch('/mcp', {
      method: 'POST', headers: { authorization: `Bearer ${mcpToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    })
    const { result } = await response.json() as { result: { content: { type: string; text?: string; mimeType?: string }[]; isError: boolean } }
    return { isError: result.isError, content: result.content.map((c) => (c.type === 'text' ? c.text : `[${c.type} ${c.mimeType}]`)) }
  }
  /** Acquire starts a stopped phone and polls its host until it runs. */
  const acquire = async (body: object) => {
    const response = await api('/leases', { method: 'POST', body: JSON.stringify(body) })
    return { status: response.status, body: await response.json() as Record<string, unknown> }
  }
  return { orgId, phoneId, token, api, tool, acquire }
}

test('every MCP tool is answered for cloud iPhones, supported or not', async () => {
  const d = await renter('Coverage iPhone')
  const unknown: string[] = []
  for (const { name } of mcpManual.tools) {
    const { content } = await d.tool(name, {})
    if (content.some((text) => text?.includes('unknown tool'))) unknown.push(name)
  }
  expect(unknown).toEqual([])
}, 30_000)

test('a cloud iPhone works like a Mac\'s iPhone through REST and MCP, and org B cannot reach it', async () => {
  const a = await renter('Cloud iPhone 1')
  const macs = await (await runtime.worker.fetch('/macs', { headers: { authorization: `Bearer ${a.token}` } })).json()
  expect(macs).toEqual({ macs: [{ slug: 'cloud', name: 'Cloud', online: true }] })
  const { devices } = await (await a.api('/devices')).json() as { devices: object[] }
  expect(devices).toEqual([{ id: a.phoneId, mac: 'cloud', name: 'Cloud iPhone 1', model: 'iPhone17,3', modelName: 'iPhone 16', iosVersion: '27.0.1', control: 'bluetooth' }])

  const acquired = await a.acquire({ reason: 'cloud test', label: 'ses_a' })
  expect(acquired.status).toBe(201)
  expect({ ...acquired.body, expiresAt: typeof acquired.body.expiresAt }).toEqual({
    id: 'cloud:1', device: a.phoneId, deviceName: 'Cloud iPhone 1', label: 'ses_a', reason: 'cloud test', idleTimeoutSeconds: 600, expiresAt: 'string',
  })
  const lease = acquired.body.id as string

  host.lines.length = 0
  const tapped = await (await a.api(`/leases/${lease}/tap?screenshot=jpeg`, { method: 'POST', body: JSON.stringify({ text: 'Settings' }) })).json() as any
  expect({ ...tapped, screenshot: { ...tapped.screenshot, data: tapped.screenshot.data.length > 1000 } }).toMatchInlineSnapshot(`
    {
      "logs": [
        "found "Settings" at 80,110",
      ],
      "message": "tapped 80,110",
      "screenshot": {
        "data": true,
        "format": "jpeg",
        "height": 667,
        "width": 375,
      },
    }
  `)
  // OCR first, then the tap with the screen settled on the host in the same line.
  expect(host.lines).toMatchInlineSnapshot(`
    [
      {
        "method": "ui.ocr",
        "params": {
          "languages": [
            "en-US",
          ],
        },
        "screen": false,
        "t": "rpc",
      },
      {
        "method": "input.tap",
        "params": {
          "x": 80,
          "y": 110,
        },
        "screen": true,
        "settle": true,
        "t": "rpc",
      },
    ]
  `)
  expect(await (await a.api(`/leases/${lease}/text`)).json()).toMatchInlineSnapshot(`
    {
      "height": 852,
      "lines": [
        {
          "confidence": 0.99,
          "height": 20,
          "text": "Settings",
          "width": 120,
          "x": 20,
          "y": 100,
        },
        {
          "confidence": 0.99,
          "height": 20,
          "text": "General",
          "width": 120,
          "x": 20,
          "y": 144,
        },
        {
          "confidence": 0.99,
          "height": 20,
          "text": "Accessibility",
          "width": 120,
          "x": 20,
          "y": 188,
        },
      ],
      "width": 393,
    }
  `)

  expect(await a.tool('list', {})).toMatchInlineSnapshot(`
    {
      "content": [
        "mac cloud (Cloud):
    cph_00000000000000000000000002  Cloud iPhone 1  iPhone 16 (iPhone17,3) iOS 27.0.1  (running)  [leased by "ses_a" for "cloud test": acquired 0s ago, last command screentext 0s ago, ends after 10m0s idle]",
      ],
      "isError": false,
    }
  `)
  expect(await a.tool('tap', { lease, text: 'General', screenshot: true, screentext: true })).toMatchInlineSnapshot(`
    {
      "content": [
        "found "General" at 80,154",
        "tapped 80,154
    20,100 120x20 General
    20,144 120x20 About
    20,188 120x20 Software Update",
        "[image image/jpeg]",
      ],
      "isError": false,
    }
  `)
  expect(await a.tool('app-list', { lease })).toMatchInlineSnapshot(`
    {
      "content": [
        "com.zhiliaoapp.musically  TikTok 33.8.0",
      ],
      "isError": false,
    }
  `)
  expect(await a.tool('app-catalog', { lease })).toMatchInlineSnapshot(`
    {
      "content": [
        "tiktok  TikTok  com.zhiliaoapp.musically  [installed]
    reddit  Reddit  com.reddit.Reddit",
      ],
      "isError": false,
    }
  `)
  expect(await a.tool('info', { lease })).toMatchInlineSnapshot(`
    {
      "content": [
        "name: Cloud iPhone 1
    udid: cph_00000000000000000000000002
    model: iPhone 16 (iPhone17,3)
    iOS: 27.0.1 (24A446)",
      ],
      "isError": false,
    }
  `)
  expect(await a.tool('file-list', { lease, path: '/' })).toMatchInlineSnapshot(`
    {
      "content": [
        "error unsupported-in-mode: files are not available on cloud iPhones yet",
      ],
      "isError": true,
    }
  `)

  // Org B has its own cloud iPhone, so its calls reach the cloud module: A's lease is unknown there.
  const b = await renter('Cloud iPhone B')
  const leaseRow = () => runtime.sql('SELECT last_used_at, last_command FROM cloud_lease WHERE cloud_lease_id = 1')
  const before = await leaseRow()
  const stolen = await b.api(`/leases/${lease}/tap`, { method: 'POST', body: JSON.stringify({ x: 10, y: 10 }) })
  expect([stolen.status, (await stolen.json() as { code: string }).code]).toEqual([403, 'lease-invalid'])
  expect(await b.tool('screenshot', { lease })).toMatchInlineSnapshot(`
    {
      "content": [
        "error lease-invalid: lease cloud:1 is unknown, expired or released. Acquire the cloud iPhone again.",
      ],
      "isError": true,
    }
  `)
  expect(await b.tool('release', { lease })).toMatchInlineSnapshot(`
    {
      "content": [
        "lease was already ended (expired, released, or taken with --force)",
      ],
      "isError": false,
    }
  `)
  const takeover = await b.api('/leases', { method: 'POST', body: JSON.stringify({ reason: 'steal', device: a.phoneId }) })
  expect([takeover.status, (await takeover.json() as { code: string }).code]).toEqual([404, 'device-not-found'])
  // B's calls did not even keep A's lease alive.
  expect(await leaseRow()).toEqual(before)

  expect(await a.tool('release', { lease })).toMatchInlineSnapshot(`
    {
      "content": [
        "lease released",
      ],
      "isError": false,
    }
  `)
  expect(await a.tool('tap', { lease, x: 1, y: 1 })).toMatchInlineSnapshot(`
    {
      "content": [
        "error lease-invalid: lease cloud:1 is unknown, expired or released. Acquire the cloud iPhone again.",
      ],
      "isError": true,
    }
  `)
}, 60_000)

test('a phone task drives a cloud iPhone through the hub', async () => {
  const c = await renter('Morse iPhone')
  const { body } = await c.acquire({ reason: 'task test' })
  const response = await c.api(`/leases/${body.id}/task`, {
    method: 'POST', body: JSON.stringify({ prompt: 'Open Settings, then General, then About. Tell me the name of the iPhone.' }),
  })
  const result = await response.json() as { task: string; text: string }
  expect(response.status, JSON.stringify(result)).toBe(200)
  expect(response.headers.get('ghosthand-task')).toBe(result.task)
  expect(host.phones.get(c.phoneId)!.screen).toBe('about')
  expect(result.text).toContain('Morse iPhone')
}, 90_000)

test('a phone stays on its host: an idle phone there stops for it, an offline host or a lost VM is an error, IPAs come from R2', async () => {
  const phoneState = async (phoneId: string) => (await runtime.sql('SELECT state, host_slug, first_run_at IS NOT NULL AS ran FROM cloud_phone WHERE cloud_phone_id = $1', [phoneId]))[0]
  const age = async (phoneId: string) => {
    await runtime.sql(`UPDATE cloud_lease SET ended_at = now() - interval '11 minutes' WHERE cloud_phone_id = $1`, [phoneId])
    await runtime.sql(`UPDATE cloud_phone SET state_changed_at = now() - interval '11 minutes' WHERE cloud_phone_id = $1`, [phoneId])
  }
  const mint = await fakeHost('mint', { slots: 1 })
  // Only mint takes new phones, one at a time.
  await setHost(host, 'draining')
  await setHost(mint, 'active')
  const e = await renter('Pinned iPhone')
  const first = await e.acquire({ reason: 'first run' })
  expect(first.status).toBe(201)
  expect(await phoneState(e.phoneId)).toEqual({ state: 'running', host_slug: 'mint', ran: true })
  expect((await e.api(`/leases/${first.body.id}`, { method: 'DELETE' })).status).toBe(200)

  // F needs mint's only slot after E's grace time: E stops, F is cloned there.
  const f = await renter('Second iPhone')
  await age(e.phoneId)
  const fLease = await f.acquire({ reason: 'needs the slot', waitSeconds: 600 })
  expect(fLease.status).toBe(201)
  expect(mint.calls).toEqual([`start ${e.phoneId} create`, `stop ${e.phoneId}`, `start ${f.phoneId} create`])
  expect(await phoneState(e.phoneId)).toEqual({ state: 'stopped', host_slug: 'mint', ran: true })

  // A free host appears, but E never moves: it waits for mint, where F is leased.
  const studio = await fakeHost('studio', { slots: 2 })
  await setHost(studio, 'active')
  const waiting = await e.acquire({ reason: 'mint is busy', waitSeconds: 1 })
  expect([waiting.status, waiting.body.code]).toEqual([404, 'no-device'])
  expect(studio.calls).toEqual([])

  // F's lease ends and its grace passes: F stops, E starts again on mint from its own disk.
  expect((await f.api(`/leases/${fLease.body.id}`, { method: 'DELETE' })).status).toBe(200)
  await age(f.phoneId)
  const second = await e.acquire({ reason: 'second run', waitSeconds: 600 })
  expect(second.status).toBe(201)
  expect(mint.calls.slice(3)).toEqual([`stop ${f.phoneId}`, `start ${e.phoneId}`])
  expect(studio.calls).toEqual([])

  // mint loses F's VM: F is never cloned again, its user hears it is lost.
  mint.phones.delete(f.phoneId)
  await cron()
  const lost = await f.acquire({ reason: 'after the disk died' })
  expect(lost).toMatchInlineSnapshot(`
    {
      "body": {
        "code": "no-device",
        "detail": "the machine of this cloud iPhone no longer has it: its data is lost and cannot be restored. Tell the user to rent a new cloud iPhone on https://ghosthand.dev/dashboard and sign in to its apps again.",
        "status": 404,
        "title": "No iPhone connected",
      },
      "status": 404,
    }
  `)
  expect(mint.calls.slice(5)).toEqual([])
  expect(await phoneState(f.phoneId)).toEqual({ state: 'stopped', host_slug: 'mint', ran: true })

  // mint goes offline: E's user is told its machine is offline, nothing starts elsewhere.
  expect((await e.api(`/leases/${second.body.id}`, { method: 'DELETE' })).status).toBe(200)
  mint.down = true
  await runtime.sql(`UPDATE cloud_host SET last_seen_at = now() - interval '5 minutes' WHERE slug = 'mint'`)
  expect(await e.tool('acquire', { reason: 'mint is down' })).toMatchInlineSnapshot(`
    {
      "content": [
        "error tunnel-offline: the machine that holds this cloud iPhone is offline right now. A cloud iPhone never moves to another machine: tell the user to try again later.",
      ],
      "isError": true,
    }
  `)
  // The same while a start was in flight when mint went down.
  await runtime.sql(`UPDATE cloud_phone SET state = 'starting' WHERE cloud_phone_id = $1`, [e.phoneId])
  const starting = await e.acquire({ reason: 'mint is still down' })
  expect([starting.status, starting.body.code]).toEqual([503, 'tunnel-offline'])
  expect(studio.calls).toEqual([])
  mint.down = false
  await cron()
  expect(await phoneState(e.phoneId)).toEqual({ state: 'running', host_slug: 'mint', ran: true })

  // A catalog IPA streams from R2 to the host once; the next install reuses the host's copy.
  const third = await e.acquire({ reason: 'mint is back' })
  expect(third.status).toBe(201)
  const lease = third.body.id as string
  const ipa = 'reddit ipa bytes'
  await runtime.env.PHONES.put('apps/reddit/placeholder.ipa', ipa)
  expect(await e.tool('app-install', { lease, app: 'reddit' })).toMatchInlineSnapshot(`
    {
      "content": [
        "downloaded Reddit to the cloud iPhone",
        "installed Reddit (com.reddit.Reddit)",
      ],
      "isError": false,
    }
  `)
  expect(await e.tool('app-install', { lease, app: 'reddit' })).toMatchObject({ isError: false })
  // The catalog's sha256 is a placeholder until Task 4 uploads the real IPAs: only the bytes are checked here.
  expect(mint.puts).toEqual([{ sha256: '0'.repeat(64), bytes: ipa.length }])
  expect(mint.calls.filter((c) => c.startsWith('push'))).toEqual(['push 00000000 /var/mobile/Media/Downloads/reddit.ipa', 'push 00000000 /var/mobile/Media/Downloads/reddit.ipa'])
}, 120_000)

test('a host runs as many phones as the slots it reports, and the admin view shows it full', async () => {
  const trio = await fakeHost('trio', { slots: 3 })
  await runtime.sql(`UPDATE cloud_host SET status = 'draining'`)
  await setHost(trio, 'active')
  const renters = await Promise.all([1, 2, 3, 4].map((i) => renter(`Slot iPhone ${i}`)))
  const acquired = await Promise.all(renters.slice(0, 3).map((r) => r.acquire({ reason: 'fill trio' })))
  expect(acquired.map((a) => a.status)).toEqual([201, 201, 201])
  const fourth = await renters[3]!.acquire({ reason: 'one too many', waitSeconds: 1 })
  expect([fourth.status, fourth.body.code]).toEqual([404, 'no-device'])
  expect(trio.calls.filter((c) => c.startsWith('start'))).toHaveLength(3)

  const view = async (token?: string) => runtime.worker.fetch('/api/cloud-admin/view', { headers: token ? { authorization: `Bearer ${token}` } : {} })
  expect((await view()).status).toBe(401)
  const full = await (await view(adminKey)).json() as any
  const trioView = full.hosts.find((h: { slug: string }) => h.slug === 'trio')
  expect({
    ok: full.ok, problems: full.problems.map((p: { code: string }) => p.code), full: full.contention.full,
    trio: { slots: trioView.slots, free: trioView.free, placed: trioView.placed.map((p: { name: string; state: string; lease: { reason: string } | null }) => `${p.name} ${p.state} ${p.lease?.reason}`).sort(), ms: typeof trioView.ms },
  }).toMatchInlineSnapshot(`
    {
      "full": [
        "trio",
      ],
      "ok": false,
      "problems": [
        "phone-lost",
        "fleet-full",
      ],
      "trio": {
        "free": 0,
        "ms": "number",
        "placed": [
          "Slot iPhone 1 running fill trio",
          "Slot iPhone 2 running fill trio",
          "Slot iPhone 3 running fill trio",
        ],
        "slots": 3,
      },
    }
  `)

  // The host reports a fourth slot: the cron copies it, and the waiting phone starts.
  trio.slots = 4
  await cron()
  expect((await renters[3]!.acquire({ reason: 'room now' })).status).toBe(201)
}, 60_000)
