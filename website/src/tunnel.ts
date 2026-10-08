// `ghosthand daemon start --tunnel`: exposes a daemon at https://ghosthand.dev/tunnel/{id}.
// One Durable Object per tunnel id. The id is random (128 bits) and is the only
// credential: whoever knows the URL can use the iPhone. It is in the path, not a
// subdomain, so it never appears in DNS queries or TLS SNI.
//
//   remote CLI ── HTTPS /tunnel/{id}/v1/... ──▶ GhosthandTunnel ◀── WSS /tunnel/{id}/upstream ── daemon
//                ◀── streamed response ────────    (this file)     ── request / cancel ─────────▶
//                                                                   ◀── response, chunk, end ────
//
// HTTP over one WebSocket, JSON text frames, bodies in base64. The daemon replays each
// request on its local tunnel socket and streams the response back, so server-sent
// events work. Same design as Playwriter's remote-control tunnel, HTTP only.

import { DurableObject } from 'cloudflare:workers'

/** Daemon → DO. */
type UpstreamMessage =
  | { type: 'response'; id: string; status: number; headers: Record<string, string> }
  | { type: 'chunk'; id: string; data: string }
  | { type: 'end'; id: string }
  | { type: 'error'; id: string; message: string }

/** DO → daemon. */
type DownstreamMessage =
  | { type: 'accepted' }
  | { type: 'request'; id: string; method: string; path: string; headers: Record<string, string>; body: string | null }
  | { type: 'cancel'; id: string }

// Same rule as the daemon (Sources/ghosthand/tunnel.swift): at least 128 bits of hex.
const TUNNEL_PATH = /^\/tunnel\/([a-f0-9]{32,64})(\/.*)?$/
const UPSTREAM_WAIT_MS = 5_000
// Headers Cloudflare adds or that only make sense for one hop.
const DROPPED_HEADERS = /^(host|connection|upgrade|content-length|transfer-encoding|keep-alive|cf-.*|x-forwarded-.*|x-real-ip|cdn-loop)$/i

/** Handles /tunnel/* requests; null for every other path. */
export function routeTunnelRequest(request: Request, env: Env): Promise<Response> | null {
  const url = new URL(request.url)
  if (!url.pathname.startsWith('/tunnel/')) return null
  const match = url.pathname.match(TUNNEL_PATH)
  if (!match) return Promise.resolve(problem({ status: 404, code: 'not-found', title: 'Not found', detail: 'Not a ghosthand tunnel URL' }))
  const stub = env.GHOSTHAND_TUNNEL.get(env.GHOSTHAND_TUNNEL.idFromName(match[1]))
  return stub.fetch(request)
}

export class GhosthandTunnel extends DurableObject<Env> {
  private pending = new Map<string, {
    respond(response: Response): void
    body?: ReadableStreamDefaultController<Uint8Array>
  }>()
  private waitingForUpstream = new Set<() => void>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // The daemon pings every 30 s (the edge drops idle sockets after ~100 s). The edge
    // answers without waking the DO, so an idle tunnel costs nothing.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'))
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname.match(TUNNEL_PATH)?.[2] || '/'
    if (path === '/upstream' && request.headers.get('Upgrade') === 'websocket') return this.openUpstream()
    return this.forward(request, path)
  }

  /** The newest daemon connection wins: after a network drop or a daemon restart the
   *  old socket can look open for up to ~100 s. The id is the credential, so whoever
   *  connects with it owns the tunnel. */
  private openUpstream(): Response {
    for (const old of this.ctx.getWebSockets()) close({ socket: old, code: 4409, reason: 'Replaced by a newer daemon connection' })
    this.failAll('the daemon reconnected')
    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    send(server, { type: 'accepted' })
    this.waitingForUpstream.forEach((done) => done())
    return new Response(null, { status: 101, webSocket: client })
  }

  private async forward(request: Request, path: string): Promise<Response> {
    let upstream = this.upstream()
    if (!upstream) {
      // The daemon may be reconnecting, e.g. right after `ghosthand daemon restart`.
      await new Promise<void>((resolve) => {
        const done = () => { clearTimeout(timer); this.waitingForUpstream.delete(done); resolve() }
        const timer = setTimeout(done, UPSTREAM_WAIT_MS)
        this.waitingForUpstream.add(done)
      })
      upstream = this.upstream()
    }
    if (!upstream) {
      return problem({ status: 503, code: 'tunnel-offline', title: 'Tunnel offline', detail: 'The daemon behind this tunnel is not connected. On its Mac, run `ghosthand daemon status`; start it with `ghosthand daemon start --tunnel`.' })
    }

    const id = crypto.randomUUID()
    const url = new URL(request.url)
    const headers: Record<string, string> = {}
    request.headers.forEach((value, key) => { if (!DROPPED_HEADERS.test(key)) headers[key] = value })
    const body = request.body ? toBase64(new Uint8Array(await request.arrayBuffer())) : null
    // Abort events do not replay: the client may have left during the awaits above.
    if (request.signal.aborted) return new Response(null, { status: 499 })
    const response = new Promise<Response>((respond) => this.pending.set(id, { respond }))
    // The client went away (needs the enable_request_signal flag).
    request.signal.addEventListener('abort', () => this.cancel(id))
    if (!send(upstream, { type: 'request', id, method: request.method, path: path + url.search, headers, body })) {
      this.pending.delete(id)
      return problem({ status: 503, code: 'tunnel-offline', title: 'Tunnel offline', detail: 'Lost the connection to the daemon. Try again.' })
    }
    return response
  }

  webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== 'string') return
    const message = parse(raw)
    const pending = message && this.pending.get(message.id)
    if (!message || !pending) return
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
        else pending.respond(problem({ status: 502, code: 'internal-error', title: 'Tunnel error', detail: message.message }))
    }
  }

  webSocketClose(socket: WebSocket): void {
    if (!this.upstream()) this.failAll('the daemon disconnected')
  }

  webSocketError(socket: WebSocket): void {
    close({ socket, code: 1011, reason: 'WebSocket error' })
    if (!this.upstream()) this.failAll('the daemon disconnected')
  }

  /** Stops the request in the daemon too, which stops a running command. */
  private cancel(id: string): void {
    if (!this.pending.delete(id)) return
    const upstream = this.upstream()
    if (upstream) send(upstream, { type: 'cancel', id })
  }

  private upstream(): WebSocket | null {
    return this.ctx.getWebSockets().find((socket) => socket.readyState === WebSocket.OPEN) ?? null
  }

  private failAll(reason: string): void {
    for (const pending of this.pending.values()) {
      if (pending.body) pending.body.error(new Error(reason))
      else pending.respond(problem({ status: 503, code: 'tunnel-offline', title: 'Tunnel offline', detail: `Request lost: ${reason}. Try again.` }))
    }
    this.pending.clear()
  }
}

/** Same shape as the daemon's errors, so the CLI prints `detail`. */
function problem({ status, code, title, detail }: { status: number; code: string; title: string; detail: string }): Response {
  return Response.json({ code, title, status, detail }, { status, headers: { 'content-type': 'application/problem+json' } })
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
