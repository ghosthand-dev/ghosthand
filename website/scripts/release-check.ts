// Post-release end-to-end check of what is live: ghosthand.dev, the release assets in R2, the
// npm package, and the signed-in Macs through the tunnel. Run it after every release.
//
//   bun scripts/release-check.ts                       public + account checks (safe)
//   bun scripts/release-check.ts --phone               + a lease on a test iPhone (read-only, one wake key)
//   bun scripts/release-check.ts --phone --task        + one read-only phone task (spends 1 task prompt)
//   bun scripts/release-check.ts --seed 7 --fuzz 300   replay or widen the fuzz cases
//
//   public   pages, redirects, OAuth + MCP discovery, auth walls, device login start,
//            latest.json ─▶ pkg + zip (notarized, version) ─▶ npm dist-tag ─▶ npx --version,
//            docs and skill served == this checkout, seeded fuzz (no 5xx, no 2xx past auth)
//   account  local daemon (unix socket) ─▶ temporary API token ─▶ GET /macs ─▶ each online
//            Mac: daemon version, devices, invalid-lease fuzz ─▶ .txt upload page ─▶ revoke ─▶ 401
//   phone    acquire (never force) ─▶ info, png, jpeg+screentext, waitText hit and timeout,
//            wake key + settled screenshot ─▶ [task] ─▶ release
//
// Safe by default: no Stripe, no purchases, no phone input, no account changes besides a
// device code that expires, an API token revoked at the end and a 1-day upload.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, promisify } from 'node:util'
import createClient from 'openapi-fetch'
import type { paths } from '../src/generated/daemon-api.ts'

const exec = promisify(execFile)
const ROOT = new URL('../../', import.meta.url).pathname
const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'https://ghosthand.dev' },
    version: { type: 'string' },
    seed: { type: 'string' },
    fuzz: { type: 'string', default: '80' },
    phone: { type: 'boolean', default: false },
    task: { type: 'boolean', default: false },
    mac: { type: 'string' },
    device: { type: 'string' },
    'skip-assets': { type: 'boolean', default: false },
  },
})
const BASE = values.base.replace(/\/$/, '')
const VERSION = values.version ?? JSON.parse(readFileSync(join(ROOT, 'npm/package.json'), 'utf8')).version as string
const SEED = Number(values.seed ?? Math.floor(Math.random() * 2 ** 31))
const FUZZ_CASES = Number(values.fuzz)
const REQUEST_TIMEOUT_MS = 30_000
const FUZZ_CONCURRENCY = 4
const MIN_ASSET_BYTES = 5_000_000
const SOCKET = join(homedir(), '.ghosthand/daemon.sock')
const UNUSED_LEASE_BASE = 900_000_000

// ── results ──────────────────────────────────────────────────────────────────────────────

type Outcome = 'pass' | 'fail' | 'skip' | 'warn'
const results: { name: string; outcome: Outcome; detail: string }[] = []
const ICON: Record<Outcome, string> = { pass: '✓', fail: '✗', skip: '-', warn: '!' }

class Skip extends Error {}
class Warn extends Error {}

function record(name: string, outcome: Outcome, detail = '') {
  results.push({ name, outcome, detail })
  console.log(`${ICON[outcome]} ${name}${detail ? `  ${detail}` : ''}`)
}

/** Runs one check; a thrown Skip or Warn records that instead of a failure. */
async function check(name: string, run: () => Promise<string | void>) {
  const start = performance.now()
  try {
    const detail = (await run()) ?? ''
    record(name, 'pass', `${detail} (${Math.round(performance.now() - start)} ms)`.trim())
  } catch (error) {
    if (error instanceof Skip) return record(name, 'skip', error.message)
    if (error instanceof Warn) return record(name, 'warn', error.message)
    record(name, 'fail', error instanceof Error ? error.message : String(error))
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

// ── http ─────────────────────────────────────────────────────────────────────────────────

function http(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(path.startsWith('http') ? path : BASE + path, { redirect: 'manual', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init })
}

async function json<T = any>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${response.status} ${response.url}: not JSON: ${text.slice(0, 200)}`)
  }
}

/** The first bytes of a download, then the connection is closed. */
async function firstBytes(response: Response, count: number): Promise<Uint8Array> {
  const reader = response.body!.getReader()
  const { value } = await reader.read()
  await reader.cancel()
  return (value ?? new Uint8Array()).slice(0, count)
}

async function download(url: string, file: string): Promise<number> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) })
  expect(response.ok, `${url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  writeFileSync(file, bytes)
  return bytes.length
}

/** The local daemon's API on its unix socket. */
function socket<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = httpRequest(
      { socketPath: SOCKET, path, method, headers: { accept: 'application/json', ...(payload ? { 'content-type': 'application/json' } : {}) }, timeout: REQUEST_TIMEOUT_MS },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : undefined }))
      },
    )
    req.on('timeout', () => req.destroy(new Error(`unix socket ${path}: timeout`)))
    req.on('error', reject)
    req.end(payload)
  })
}

// ── seeded fuzz input ────────────────────────────────────────────────────────────────────

/** mulberry32: same seed, same cases. */
function rng(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (max: number) => Math.floor(next() * max)
  const pick = <T,>(items: readonly T[]): T => items[int(items.length)]!
  return { next, int, pick }
}

const NASTY = ['..', '../', '%2e%2e%2f', '%00', '%ff', '🙂', 'é', ' ', '"', "'", '<script>', '{}', '[]', 'null', '-1', '0', '1e309', '\\', '//', 'ghk_', 'Ghosthand-0.0.0.pkg', 'latest.json.bak', 'A'.repeat(300)]

function fuzzString(r: ReturnType<typeof rng>, maxParts = 4): string {
  return Array.from({ length: 1 + r.int(maxParts) }, () => (r.next() < 0.5 ? r.pick(NASTY) : r.int(1e9).toString(36))).join('')
}

type FuzzCase = { label: string; path: string; init: RequestInit; ok: (status: number) => boolean; rule: string }

const UNAUTHORIZED = (s: number) => s >= 400 && s < 500
const NOT_FOUND = (s: number) => s === 404 || s === 400 || s === 414

/** Requests that must never reach a 5xx, and never a 2xx past an auth wall. */
function fuzzCase(r: ReturnType<typeof rng>): FuzzCase {
  const junk = () => encodeURIComponent(fuzzString(r))
  const bearer = (): Record<string, string> => (r.next() < 0.3 ? {} : { authorization: `Bearer ${r.pick(['', 'ghk_', 'x', ''])}${fuzzString(r, 2)}`.replace(/[^\x20-\x7e]/g, '') })
  const body = () => r.pick([undefined, '', '{', 'null', '[]', JSON.stringify({ deviceCode: fuzzString(r) }), JSON.stringify({ id: fuzzString(r), messages: [], lease: fuzzString(r) }), JSON.stringify({ phone: { id: 'f'.repeat(64), name: fuzzString(r) }, mac: { id: '0', name: '' } })])
  const kinds: (() => FuzzCase)[] = [
    () => ({ label: 'release file', path: `/releases/${junk()}`, init: {}, ok: NOT_FOUND, rule: '404' }),
    () => ({ label: 'upload page', path: `/u/${junk()}${r.pick(['', '/file'])}`, init: {}, ok: NOT_FOUND, rule: '404' }),
    () => ({ label: 'device token', path: '/api/cli/login/token', init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: body() }, ok: (s) => s === 200 || UNAUTHORIZED(s), rule: '200 or 4xx' }),
    () => ({ label: 'account', path: '/api/cli/account', init: { headers: bearer() }, ok: UNAUTHORIZED, rule: '4xx' }),
    () => ({ label: 'lease-check', path: '/api/cli/lease-check', init: { method: 'POST', headers: { 'content-type': 'application/json', ...bearer() }, body: body() }, ok: UNAUTHORIZED, rule: '4xx' }),
    () => ({ label: 'task', path: `/api/cli/tasks${r.pick(['', `/${junk()}`, `/${junk()}/stream`])}`, init: { method: r.pick(['GET', 'POST']), headers: { 'content-type': 'application/json', ...bearer() }, body: body() }, ok: UNAUTHORIZED, rule: '4xx' }),
    () => ({ label: 'task abort', path: `/api/cli/tasks/${junk()}/abort?prompt=${junk()}`, init: { method: 'POST', headers: bearer() }, ok: UNAUTHORIZED, rule: '4xx' }),
    () => ({ label: 'upload', path: `/api/cli/upload?name=${junk()}`, init: { method: 'POST', headers: { 'content-type': 'text/plain', ...bearer() }, body: fuzzString(r) }, ok: UNAUTHORIZED, rule: '4xx' }),
    () => ({ label: 'tokens', path: r.pick(['/api/cli/tokens', `/api/cli/tokens/${junk()}`]), init: { method: r.pick(['POST', 'DELETE']), headers: { 'content-type': 'application/json', ...bearer() }, body: body() }, ok: UNAUTHORIZED, rule: '4xx' }),
    () => ({ label: 'macs', path: `/macs/${junk()}/v1/${r.pick(['devices', 'daemon', `leases/${junk()}/screenshot`, junk()])}`, init: { headers: bearer() }, ok: UNAUTHORIZED, rule: '4xx' }),
    () => ({ label: 'mcp', path: '/mcp', init: { method: 'POST', headers: { 'content-type': 'application/json', ...bearer() }, body: JSON.stringify({ jsonrpc: '2.0', id: r.int(1000), method: r.pick(['initialize', 'tools/list', 'tools/call', fuzzString(r)]), params: { name: r.pick(['tap', 'screenshot', fuzzString(r)]) } }) }, ok: UNAUTHORIZED, rule: '4xx' }),
  ]
  return r.pick(kinds)()
}

// ── public ───────────────────────────────────────────────────────────────────────────────

const XAR = [0x78, 0x61, 0x72, 0x21] // "xar!": flat .pkg
const ZIP = [0x50, 0x4b, 0x03, 0x04]
const startsWith = (bytes: Uint8Array, magic: number[]) => magic.every((b, i) => bytes[i] === b)

async function publicChecks(tmp: string) {
  await check('home page renders', async () => {
    const response = await http('/')
    expect(response.status === 200, `GET / ${response.status}`)
    expect((await response.text()).toLowerCase().includes('ghosthand'), 'no "ghosthand" in the page')
  })

  await check('redirects', async () => {
    const cases: [string, number, string][] = [
      ['/pricing', 301, '/docs/pricing'], ['/privacy', 301, '/docs/privacy'], ['/terms', 301, '/docs/terms'], ['/support', 301, '/docs/support'],
      ['/dashboard', 307, '/login?callbackURL=%2Fdashboard'], ['/subscribe', 307, '/login?callbackURL=%2Fsubscribe'],
    ]
    for (const [path, status, location] of cases) {
      const response = await http(path)
      expect(response.status === status && response.headers.get('location')?.endsWith(location), `${path}: ${response.status} -> ${response.headers.get('location')}`)
    }
    return `${cases.length} paths; /subscribe never reaches Stripe signed out`
  })

  await check('MCP OAuth discovery', async () => {
    const unauthorized = await http('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) })
    expect(unauthorized.status === 401, `POST /mcp without token: ${unauthorized.status}`)
    const metadataUrl = unauthorized.headers.get('www-authenticate')?.match(/resource_metadata="([^"]+)"/)?.[1]
    expect(metadataUrl, 'no resource_metadata in WWW-Authenticate')
    const resource = await json(await http(metadataUrl))
    expect(resource.resource === `${BASE}/mcp`, `resource is ${resource.resource}`)
    const issuer = new URL(resource.authorization_servers[0])
    const server = await json(await http(`${issuer.origin}/.well-known/oauth-authorization-server${issuer.pathname}`))
    for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) expect(server[key]?.startsWith(BASE), `authorization server has no ${key}`)
    expect((await http('/mcp', { method: 'GET' })).status === 405, 'GET /mcp is not 405')
    expect((await http('/mcp', { method: 'POST', headers: { origin: 'https://evil.example' } })).status === 403, 'browser POST /mcp is not 403')
  })

  await check('auth walls', async () => {
    const cases: [string, RequestInit, number][] = [
      ['/api/cli/account', {}, 401],
      ['/api/cli/lease-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ phone: { id: 'a'.repeat(64), name: 'x' }, mac: { id: 'b'.repeat(64), name: 'y' } }) }, 401],
      ['/api/cli/upload?name=a.txt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' }, 401],
      ['/api/cli/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'release-check-1', lease: 'studio:1', messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }] }) }, 401],
      ['/macs', {}, 401],
      ['/macs', { headers: { origin: 'https://evil.example' } }, 403],
      ['/tunnel/upstream', {}, 426],
    ]
    for (const [path, init, status] of cases) {
      const response = await http(path, init)
      expect(response.status === status, `${init.method ?? 'GET'} ${path}: ${response.status}, want ${status}`)
    }
    return `${cases.length} routes`
  })

  await check('device login starts and polls pending', async () => {
    const start = await json(await http('/api/cli/login', { method: 'POST' }))
    expect(start.deviceCode && start.userCode && start.interval > 0, `bad start: ${JSON.stringify(start)}`)
    expect(new URL(start.verificationUrl).origin === BASE, `verificationUrl on ${start.verificationUrl}`)
    const poll = await json(await http('/api/cli/login/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceCode: start.deviceCode }) }))
    expect(poll.status === 'pending', `poll: ${JSON.stringify(poll)}`)
    const page = await http(`/device?user_code=${encodeURIComponent(start.userCode)}`)
    expect(page.status === 307 && page.headers.get('location')?.includes('/login'), `/device signed out: ${page.status}`)
  })

  let manifest: { version: string; pkg: string; zip: string; publishedAt: string } | undefined
  await check(`release manifest is ${VERSION}`, async () => {
    manifest = await json(await http('/releases/latest.json'))
    expect(manifest!.version === VERSION, `latest.json has ${manifest!.version}`)
    expect(manifest!.pkg === `Ghosthand-${VERSION}.pkg` && manifest!.zip === `Ghosthand-${VERSION}.zip`, 'pkg or zip name does not match the version')
    return `published ${manifest!.publishedAt}`
  })

  await check('installer download links', async () => {
    expect(manifest, 'no manifest')
    const pkg = await http('/download/ghosthand.pkg')
    expect(pkg.status === 200 && pkg.headers.get('content-disposition')?.includes(manifest.pkg), `/download/ghosthand.pkg: ${pkg.status} ${pkg.headers.get('content-disposition')}`)
    expect(startsWith(await firstBytes(pkg, 4), XAR), '/download/ghosthand.pkg is not a xar .pkg')
    for (const [file, magic] of [[manifest.pkg, XAR], [manifest.zip, ZIP]] as const) {
      const response = await http(`/releases/${file}`)
      expect(response.status === 200 && Number(response.headers.get('content-length')) > MIN_ASSET_BYTES, `${file}: ${response.status}, ${response.headers.get('content-length')} bytes`)
      expect(startsWith(await firstBytes(response, 4), magic), `${file} has the wrong file type`)
    }
    const page = await (await http('/download')).text()
    expect(page.includes(VERSION), `/download does not show ${VERSION}`)
  })

  await check('release assets are notarized and carry the version', async () => {
    if (values['skip-assets']) throw new Skip('--skip-assets')
    expect(manifest, 'no manifest')
    const zip = join(tmp, manifest.zip)
    const pkg = join(tmp, manifest.pkg)
    await download(`${BASE}/releases/${manifest.zip}`, zip)
    await download(`${BASE}/releases/${manifest.pkg}`, pkg)
    await exec('ditto', ['-x', '-k', zip, join(tmp, 'zip')])
    const app = join(tmp, 'zip/Ghosthand.app')
    const { stdout: plist } = await exec('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents/Info.plist')])
    const info = JSON.parse(plist)
    expect(info.CFBundleShortVersionString === VERSION, `app version ${info.CFBundleShortVersionString}`)
    await exec('codesign', ['--verify', '--deep', '--strict', app])
    const appAssess = await exec('spctl', ['--assess', '--type', 'execute', '-vv', app]).then((r) => r.stderr, (e) => String(e.stderr))
    expect(appAssess.includes('Notarized Developer ID'), `zip app: ${appAssess.trim()}`)
    const pkgAssess = await exec('spctl', ['--assess', '--type', 'install', '-vv', pkg]).then((r) => r.stderr, (e) => String(e.stderr))
    expect(pkgAssess.includes('Notarized Developer ID'), `pkg: ${pkgAssess.trim()}`)
    await exec('xcrun', ['stapler', 'validate', pkg])
    return `build ${info.GhosthandSourceBuildID ?? '?'}`
  })

  await check(`npm latest is ${VERSION} and runs`, async () => {
    const registry = await json(await http('https://registry.npmjs.org/ghosthand'))
    expect(registry['dist-tags'].latest === VERSION, `npm latest is ${registry['dist-tags'].latest}`)
    // --version exits before anything is installed or a daemon starts.
    const { stdout } = await exec('npx', ['-y', `ghosthand@${VERSION}`, '--version'], { cwd: tmp, timeout: 5 * 60_000 })
    expect(stdout.trim() === VERSION, `npx ghosthand@${VERSION} --version printed ${stdout.trim()}`)
  })

  await check('skill served == this checkout', async () => {
    const served = await (await http('/.well-known/agent-skills/ghosthand/SKILL.md')).text()
    const index = await json(await http('/.well-known/agent-skills/index.json'))
    const digest = `sha256:${createHash('sha256').update(served).digest('hex')}`
    expect(index.skills[0].digest === digest, 'index.json digest does not match the served SKILL.md')
    expect(served === readFileSync(join(ROOT, 'skills/ghosthand/SKILL.md'), 'utf8'), 'the deployed SKILL.md differs from this checkout: website not deployed?')
  })

  await check('CLI docs served match this checkout', async () => {
    const dir = join(ROOT, 'website/src/docs/cli')
    const missing: string[] = []
    const files = readdirSync(dir).filter((f) => f.endsWith('.md'))
    for (const file of files) {
      const response = await http(`/docs/cli/${file}`)
      const served = response.ok ? await response.text() : ''
      // Every flag the local page documents must be live, e.g. a new --fast.
      const flags = new Set(readFileSync(join(dir, file), 'utf8').match(/--[a-z][a-z-]+/g) ?? [])
      const gone = [...flags].filter((flag) => !served.includes(flag))
      if (!response.ok || gone.length) missing.push(`${file}${response.ok ? ` (${gone.join(' ')})` : `: ${response.status}`}`)
    }
    expect(!missing.length, `stale or missing: ${missing.join(', ')}`)
    return `${files.length} pages`
  })

  await check(`fuzz ${FUZZ_CASES} unauthenticated requests (seed ${SEED})`, async () => {
    const r = rng(SEED)
    const cases = Array.from({ length: FUZZ_CASES }, () => fuzzCase(r)).map((c) =>
      (c.init.method ?? 'GET') === 'GET' ? { ...c, init: { ...c.init, body: undefined } } : c)
    const failures: string[] = []
    for (let i = 0; i < cases.length; i += FUZZ_CONCURRENCY) {
      await Promise.all(cases.slice(i, i + FUZZ_CONCURRENCY).map(async (c, j) => {
        const request = `#${i + j} ${c.label} ${c.init.method ?? 'GET'} ${c.path.slice(0, 80)} ${JSON.stringify({ headers: c.init.headers, body: c.init.body })}`
        const response = await http(c.path, c.init).catch((error) => error as Error)
        if (response instanceof Error) return failures.push(`${request}: ${response.message}`)
        await response.body?.cancel()
        if (response.status >= 500 || !c.ok(response.status)) failures.push(`${request}: ${response.status}, want ${c.rule}`)
      }))
    }
    if (failures.length) console.log(failures.map((f) => `    ${f}`).join('\n'))
    expect(!failures.length, `${failures.length} of ${cases.length} bad, listed above`)
    return `${new Set(cases.map((c) => c.label)).size} route kinds`
  })
}

// ── account ──────────────────────────────────────────────────────────────────────────────

type Tunnel = ReturnType<typeof tunnelClient>

function tunnelClient(token: string, slug: string) {
  return createClient<paths, 'application/json' | 'application/problem+json'>({
    baseUrl: `${BASE}/macs/${slug}`,
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    fetch: (request) => fetch(request, { signal: AbortSignal.timeout(60_000) }),
  })
}

async function accountChecks(seed: number): Promise<{ token: string; macs: { slug: string; name: string }[]; revoke: () => Promise<void> } | undefined> {
  let session: { token: string; macs: { slug: string; name: string }[]; revoke: () => Promise<void> } | undefined
  await check('temporary API token from the local daemon', async () => {
    if (process.env.GHOSTHAND_TOKEN) {
      session = { token: process.env.GHOSTHAND_TOKEN, macs: [], revoke: async () => {} }
      return 'GHOSTHAND_TOKEN from the environment (not revoked)'
    }
    if (!existsSync(SOCKET)) throw new Skip(`no daemon socket at ${SOCKET}; set GHOSTHAND_TOKEN to run the account checks`)
    const account = await socket('GET', '/v1/account')
    if (account.body?.state !== 'signed-in' || account.body?.server !== BASE) throw new Skip(`local daemon is ${account.body?.state} on ${account.body?.server}`)
    const created = await socket('POST', '/v1/tunnel/tokens', { name: 'release-check' })
    expect(created.status === 201 && created.body.token, `create token: ${created.status} ${JSON.stringify(created.body)}`)
    const { id, token } = created.body
    session = { token, macs: [], revoke: async () => {
      const revoked = await socket('DELETE', `/v1/tunnel/tokens/${id}`)
      expect(revoked.status === 200, `revoke: ${revoked.status}`)
    } }
    return `plan ${account.body.plan}`
  })
  if (!session) return

  await check('GET /macs lists online Macs', async () => {
    const response = await http('/macs', { headers: { authorization: `Bearer ${session!.token}` } })
    expect(response.status === 200, `GET /macs: ${response.status}`)
    const { macs } = await json<{ macs: { slug: string; name: string; online: boolean }[] }>(response)
    session!.macs = macs.filter((m) => m.online)
    expect(session!.macs.length, 'no Mac of this account is online')
    return `${session!.macs.length}/${macs.length} online: ${session!.macs.map((m) => m.slug).join(', ')}`
  })

  for (const mac of session.macs) {
    const api = tunnelClient(session.token, mac.slug)
    await check(`mac ${mac.slug}: daemon and devices through the tunnel`, async () => {
      const daemon = await api.GET('/v1/daemon')
      expect(daemon.data, `GET /v1/daemon: ${daemon.response.status} ${JSON.stringify(daemon.error)}`)
      const devices = await api.GET('/v1/devices')
      const phones = devices.data?.devices.length ?? 0
      expect(devices.data || (devices.error as any)?.code === 'no-device', `GET /v1/devices: ${devices.response.status} ${JSON.stringify(devices.error)}`)
      // Auto-update waits for an idle Mac and checks hourly: an older daemon is a warning.
      const detail = `daemon ${daemon.data.version}, ${phones} iPhone(s)`
      if (daemon.data.version !== VERSION) throw new Warn(`${detail}; not ${VERSION} yet (${daemon.data.update?.message ?? 'no update status'})`)
      return detail
    })
  }

  const first = session.macs[0]
  if (first) {
    await check(`mac ${first.slug}: invalid leases and routes fail cleanly`, async () => {
      const r = rng(seed + 1)
      const paths = [
        ...Array.from({ length: 6 }, () => `/v1/leases/${first.slug}:${UNUSED_LEASE_BASE + r.int(99_999_999)}/${r.pick(['screenshot', 'text', 'info', 'files?path=/'])}`),
        `/v1/leases/${encodeURIComponent(fuzzString(r))}/screenshot`, `/v1/leases/0/info`, `/v1/${encodeURIComponent(fuzzString(r))}`,
      ]
      for (const path of paths) {
        const response = await http(`/macs/${first.slug}${path}`, { headers: { authorization: `Bearer ${session!.token}` } })
        const body = await response.text()
        expect(response.status >= 400 && response.status < 500, `GET ${path}: ${response.status} ${body.slice(0, 160)}`)
      }
      const offline = await http(`/macs/release-check-nonexistent/v1/daemon`, { headers: { authorization: `Bearer ${session!.token}` } })
      expect(offline.status === 503 && (await json(offline)).code === 'mac-offline', `unknown Mac: ${offline.status}`)
      return `${paths.length + 1} requests; only read routes, on lease numbers no Mac has given out`
    })
  }

  await check('text upload: share page with Copy, escaped, ranged file', async () => {
    const text = `release check ${seed} <script>alert(1)</script> & “àèé” 🙂\nline 2`
    const response = await http(`/api/cli/upload?name=release-check-${seed}.txt`, {
      method: 'POST',
      headers: { authorization: `Bearer ${session!.token}`, 'content-type': 'text/plain' },
      body: new TextEncoder().encode(text),
    })
    expect(response.status === 200, `upload: ${response.status} ${await response.clone().text()}`)
    const upload = await json(response)
    expect(new URL(upload.url).origin === BASE && upload.size === new TextEncoder().encode(text).length, `upload: ${JSON.stringify(upload)}`)
    const page = await (await http(upload.url)).text()
    expect(page.includes('id="copy"'), 'the .txt page has no Copy button')
    expect(page.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !page.includes('<script>alert(1)</script>'), 'the uploaded text is not escaped in the page')
    const ranged = await http(`${upload.url}/file`, { headers: { range: 'bytes=0-12' } })
    expect(ranged.status === 206 && (await ranged.text()) === text.slice(0, 13), `ranged file: ${ranged.status}`)
    return `expires ${upload.expiresAt}`
  })

  return session
}

// ── phone (opt-in) ───────────────────────────────────────────────────────────────────────

async function phoneChecks(session: { token: string; macs: { slug: string }[] }, seed: number) {
  const slug = values.mac ?? session.macs[0]?.slug
  if (!slug) return record('phone checks', 'skip', 'no online Mac')
  const api: Tunnel = tunnelClient(session.token, slug)
  let lease: string | undefined
  await check(`mac ${slug}: acquire a lease (never force)`, async () => {
    const devices = await api.GET('/v1/devices')
    const free = devices.data?.devices.filter((d) => !d.lease && !d.locked && (!values.device || d.id === values.device || d.name === values.device)) ?? []
    if (!free.length) throw new Skip(`no free unlocked iPhone on ${slug}${values.device ? ` matching ${values.device}` : ''}`)
    const acquired = await api.POST('/v1/leases', {
      // Short idle timeout: a crashed run frees the iPhone in 2 minutes.
      body: { device: free[0]!.id, label: 'release-check', reason: 'post-release check: screenshots, OCR, one wake key', force: false, idleTimeoutSeconds: 120 },
    })
    if ((acquired.error as any)?.code === 'device-leased') throw new Skip('the iPhone was just leased by someone else')
    expect(acquired.data, `acquire: ${acquired.response.status} ${JSON.stringify(acquired.error)}`)
    lease = acquired.data.id
    return `${lease} on ${free[0]!.name}`
  })
  if (!lease) return
  const path = { lease }
  try {
    await check('info', async () => {
      const info = await api.GET('/v1/leases/{lease}/info', { params: { path } })
      expect(info.data, `info: ${JSON.stringify(info.error)}`)
      return JSON.stringify(info.data).slice(0, 80)
    })
    await check('screenshot png', async () => {
      const shot = await api.GET('/v1/leases/{lease}/screenshot', { params: { path }, parseAs: 'arrayBuffer' })
      expect(shot.data, `screenshot: ${shot.response.status}`)
      const bytes = new Uint8Array(shot.data)
      expect(startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]), 'not a PNG')
      return `${shot.response.headers.get('x-image-width')}x${shot.response.headers.get('x-image-height')}, ${bytes.length} bytes`
    })
    let lines: string[] = []
    await check('screenshot jpeg + screentext of the same frame', async () => {
      const shot = await api.GET('/v1/leases/{lease}/screenshot', { params: { path, query: { format: 'jpeg', screentext: true } } })
      const data = shot.data as any
      expect(data?.screenshot && data?.screen, `want JSON with screenshot and screen: ${shot.response.status} ${shot.response.headers.get('content-type')}`)
      expect(startsWith(Buffer.from(data.screenshot.data, 'base64'), [0xff, 0xd8, 0xff]), 'not a JPEG')
      expect(data.screen.width === data.screenshot.width, 'OCR space differs from the image')
      lines = data.screen.lines.map((l: { text: string }) => l.text)
      return `${lines.length} lines`
    })
    await check('screentext waitText finds a visible line, and times out on a missing one', async () => {
      const visible = lines.find((l) => /^[\x20-\x7e]{4,}$/.test(l))
      if (!visible) throw new Skip('no ASCII line on screen to wait for')
      const hit = await api.GET('/v1/leases/{lease}/text', { params: { path, query: { waitText: visible, timeoutMs: 5000 } } })
      expect(hit.data?.lines.some((l) => l.text.toLowerCase().includes(visible.toLowerCase())), `waitText ${visible}: ${JSON.stringify(hit.error)}`)
      const missing = `zq${seed.toString(36)}xj`
      const miss = await api.GET('/v1/leases/{lease}/text', { params: { path, query: { waitText: missing, timeoutMs: 800 } } })
      expect((miss.error as any)?.code === 'wait-text-timeout', `missing text: ${miss.response.status} ${JSON.stringify(miss.error ?? miss.data).slice(0, 160)}`)
      return `waited for "${visible}"`
    })
    await check('invalid query values are 4xx', async () => {
      for (const query of ['scale=-1', 'scale=abc', 'format=gif', 'timeoutMs=0&waitText=x', 'language=xx-%00']) {
        const route = query.includes('waitText') || query.includes('language') ? 'text' : 'screenshot'
        const response = await http(`/macs/${slug}/v1/leases/${lease}/${route}?${query}`, { headers: { authorization: `Bearer ${session.token}` } })
        await response.body?.cancel()
        expect(response.status >= 400 && response.status < 500, `${route}?${query}: ${response.status}`)
      }
    })
    await check('wake key (Left Control) + settled screenshot, --fast', async () => {
      const wake = await api.POST('/v1/leases/{lease}/wake', { params: { path, query: { screenshot: 'jpeg', fast: true } } })
      expect(wake.data?.screenshot, `wake: ${wake.response.status} ${JSON.stringify(wake.error)}`)
      return wake.data.message
    })
    if (values.task) {
      await check('phone task: read-only prompt answers without input', async () => {
        const response = await http(`/macs/${slug}/v1/leases/${lease}/task`, {
          method: 'POST',
          headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify({ prompt: 'Look at the screen and tell me in one sentence which app or screen is open. Do not tap, swipe, scroll or type.' }),
          signal: AbortSignal.timeout(120_000),
        })
        expect(response.status === 200, `task: ${response.status} ${await response.clone().text()}`)
        const chunks = (await response.text()).split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]').map((l) => JSON.parse(l.slice(6)))
        expect(chunks.at(-1)?.type === 'finish', `last chunk: ${JSON.stringify(chunks.at(-1))}`)
        const tools = chunks.filter((c) => c.type === 'tool-input-available').map((c) => c.toolName as string)
        const inputs = tools.filter((t) => !['screenshot', 'screentext', 'webfetch'].includes(t))
        expect(!inputs.length, `the task sent input: ${inputs.join(', ')}`)
        const answer = chunks.filter((c) => c.type === 'text-delta').map((c) => c.delta).join('')
        expect(answer.trim(), 'no answer')
        return `${tools.join(', ')}: ${answer.slice(0, 80)}`
      })
    }
  } finally {
    await check(`release ${lease}`, async () => {
      const released = await api.DELETE('/v1/leases/{lease}', { params: { path } })
      expect(released.data, `release: ${JSON.stringify(released.error)}`)
    })
  }
}

// ── main ─────────────────────────────────────────────────────────────────────────────────

console.log(`release check of ${BASE} for ghosthand ${VERSION}, seed ${SEED}\n`)
const tmp = mkdtempSync(join(tmpdir(), 'ghosthand-release-check-'))
let session: Awaited<ReturnType<typeof accountChecks>>
try {
  await publicChecks(tmp)
  session = await accountChecks(SEED)
  if (session && values.phone) await phoneChecks(session, SEED)
  else if (session) record('phone checks', 'skip', 'opt-in: --phone (and --task for one phone task)')
} finally {
  rmSync(tmp, { recursive: true, force: true })
  // Even after a crash: the temporary token must not outlive the run.
  if (session) {
    const { token, revoke } = session
    await check('revoked API token gets 401', async () => {
      if (process.env.GHOSTHAND_TOKEN) throw new Skip('token from the environment is kept')
      await revoke()
      const response = await http('/macs', { headers: { authorization: `Bearer ${token}` } })
      expect(response.status === 401, `GET /macs with the revoked token: ${response.status}`)
    })
  }
}

const count = (o: Outcome) => results.filter((r) => r.outcome === o).length
console.log(`\n${count('pass')} passed, ${count('fail')} failed, ${count('warn')} warnings, ${count('skip')} skipped. Replay the fuzz with --seed ${SEED}`)
process.exit(count('fail') ? 1 : 0)
