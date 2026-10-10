// Per-org hub: every signed-in Mac keeps a WebSocket here, and the remote MCP at
// https://ghosthand.dev/mcp reaches the Macs through it. One Durable Object per org;
// today each user's Macs and MCP tokens go to the user's personal org.
//
//   MCP client ── POST /mcp (OAuth JWT) ──▶ requireMcpAuth ──▶ GhosthandHub(org)  ◀── WSS /tunnel/upstream ── daemon (Mac A)
//              ◀── JSON or SSE stream ─────                    (this file)        ◀── WSS /tunnel/upstream ── daemon (Mac B)
//                                                                   │  request / cancel ──────────────────▶
//                                                                   │  ◀── response, chunk, end, error ────
//                                                                   ▼
//                                     routeMcpCall (lib/mcp-routing.ts): lease prefix, `mac`, `list` fan-out
//
// The daemon authenticates with its better-auth session token; the Worker checks it and
// passes the session id and Mac name to the DO in headers it sets itself. HTTP goes over the
// WebSocket as JSON text frames, bodies in base64, so server-sent events stream through.
// The hub never runs MCP itself: each daemon serves the JSON-RPC on its own POST /mcp.

import { DurableObject, env } from 'cloudflare:workers'
import { requireMcpAuth } from '@better-auth/mcp'
import { getAuth, getDb, getMcpResource, getPersonalOrg, getSessionStrict, parseDaemonUserAgent } from './db.ts'
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
type Attachment = { sessionId: string; connectedAt: number }
export type HubMac = { sessionId: string; slug: string; name: string; online: boolean }

const UPSTREAM_PATH = '/tunnel/upstream'
const SESSION_HEADER = 'x-ghosthand-session-id'
const MAC_NAME_HEADER = 'x-ghosthand-mac-name'
// A daemon restart reconnects within seconds: calls wait for it instead of failing.
const RECONNECT_WAIT_MS = 5_000
const RECENTLY_ONLINE_MS = 60_000
// Hop-by-hop and Cloudflare headers, credentials, and our trusted headers.
const DROPPED_HEADERS = /^(host|connection|upgrade|content-length|transfer-encoding|keep-alive|authorization|cookie|cf-.*|x-forwarded-.*|x-real-ip|cdn-loop|x-ghosthand-.*)$/i

export function getHub(orgId: string) {
  return env.GHOSTHAND_HUB.get(env.GHOSTHAND_HUB.idFromName(orgId))
}

/** Handles /mcp, /tunnel/upstream and old /tunnel/* URLs; null for every other path. */
export function routeHubRequest(request: Request): Promise<Response> | null {
  const { pathname } = new URL(request.url)
  if (pathname === '/mcp') return handleMcpRequest(request)
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
  return requireMcpAuth(
    getAuth(),
    async (authenticated, claims) => {
      if (typeof claims.sub !== 'string' || !claims.sub) return new Response(null, { status: 401 })
      const org = await getPersonalOrg(claims.sub)
      return getHub(org.orgId).fetch(new Request(authenticated, { headers: withoutTrustedHeaders(authenticated.headers) }))
    },
    { resource: getMcpResource() },
  )(request)
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
  rpcId: JsonRpcId
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
    if (new URL(request.url).pathname === UPSTREAM_PATH) return this.openUpstream(request)
    return this.handleMcp(request)
  }

  /** Every Mac this account connected, for the dashboard. */
  macs(): HubMac[] {
    const online = new Set(this.onlineMacs().map((mac) => mac.sessionId))
    return Object.entries(this.registry()).map(([sessionId, mac]) => ({ sessionId, slug: mac.slug, name: mac.name, online: online.has(sessionId) }))
  }

  /** Called after the session row is deleted: the daemon reconnects, gets 401 and stops. */
  revoke(sessionId: string): void {
    for (const socket of this.ctx.getWebSockets(sessionId)) close({ socket, code: 4401, reason: 'Mac signed out' })
    this.failSession(sessionId, 'the Mac was signed out')
    const registry = this.registry()
    delete registry[sessionId]
    this.ctx.storage.kv.put('macs', registry)
  }

  /** One socket per session; other Macs keep theirs. A newer connection of the same session
   *  wins: after a network drop the old socket can look open for up to ~100 s. */
  private async openUpstream(request: Request): Promise<Response> {
    const sessionId = request.headers.get(SESSION_HEADER)
    if (!sessionId) return problem({ status: 400, code: 'bad-request', title: 'Bad request', detail: 'Missing session' })
    const name = decodeURIComponent(request.headers.get(MAC_NAME_HEADER) ?? 'Mac')
    // Blocks revoke() until the socket is accepted, so a sign-out during the D1 query cannot be undone.
    const slug = await this.ctx.blockConcurrencyWhile(async () => {
      // Signed-out sessions free their slug; the connecting one must still be valid.
      const known = [...new Set([...Object.keys(this.registry()), sessionId])]
      const live = await getDb().query.session.findMany({ where: { id: { in: known }, expiresAt: { gt: new Date() } } })
      const liveIds = new Set(live.map((row) => row.id))
      if (!liveIds.has(sessionId)) return null
      const registry = Object.fromEntries(Object.entries(this.registry()).filter(([id]) => liveIds.has(id)))
      const slug = registry[sessionId]?.slug ?? macSlug(name, Object.values(registry).map((mac) => mac.slug))
      registry[sessionId] = { slug, name, lastSeenAt: Date.now() }
      this.ctx.storage.kv.put('macs', registry)
      return slug
    })
    if (!slug) return problem({ status: 401, code: 'unauthorized', title: 'Unauthorized', detail: 'This Mac was signed out' })

    for (const old of this.ctx.getWebSockets(sessionId)) close({ socket: old, code: 4409, reason: 'Replaced by a newer daemon connection' })
    this.failSession(sessionId, 'the daemon reconnected')
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server, [sessionId])
    server.serializeAttachment({ sessionId, connectedAt: Date.now() } satisfies Attachment)
    send(server, { type: 'accepted', mac: slug })
    this.waitingForUpstream.forEach((done) => done())
    return new Response(null, { status: 101, webSocket: client })
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
        const response = await this.dispatch({ slug: route.slug, request, body: text, rpcId })
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
        const replies = await Promise.all(route.slugs.map((slug) => this.collect({ slug, request, body: text, rpcId })))
        return Response.json(mergeListReplies(rpcId, replies))
      }
    }
  }

  private route(message: JsonRpcMessage) {
    const online = this.onlineMacs()
    const cacheKey = online.length ? null : mcpCacheKey(message)
    return routeMcpCall({ message, online, cached: cacheKey ? this.ctx.storage.kv.get(cacheKey) : undefined })
  }

  /** Sends one request to a Mac; resolves with its streamed response. */
  private async dispatch({ slug, request, body, rpcId }: { slug: string; request: Request; body: string; rpcId: JsonRpcId }): Promise<Response> {
    const mac = this.onlineMacs().find((m) => m.slug === slug)
    if (!mac) return Response.json(rpcError(rpcId, -32603, `Mac ${slug} disconnected. Try again.`))
    if (request.signal.aborted) return new Response(null, { status: 499 })
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => { if (!DROPPED_HEADERS.test(key)) headers[key] = value })
    headers['ghosthand-mac'] = slug
    const id = crypto.randomUUID()
    const response = new Promise<Response>((respond) => this.pending.set(id, { sessionId: mac.sessionId, rpcId, respond }))
    // The client went away (needs the enable_request_signal flag): stop the call on the Mac too.
    request.signal.addEventListener('abort', () => this.cancel(id))
    if (!send(mac.socket, { type: 'request', id, method: 'POST', path: '/mcp', headers, body: toBase64(new TextEncoder().encode(body)) })) {
      this.pending.delete(id)
      return Response.json(rpcError(rpcId, -32603, `Lost the connection to Mac ${slug}. Try again.`))
    }
    return response
  }

  /** A whole JSON-RPC reply from one Mac, for the `list` fan-out. */
  private async collect(options: { slug: string; request: Request; body: string; rpcId: JsonRpcId }): Promise<MacReply> {
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

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
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
        else pending.respond(Response.json(rpcError(pending.rpcId, -32603, message.message)))
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
      else pending.respond(Response.json(rpcError(pending.rpcId, -32603, `Request lost: ${reason}. Try again.`)))
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
        return info && mac ? [{ ...info, slug: mac.slug, name: mac.name, socket }] : []
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
function problem({ status, code, title, detail }: { status: number; code: string; title: string; detail: string }): Response {
  return Response.json({ code, title, status, detail }, { status, headers: { 'content-type': 'application/problem+json' } })
}

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

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
