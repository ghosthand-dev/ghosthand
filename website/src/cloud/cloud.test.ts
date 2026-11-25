// Cloud iPhones end to end: the real Worker, hub and CloudFleet Durable Objects, Postgres and
// MCP OAuth. Only the host Mac is scripted: an HTTP server speaking the fleet API
// (`vphone-cli fleet serve`, docs/cloud-phones.md) with a small Settings app on vphone.sock.
// The task test calls the real model (Vercel AI Gateway): run with `sigillo run -- pnpm test`.
import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { mcpAccessToken, startTestRuntime } from '../test-runtime.ts'
import mcpManual from '../../mcp-tools.json'
import type { TestFleet } from '../test-runtime-worker.ts'

/** DEFAULT_TEMPLATE of storage.ts, which imports cloudflare:workers. */
const DEFAULT_TEMPLATE = '13e3716a2e12'

let runtime: Awaited<ReturnType<typeof startTestRuntime>>
let host: Awaited<ReturnType<typeof fakeHost>>
beforeAll(async () => {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is missing: run `sigillo run -- pnpm test`')
  runtime = await startTestRuntime()
  host = await fakeHost()
  // The operator route scripts/cloud-host.ts calls.
  const admin = (token: string) => runtime.worker.fetch('/api/cloud-admin/hosts/fake', {
    method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ address: host.address, slots: 2, enabled: true }),
  })
  expect((await admin('wrong')).status).toBe(401)
  const added = await admin('local-cloud-admin-test-token')
  expect(added.status).toBe(200)
  expect(await added.json()).toMatchObject({ hosts: [{ slug: 'fake', online: true, running: 0 }] })
})
afterAll(async () => {
  host?.server.close()
  await runtime?.close()
})

const fleet = () => (runtime.env.CLOUD_FLEET as DurableObjectNamespace<TestFleet>).getByName('fleet')

const SCREENS: Record<string, string[]> = {
  home: ['Settings', 'Photos', 'TikTok'],
  settings: ['Settings', 'General', 'Accessibility'],
  general: ['General', 'About', 'Software Update'],
  about: ['About', 'Name', 'Morse iPhone'],
}
const TAPS: Record<string, Record<string, string>> = { home: { Settings: 'settings' }, settings: { General: 'general' }, general: { About: 'about' } }
const ROW_HEIGHT = 44

/** One host with a Settings app on every phone. `lines` records each vphone.sock line. */
async function fakeHost() {
  const phones = new Map<string, { state: 'running' | 'stopped'; version: number; uploadedVersion: number; screen: string }>()
  const lines: Record<string, unknown>[] = []
  const starts: string[] = []
  const pushes: object[] = []
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
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = raw ? JSON.parse(raw) : {}
    const send = (status: number, value?: object) => {
      response.writeHead(status, { 'content-type': 'application/json' })
      response.end(value ? JSON.stringify(value) : '')
    }
    if (request.url === '/v1/status') {
      return send(200, {
        host: 'fake', slots: 2, freeDiskBytes: 100e9, bundleVersion: 'test', templates: [DEFAULT_TEMPLATE],
        phones: [...phones].map(([id, p]) => ({ id, state: p.state, version: p.version, uploadedVersion: p.uploadedVersion })),
      })
    }
    const [, id, op] = request.url!.match(/^\/v1\/phones\/([^/]+)\/([a-z-]+)$/) ?? []
    if (op === 'start') {
      starts.push(id!)
      phones.set(id!, { state: 'running', version: body.version, uploadedVersion: phones.get(id!)?.uploadedVersion ?? 0, screen: 'home' })
      return send(202)
    }
    if (op === 'sock') return send(200, sock(id!, body))
    if (op === 'push-url') {
      pushes.push({ host: new URL(body.url).host, key: new URL(body.url).pathname, signed: new URL(body.url).searchParams.has('X-Amz-Signature'), path: body.path })
      return send(200, { ok: true, result: { path: body.path } })
    }
    send(404, { error: 'not found' })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, address: `127.0.0.1:${(server.address() as AddressInfo).port}`, phones, lines, starts, pushes }
}

let renters = 0
/** A user whose personal org rents one cloud iPhone, and an MCP token for it. */
async function renter(name: string) {
  const identity = await (await runtime.worker.fetch('/__test/session', { method: 'POST' })).json() as { user: { id: string }; session: { token: string } }
  const orgId = identity.user.id
  const phoneId = `cph_${String(++renters).padStart(26, '0')}`
  await runtime.sql('INSERT INTO cloud_phone (cloud_phone_id, org_id, name, status, template, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now())', [phoneId, orgId, name, 'active', DEFAULT_TEMPLATE])
  await fleet().setAccess({ phoneId, orgId, template: DEFAULT_TEMPLATE, allowed: true })
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
  /** Acquire starts a stopped phone: the fleet sees it running at its next poll (the alarm). */
  const acquire = async (body: object) => {
    const pending = api('/leases', { method: 'POST', body: JSON.stringify(body) })
    await expect.poll(() => host.starts.includes(phoneId)).toBe(true)
    await fleet().runAlarm()
    const response = await pending
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
  expect(await a.tool('app-install', { lease, app: 'reddit' })).toMatchInlineSnapshot(`
    {
      "content": [
        "downloaded Reddit to the cloud iPhone",
        "installed Reddit (com.reddit.Reddit)",
      ],
      "isError": false,
    }
  `)
  expect(host.pushes).toMatchInlineSnapshot(`
    [
      {
        "host": "local-test.r2.cloudflarestorage.com",
        "key": "/phones-test/apps/reddit/placeholder.ipa",
        "path": "/var/mobile/Media/Downloads/reddit.ipa",
        "signed": true,
      },
    ]
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
  const before = (await fleet().devices({ orgId: a.orgId }))[0]!.lease
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
  expect((await fleet().devices({ orgId: a.orgId }))[0]!.lease).toEqual(before)

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
