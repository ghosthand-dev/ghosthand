// Per-org hub: every signed-in Mac keeps a WebSocket here. Remote MCP (/mcp) and the HTTP
// API (/macs/<slug>/v1/...) reach the Macs through it. One Durable Object per org;
// today each user's Macs, MCP tokens and API tokens go to the user's personal org.
//
//   MCP client ── POST /mcp (opaque OAuth token) ───▶ Better Auth ──▶ GhosthandHub(org)  ◀── WSS /tunnel/upstream ── daemon (Mac A)
//   script ── /macs/<slug>/v1/... (Bearer ghk_...) ─▶ verify API token ─▶ (this file)        ◀── WSS /tunnel/upstream ── daemon (Mac B)
//   daemon (Mac A, for its CLI) ── /macs/<B>/v1/... (Bearer session) ──▶ same route
//              ◀── JSON or SSE stream ─────                                   │  request / cancel ──────────────────▶
//                                                                             │  ◀── response, chunk, end, error ────
//                                                                             ▼
//                                     routeMcpCall (lib/mcp-routing.ts): lease prefix, `mac`, `list` fan-out
//
// The API path is the daemon's own API (Sources/ghosthand/openapi.yaml) with the Mac in the
// URL, so lease ids stay `42` there; only MCP, which has no URL per Mac, prefixes them.
//
// The daemon authenticates with its better-auth session token; the Worker checks it and
// passes the session id and Mac name to the DO in headers it sets itself. HTTP goes over the
// WebSocket as JSON text frames, bodies in base64, so server-sent events stream through.
// The hub never runs MCP itself: each daemon serves the JSON-RPC on its own POST /mcp.

import { DurableObject, env } from 'cloudflare:workers'
import { createResourceServerChallenge } from '@better-auth/oauth-provider'
import { getAuth, getDb, getMcpResource, getPersonalOrg, getSessionStrict, parseDaemonUserAgent, verifyApiToken } from './db.ts'
import {
  macSlug,
  mcpCacheKey,
  mergeListReplies,
  parseJsonRpc,
  parseSseMessage,
  routeMcpCall,
  rpcError,
  type JsonRpcId,
  type JsonRpcMessage,
  type MacReply,
} from './lib/mcp-routing.ts'

/** Daemon → DO. */
type UpstreamMessage =
  | { type: 'response'; id: string; status: number; headers: Record<string, string> }
  | { type: 'chunk'; id: string; data: string }
  | { type: 'end'; id: string }
  | { type: 'error'; id: string; message: string }

/** DO → daemon. */
type DownstreamMessage =
  | { type: 'accepted'; mac: string }
  | { type: 'request'; id: string; method: string; path: string; headers: Record<string, string>; body: string | null }
  | { type: 'cancel'; id: string }

/** Registry entry, stored per better-auth session id. The slug never changes for a session. */
type MacEntry = { slug: string; name: string; lastSeenAt: number }
type Attachment = { sessionId: string; connectedAt: number; expiresAt: number }
export type HubMac = { sessionId: string; slug: string; name: string; online: boolean }

const UPSTREAM_PATH = '/tunnel/upstream'
const SESSION_HEADER = 'x-ghosthand-session-id'
const MAC_NAME_HEADER = 'x-ghosthand-mac-name'
// A daemon restart reconnects within seconds: calls wait for it instead of failing.
const RECONNECT_WAIT_MS = 5_000
const RECENTLY_ONLINE_MS = 60_000
// The hub buffers a request body and sends it down the WebSocket as base64.
const MAX_API_BODY = 20_000_000
// Hop-by-hop and Cloudflare headers, credentials, and our trusted headers.
const DROPPED_HEADERS = /^(host|connection|upgrade|content-length|transfer-encoding|keep-alive|authorization|cookie|cf-.*|x-forwarded-.*|x-real-ip|cdn-loop|x-ghosthand-.*)$/i

export function getHub(orgId: string) {
  return env.GHOSTHAND_HUB.get(env.GHOSTHAND_HUB.idFromName(orgId))
}

/** Handles /mcp, /macs, /tunnel/upstream and old /tunnel/* URLs; null for every other path. */
export function routeHubRequest(request: Request): Promise<Response> | null {
  const { pathname } = new URL(request.url)
  if (pathname === '/mcp') return handleMcpRequest(request)
  if (pathname === '/macs' || pathname.startsWith('/macs/')) return handleApiRequest(request)
  if (pathname === UPSTREAM_PATH) return connectUpstream(request)
  if (pathname.startsWith('/tunnel/')) {
    return Promise.resolve(problem({
      status: 410,
      code: 'gone',
      title: 'Tunnel URLs were removed',
      detail: 'Update ghosthand (`npx ghosthand@latest setup`). Agents now connect to the remote MCP at https://ghosthand.dev/mcp.',
    }))
  }
  return null
}

async function handleMcpRequest(request: Request): Promise<Response> {
  // Browsers send Origin; native MCP clients do not. No page may call this with a user's token.
  if (request.headers.has('origin')) return new Response(null, { status: 403 })
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  const claims = await getAuth().api.validateMcpAccess({ request, headers: request.headers, asResponse: false }).catch((error) => {
    const challenge = createResourceServerChallenge(error, getMcpResource())
    if (!challenge) throw error
    return Response.json(rpcError(null, -32000, challenge.message), { status: challenge.statusCode, headers: challenge.headers })
  })
  if (claims instanceof Response) return claims
  if (typeof claims.sub !== 'string' || !claims.sub) return new Response(null, { status: 401 })
  const org = await getPersonalOrg(claims.sub)
  return getHub(org.orgId).fetch(new Request(request, { headers: withoutTrustedHeaders(request.headers) }))
}

/** `GET /macs` and `/macs/<slug>/v1/...` for scripts (API token) and for the daemon of another
 *  Mac of the account (its session token), so its CLI reaches phones on every Mac. */
async function handleApiRequest(request: Request): Promise<Response> {
  // Same rule as /mcp: browsers must never call this with a user's token.
  if (request.headers.has('origin') || request.headers.has('sec-fetch-site')) {
    return problem({ status: 403, code: 'permission-denied', title: 'Permission denied', detail: 'Browser requests are not allowed; call the API from a script.' })
  }
  const userId = (await getSessionStrict(request))?.userId ?? (await verifyApiToken(request))
  if (!userId) {
    return problem({
      status: 401,
      code: 'unauthorized',
      title: 'Unauthorized',
      detail: 'Send `Authorization: Bearer <token>`: an API token (create one on a Mac with `ghosthand tunnel url --new-token`), or the session of a signed-in Mac.',
      headers: { 'www-authenticate': 'Bearer' },
    })
  }
  const org = await getPersonalOrg(userId)
  return getHub(org.orgId).fetch(new Request(request, { headers: withoutTrustedHeaders(request.headers) }))
}

async function connectUpstream(request: Request): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return problem({ status: 426, code: 'upgrade-required', title: 'Upgrade required', detail: 'Connect with a WebSocket.' })
  }
  // Errors (D1 down) throw and become 500: the daemon must not take an outage for a sign-out.
  const session = await getSessionStrict(request)
  if (!session) {
    return problem({ status: 401, code: 'unauthorized', title: 'Unauthorized', detail: 'This Mac is signed out. Sign in again with `ghosthand setup`.' })
  }
  const headers = withoutTrustedHeaders(request.headers)
  headers.set(SESSION_HEADER, session.sessionId)
  // Header values must be Latin-1; Mac names often have curly quotes.
  headers.set(MAC_NAME_HEADER, encodeURIComponent(parseDaemonUserAgent(request.headers.get('user-agent')).name))
  const org = await getPersonalOrg(session.userId)
  return getHub(org.orgId).fetch(new Request(request, { headers }))
}

function withoutTrustedHeaders(source: Headers): Headers {
  const headers = new Headers(source)
  for (const key of [...headers.keys()]) if (key.startsWith('x-ghosthand-')) headers.delete(key)
  return headers
}

type Pending = {
  sessionId: string
  /** The error answer in the caller's protocol: a JSON-RPC error for MCP, a Problem for the API. */
  fail(message: string): Response
  respond(response: Response): void
  body?: ReadableStreamDefaultController<Uint8Array>
}

export class GhosthandHub extends DurableObject<Env> {
  private pending = new Map<string, Pending>()
  private waitingForUpstream = new Set<() => void>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The daemon pings every 30 s (the edge drops idle sockets after ~100 s). The edge
    // answers without waking the DO, so idle Macs cost nothing.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
  }

  /** Only the Worker calls this, with the trusted headers it set (routeHubRequest). */
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    await this.refreshExpiredSessions()
    if (pathname === UPSTREAM_PATH) return this.openUpstream(request)
    if (pathname === '/macs' || pathname.startsWith('/macs/')) return this.handleApi(request)
    return this.handleMcp(request)
  }

  /** Every Mac this account connected, for the dashboard. */
  async macs(): Promise<HubMac[]> {
    await this.refreshExpiredSessions()
    const online = new Set(this.onlineMacs().map((mac) => mac.sessionId))
    return Object.entries(this.registry()).map(([sessionId, mac]) => ({ sessionId, slug: mac.slug, name: mac.name, online: online.has(sessionId) }))
  }

  /** Called after the session row is deleted: the daemon reconnects, gets 401 and stops. */
  async revoke(sessionId: string): Promise<void> {
    for (const socket of this.ctx.getWebSockets(sessionId)) close({ socket, code: 4401, reason: 'Mac signed out' })
    this.failSession(sessionId, 'the Mac was signed out')
    const registry = this.registry()
    delete registry[sessionId]
    this.ctx.storage.kv.put('macs', registry)
    await this.scheduleExpiry()
  }

  /** One socket per session; other Macs keep theirs. A newer connection of the same session
   *  wins: after a network drop the old socket can look open for up to ~100 s. */
  private async openUpstream(request: Request): Promise<Response> {
    const sessionId = request.headers.get(SESSION_HEADER)
    if (!sessionId) return problem({ status: 400, code: 'bad-request', title: 'Bad request', detail: 'Missing session' })
    const name = decodeURIComponent(request.headers.get(MAC_NAME_HEADER) ?? 'Mac')
    // Blocks revoke() until the socket is accepted, so a sign-out during the D1 query cannot be undone.
    return this.ctx.blockConcurrencyWhile(async () => {
      // Signed-out sessions free their slug; the connecting one must still be valid.
      const known = [...new Set([...Object.keys(this.registry()), sessionId])]
      const live = await getDb().query.session.findMany({ where: { id: { in: known }, expiresAt: { gt: new Date() } } })
      const liveIds = new Set(live.map((row) => row.id))
      const session = live.find((row) => row.id === sessionId)
      if (!session) return problem({ status: 401, code: 'unauthorized', title: 'Unauthorized', detail: 'This Mac was signed out' })
      const registry = Object.fromEntries(Object.entries(this.registry()).filter(([id]) => liveIds.has(id)))
      const slug = registry[sessionId]?.slug ?? macSlug(name, Object.values(registry).map((mac) => mac.slug))
      registry[sessionId] = { slug, name, lastSeenAt: Date.now() }
      this.ctx.storage.kv.put('macs', registry)
      for (const old of this.ctx.getWebSockets(sessionId)) close({ socket: old, code: 4409, reason: 'Replaced by a newer daemon connection' })
      this.failSession(sessionId, 'the daemon reconnected')
      const [client, server] = Object.values(new WebSocketPair())
      this.ctx.acceptWebSocket(server, [sessionId])
      server.serializeAttachment({ sessionId, connectedAt: Date.now(), expiresAt: session.expiresAt.getTime() } satisfies Attachment)
      await this.scheduleExpiry()
      send(server, { type: 'accepted', mac: slug })
      this.waitingForUpstream.forEach((done) => done())
      return new Response(null, { status: 101, webSocket: client })
    })
  }

  /** One alarm at the next session deadline, not a keepalive or periodic poll. */
  async alarm(): Promise<void> {
    await this.refreshExpiredSessions()
    await this.scheduleExpiry()
  }

  private async refreshExpiredSessions(): Promise<void> {
    const expired = this.ctx.getWebSockets().filter((socket) => {
      const info = attachment(socket)
      return socket.readyState === WebSocket.OPEN && info && !(info.expiresAt > Date.now())
    })
    if (!expired.length) return
    await this.ctx.blockConcurrencyWhile(async () => {
      const ids = [...new Set(expired.map((socket) => attachment(socket)!.sessionId))]
      const live = await getDb().query.session.findMany({ where: { id: { in: ids }, expiresAt: { gt: new Date() } } })
      for (const socket of expired) {
        const info = attachment(socket)!
        const session = live.find((row) => row.id === info.sessionId)
        if (!session) await this.revoke(info.sessionId)
        else socket.serializeAttachment({ ...info, expiresAt: session.expiresAt.getTime() } satisfies Attachment)
      }
      await this.scheduleExpiry()
    })
  }

  private async scheduleExpiry(): Promise<void> {
    const deadlines = this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN)
      .map((socket) => attachment(socket)!.expiresAt)
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines))
    else await this.ctx.storage.deleteAlarm()
  }

  private async handleMcp(request: Request): Promise<Response> {
    const text = await request.text()
    const parsed = parseJsonRpc(text)
    if (!parsed.ok) return Response.json(parsed.body, { status: parsed.status })
    const { message } = parsed

    let route = this.route(message)
    if (route.kind === 'reply' && route.offline && this.recentlyOnline()) {
      await this.waitForUpstream()
      route = this.route(message)
    }
    const rpcId = message.id ?? null
    switch (route.kind) {
      case 'reply':
        return route.body ? Response.json(route.body, { status: route.status }) : new Response(null, { status: route.status })
      case 'forward': {
        const response = await this.dispatch({ slug: route.slug, request, method: 'POST', path: '/mcp', body: text, fail: mcpFail(rpcId) })
        const cacheKey = mcpCacheKey(message)
        if (!cacheKey || !response.ok || !response.headers.get('content-type')?.includes('application/json')) return response
        // Small JSON: keep its result so clients can connect while every Mac is offline.
        const json = await response.text()
        const reply = parseJsonRpc(json)
        const result = reply.ok ? reply.message.result : undefined
        if (result !== undefined) this.ctx.storage.kv.put(cacheKey, result)
        return new Response(json, { status: response.status, headers: response.headers })
      }
      case 'fanout': {
        const replies = await Promise.all(route.slugs.map((slug) => this.collect({ slug, request, method: 'POST', path: '/mcp', body: text, fail: mcpFail(rpcId) })))
        return Response.json(mergeListReplies(rpcId, replies))
      }
    }
  }

  private route(message: JsonRpcMessage) {
    const online = this.onlineMacs()
    const cacheKey = online.length ? null : mcpCacheKey(message)
    return routeMcpCall({ message, online, cached: cacheKey ? this.ctx.storage.kv.get(cacheKey) : undefined })
  }

  /** `/macs` lists the Macs; `/macs/<slug>/v1/...` replays the request on that Mac's daemon. */
  private async handleApi(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/macs') {
      if (request.method !== 'GET') return problem({ status: 405, code: 'method-not-allowed', title: 'Method not allowed', detail: 'Use GET.', headers: { allow: 'GET' } })
      return Response.json({ macs: (await this.macs()).map(({ slug, name, online }) => ({ slug, name, online })) })
    }
    const match = url.pathname.match(/^\/macs\/([a-z0-9-]+)(\/v1\/.*)$/)
    if (!match) {
      return problem({ status: 404, code: 'not-found', title: 'Not found', detail: 'Use /macs/<mac>/v1/<route>, e.g. /macs/studio/v1/devices. `GET /macs` lists your Macs.' })
    }
    const [, slug, path] = match
    if (Number(request.headers.get('content-length')) > MAX_API_BODY) return tooLarge()
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
    const body = hasBody ? await readBounded(request, MAX_API_BODY) : null
    if (body === 'too-large') return tooLarge()

    if (!this.onlineMacs().some((mac) => mac.slug === slug) && this.recentlyOnline()) await this.waitForUpstream()
    if (!this.onlineMacs().some((mac) => mac.slug === slug)) {
      const online = this.onlineMacs().map((mac) => mac.slug)
      return problem({
        status: 503,
        code: 'mac-offline',
        title: 'Mac offline',
        detail: online.length ? `Mac ${slug} is offline. Online: ${online.join(', ')}.` : `Mac ${slug} is offline, and no other Mac of this account is online.`,
      })
    }
    return this.dispatch({ slug: slug!, request, method: request.method, path: path! + url.search, body, fail: apiFail })
  }

  /** Sends one request to a Mac; resolves with its streamed response. */
  private async dispatch({ slug, request, method, path, body, fail }: {
    slug: string
    request: Request
    method: string
    path: string
    body: string | Uint8Array | null
    fail: Pending['fail']
  }): Promise<Response> {
    await this.refreshExpiredSessions()
    const mac = this.onlineMacs().find((m) => m.slug === slug)
    if (!mac) return fail(`Mac ${slug} disconnected. Try again.`)
    if (request.signal.aborted) return new Response(null, { status: 499 })
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => { if (!DROPPED_HEADERS.test(key)) headers[key] = value })
    headers['ghosthand-mac'] = slug
    const id = crypto.randomUUID()
    const response = new Promise<Response>((respond) => this.pending.set(id, { sessionId: mac.sessionId, fail, respond }))
    // The client went away (needs the enable_request_signal flag): stop the call on the Mac too.
    request.signal.addEventListener('abort', () => this.cancel(id))
    const encoded = body === null ? null : toBase64(typeof body === 'string' ? new TextEncoder().encode(body) : body)
    if (!send(mac.socket, { type: 'request', id, method, path, headers, body: encoded })) {
      this.pending.delete(id)
      return fail(`Lost the connection to Mac ${slug}. Try again.`)
    }
    return response
  }

  /** A whole JSON-RPC reply from one Mac, for the `list` fan-out. */
  private async collect(options: Parameters<GhosthandHub['dispatch']>[0]): Promise<MacReply> {
    const { slug } = options
    try {
      const response = await this.dispatch(options)
      const text = await response.text()
      if (!response.ok) return { slug, error: `HTTP ${response.status} ${text.slice(0, 200)}` }
      const isStream = response.headers.get('content-type')?.includes('text/event-stream')
      return { slug, message: isStream ? parseSseMessage(text) : JSON.parse(text) }
    } catch (cause) {
      return { slug, error: cause instanceof Error ? cause.message : String(cause) }
    }
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    await this.refreshExpiredSessions()
    if (socket.readyState !== WebSocket.OPEN) return
    if (typeof raw !== 'string') return
    const message = parse(raw)
    const pending = message && this.pending.get(message.id)
    // A Mac can only answer its own requests.
    if (!message || !pending || pending.sessionId !== attachment(socket)?.sessionId) return
    switch (message.type) {
      case 'response': {
        const body = new ReadableStream<Uint8Array>({
          start: (controller) => { pending.body = controller },
          cancel: () => this.cancel(message.id),
        })
        const nullBody = [101, 204, 205, 304].includes(message.status)
        pending.respond(new Response(nullBody ? null : body, { status: message.status, headers: message.headers }))
        if (nullBody) this.pending.delete(message.id)
        return
      }
      case 'chunk':
        pending.body?.enqueue(Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0)))
        return
      case 'end':
        this.pending.delete(message.id)
        pending.body?.close()
        return
      case 'error':
        this.pending.delete(message.id)
        if (pending.body) pending.body.error(new Error(message.message))
        else pending.respond(pending.fail(message.message))
    }
  }

  webSocketError(socket: WebSocket): void {
    close({ socket, code: 1011, reason: 'WebSocket error' })
    this.webSocketClose(socket)
  }

  webSocketClose(socket: WebSocket): void {
    const sessionId = attachment(socket)?.sessionId
    if (!sessionId) return
    // A replacement socket of the same session keeps its requests.
    if (this.ctx.getWebSockets(sessionId).some((s) => s !== socket && s.readyState === WebSocket.OPEN)) return
    this.failSession(sessionId, 'the Mac disconnected')
    const registry = this.registry()
    const mac = registry[sessionId]
    if (!mac) return
    mac.lastSeenAt = Date.now()
    this.ctx.storage.kv.put('macs', registry)
  }

  /** Stops the request in the daemon too, which stops a running command. */
  private cancel(id: string): void {
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    // Settle it, so dispatch() and a fan-out reading the body never hang.
    try {
      if (pending.body) pending.body.error(new Error('request cancelled'))
      else pending.respond(new Response(null, { status: 499 }))
    } catch {}
    const mac = this.onlineMacs().find((m) => m.sessionId === pending.sessionId)
    if (mac) send(mac.socket, { type: 'cancel', id })
  }

  private failSession(sessionId: string, reason: string): void {
    for (const [id, pending] of this.pending) {
      if (pending.sessionId !== sessionId) continue
      this.pending.delete(id)
      if (pending.body) pending.body.error(new Error(reason))
      else pending.respond(pending.fail(`Request lost: ${reason}. Try again.`))
    }
  }

  private registry(): Record<string, MacEntry> {
    return this.ctx.storage.kv.get<Record<string, MacEntry>>('macs') ?? {}
  }

  /** Open sockets with their Mac, newest connection first. */
  private onlineMacs() {
    const registry = this.registry()
    return this.ctx.getWebSockets()
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .flatMap((socket) => {
        const info = attachment(socket)
        const mac = info && registry[info.sessionId]
        return info && mac && info.expiresAt > Date.now() ? [{ ...info, slug: mac.slug, name: mac.name, socket }] : []
      })
      .sort((a, b) => b.connectedAt - a.connectedAt)
  }

  /** A Mac dropped in the last minute: likely a daemon restart, worth waiting for. */
  private recentlyOnline(): boolean {
    const online = new Set(this.onlineMacs().map((mac) => mac.sessionId))
    return Object.entries(this.registry()).some(([id, mac]) => !online.has(id) && Date.now() - mac.lastSeenAt < RECENTLY_ONLINE_MS)
  }

  private waitForUpstream(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => { clearTimeout(timer); this.waitingForUpstream.delete(done); resolve() }
      const timer = setTimeout(done, RECONNECT_WAIT_MS)
      this.waitingForUpstream.add(done)
    })
  }
}

/** Same shape as the daemon's errors. */
function problem({ status, code, title, detail, headers }: { status: number; code: string; title: string; detail: string; headers?: Record<string, string> }): Response {
  return Response.json({ code, title, status, detail }, { status, headers: { 'content-type': 'application/problem+json', ...headers } })
}

const mcpFail = (rpcId: JsonRpcId): Pending['fail'] => (message) => Response.json(rpcError(rpcId, -32603, message))
const apiFail: Pending['fail'] = (message) => problem({ status: 502, code: 'tunnel-error', title: 'Tunnel error', detail: message })
const tooLarge = () => problem({
  status: 413,
  code: 'invalid-request',
  title: 'Request too large',
  detail: `Through the tunnel a request body is at most ${MAX_API_BODY / 1_000_000} MB. Use \`ghosthand upload\` for big files, or call the daemon on the Mac.`,
})

function attachment(socket: WebSocket): Attachment | null {
  return socket.deserializeAttachment() as Attachment | null
}

function parse(raw: string): UpstreamMessage | null {
  try {
    return JSON.parse(raw) as UpstreamMessage
  } catch {
    return null
  }
}

function send(socket: WebSocket, message: DownstreamMessage): boolean {
  try {
    socket.send(JSON.stringify(message))
    return true
  } catch {
    return false
  }
}

function close({ socket, code, reason }: { socket: WebSocket; code: number; reason: string }): void {
  try {
    socket.close(code, reason)
  } catch {}
}

/** Reads a body up to `limit` bytes, and stops at once above it: a chunked body has no Content-Length to check. */
async function readBounded(request: Request, limit: number): Promise<Uint8Array | 'too-large'> {
  const chunks: Uint8Array[] = []
  let size = 0
  if (request.body) {
    const reader = request.body.getReader()
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return 'too-large'
      }
      chunks.push(value)
    }
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
