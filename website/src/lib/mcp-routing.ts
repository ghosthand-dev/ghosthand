// Pure MCP routing for the per-user hub (tunnel.ts): which Mac gets a JSON-RPC message,
// what to answer locally when none can, and how `list` replies from several Macs merge.
// No Cloudflare imports, so vitest runs it in Node.
//
// With no Mac online the hub answers initialize, server/discover and tools/list itself from
// mcp-tools.json (generated from the daemon), so a new account can connect before any Mac is
// set up. Its instructions and every tool call then explain the next step for the user.

import manual from '../../mcp-tools.json'

export type JsonRpcId = string | number | null

/** One JSON-RPC message: a request, a notification or a response. No batches in MCP 2025-06+. */
export type JsonRpcMessage = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: Record<string, unknown>
  result?: unknown
  error?: { code?: number; message?: string }
}

/** An online Mac, newest connection first in every list. */
export type OnlineMac = { slug: string; name: string }
/** A Mac signed in to the account but not connected now. */
export type OfflineMac = { slug: string; name: string; lastSeenAt: number }

export type McpRoute =
  /** Stream the daemon's answer through unchanged. */
  | { kind: 'forward'; slug: string }
  /** Ask every Mac, merge with mergeListReplies. */
  | { kind: 'fanout'; slugs: string[] }
  /** Answer here. `offline` marks errors that a reconnecting daemon could fix. */
  | { kind: 'reply'; status: number; body: object | null; offline?: boolean }

export const DOWNLOAD_URL = 'https://ghosthand.dev/download'

// Same lists as MCPServer in daemon/Sources/ghosthand/mcp.swift.
const MODERN_VERSIONS = ['2026-07-28']
const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26']
const MODERN_VERSION_KEY = 'io.modelcontextprotocol/protocolVersion'
const TOOLS_TTL_MS = 300_000
const LEASE_PATTERN = /^([a-z0-9-]+):(.+)$/

/** What the bot must tell the user when no Mac of the account is online. */
export function noMacMessage({ offline, now }: { offline: OfflineMac[]; now: number }): string {
  if (!offline.length) {
    return [
      'No Mac is set up for this ghosthand account yet. Ghosthand controls an iPhone that is plugged into a Mac with a USB cable, so the user must install the Ghosthand app on a Mac first.',
      `Send the user the link ${DOWNLOAD_URL} and ask them to open it on their Mac, not on the phone.`,
      'The installer opens Ghosthand. In its window the user signs in with Google, with the same account they connected to this AI app, then plugs in the iPhone, taps Trust on it and pairs Bluetooth. The window shows each step.',
      'Do not ask the user to run commands in a terminal, and do not try to do the setup for them. When they say it is done, call `list` again.',
    ].join(' ')
  }
  const macs = offline.map((mac) => `${mac.name} (${mac.slug}, last seen ${ago(now - mac.lastSeenAt)})`).join(', ')
  return [
    `This ghosthand account has ${offline.length === 1 ? 'a Mac' : 'Macs'} but none is online: ${macs}.`,
    'Ghosthand needs that Mac awake, on the internet, with the iPhone plugged in. Ask the user to wake the Mac (or turn it on and log in) and open the Ghosthand app from Applications; it starts the background service and reconnects in a few seconds.',
    `To use a different Mac, they install Ghosthand on it from ${DOWNLOAD_URL} and sign in with the same Google account. Then call \`list\` again.`,
  ].join(' ')
}

export function parseJsonRpc(text: string): { ok: true; message: JsonRpcMessage } | { ok: false; status: number; body: object } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, status: 400, body: rpcError(null, -32700, 'Parse error: the body is not JSON') }
  }
  if (Array.isArray(value)) return { ok: false, status: 400, body: rpcError(null, -32600, 'Batches are not supported: send one JSON-RPC message per request') }
  if (!value || typeof value !== 'object') return { ok: false, status: 400, body: rpcError(null, -32600, 'Invalid request: expected a JSON-RPC object') }
  return { ok: true, message: value as JsonRpcMessage }
}

export function routeMcpCall({ message, online, offline, now }: {
  message: JsonRpcMessage
  online: OnlineMac[]
  /** Signed-in Macs that are not connected, for the onboarding text. */
  offline: OfflineMac[]
  now: number
}): McpRoute {
  const newest = online[0]
  const isRequest = typeof message.method === 'string' && message.id !== undefined && message.id !== null
  // Notifications and client responses: any Mac may take them; nothing to answer.
  if (!isRequest) return newest ? { kind: 'forward', slug: newest.slug } : { kind: 'reply', status: 202, body: null }
  const id = message.id ?? null
  const params = message.params ?? {}
  const meta = params._meta as Record<string, unknown> | undefined
  const modernVersion = meta?.[MODERN_VERSION_KEY]
  const modern = modernVersion !== undefined
  // Same checks as the daemon (MCPServer.handle), so a hub answer equals a Mac's.
  if (modern && !MODERN_VERSIONS.includes(String(modernVersion))) {
    const error = { code: -32022, message: 'Unsupported protocol version', data: { supported: [...MODERN_VERSIONS, ...LEGACY_VERSIONS], requested: modernVersion } }
    return { kind: 'reply', status: 200, body: { jsonrpc: '2.0', id, error } }
  }
  const capabilities = meta?.['io.modelcontextprotocol/clientCapabilities']
  if (modern && (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities))) {
    return { kind: 'reply', status: 200, body: rpcError(id, -32602, 'Invalid params: _meta needs io.modelcontextprotocol/clientCapabilities') }
  }
  // Tool errors are results, not JSON-RPC errors: only results reach the model.
  const toolError = (text: string, isOffline = false): McpRoute => ({
    kind: 'reply',
    status: 200,
    body: result({ id, modern, value: { content: [{ type: 'text', text }], isError: true } }),
    offline: isOffline,
  })

  if (message.method === 'tools/call') {
    const args = (params.arguments ?? {}) as Record<string, unknown>
    const leaseSlug = typeof args.lease === 'string' ? args.lease.match(LEASE_PATTERN)?.[1] : undefined
    const target = leaseSlug ?? (typeof args.mac === 'string' ? args.mac : undefined)
    if (target !== undefined) {
      if (online.some((mac) => mac.slug === target)) return { kind: 'forward', slug: target }
      if (!online.length) return toolError(noMacMessage({ offline, now }), true)
      return toolError(`Mac ${target} is offline. Online: ${describe(online)}`, true)
    }
    if (params.name === 'list' && online.length > 1) return { kind: 'fanout', slugs: online.map((mac) => mac.slug) }
    if (online.length === 1) return { kind: 'forward', slug: online[0]!.slug }
    if (online.length === 0) return toolError(noMacMessage({ offline, now }), true)
    return toolError(`Several Macs are online: pass mac (one of: ${describe(online)})`)
  }

  if (newest) return { kind: 'forward', slug: newest.slug }
  const ok = (value: object): McpRoute => ({ kind: 'reply', status: 200, body: result({ id, modern, value }), offline: true })
  const instructions = `${noMacMessage({ offline, now })}\n\n${manual.instructions}`
  switch (message.method) {
    case 'ping':
      return { kind: 'reply', status: 200, body: { jsonrpc: '2.0', id, result: {} } }
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '')
      return ok({
        protocolVersion: LEGACY_VERSIONS.includes(asked) ? asked : LEGACY_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: serverInfo(),
        instructions,
      })
    }
    case 'server/discover':
      return ok({ supportedVersions: MODERN_VERSIONS, capabilities: { tools: {} }, instructions })
    case 'tools/list':
      return ok(modern ? { tools: manual.tools, ttlMs: TOOLS_TTL_MS, cacheScope: 'private' } : { tools: manual.tools })
    default:
      return { kind: 'reply', status: 200, body: rpcError(id, -32601, `Method not found: ${message.method}`) }
  }
}

function serverInfo() {
  return { name: 'ghosthand', version: manual.version }
}

/** A JSON-RPC result; requests with the modern `_meta` version get its extra fields, like the daemon's. */
function result({ id, modern, value }: { id: JsonRpcId; modern: boolean; value: object }): object {
  if (!modern) return { jsonrpc: '2.0', id, result: value }
  return { jsonrpc: '2.0', id, result: { resultType: 'complete', ...value, _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo() } } }
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function ago(ms: number): string {
  if (ms < 2 * MINUTE_MS) return 'just now'
  if (ms < 2 * HOUR_MS) return `${Math.round(ms / MINUTE_MS)} minutes ago`
  if (ms < 2 * DAY_MS) return `${Math.round(ms / HOUR_MS)} hours ago`
  return `${Math.round(ms / DAY_MS)} days ago`
}

/** The JSON-RPC message of an SSE body: the last `data:` event. */
export function parseSseMessage(text: string): unknown {
  let last: string | null = null
  let data: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (line === '') {
      if (data.length) last = data.join('\n')
      data = []
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''))
    }
  }
  if (data.length) last = data.join('\n')
  if (last === null) throw new Error('no data event in the stream')
  return JSON.parse(last)
}

export type MacReply = { slug: string; message?: unknown; error?: string }

type ToolResult = { content?: unknown[]; isError?: boolean; [key: string]: unknown }

/** One `list` answer for every Mac: content blocks in Mac order, failures as text blocks. */
export function mergeListReplies(id: JsonRpcId, replies: MacReply[]): object {
  let first: ToolResult | null = null
  const content: unknown[] = []
  let failed = 0
  for (const { slug, message, error } of replies) {
    const rpc = message as { result?: ToolResult; error?: { message?: string } } | undefined
    const result = rpc?.result
    if (error || !result || rpc?.error || result.isError) {
      failed++
      const reason = error ?? rpc?.error?.message ?? textOf(result) ?? 'no result'
      content.push({ type: 'text', text: `mac ${slug}: error ${reason}` })
      continue
    }
    first ??= result
    content.push(...(result.content ?? []))
  }
  const result: ToolResult = { ...first, content }
  if (failed === replies.length) result.isError = true
  else delete result.isError
  return { jsonrpc: '2.0', id, result }
}

/** Lowercase ASCII slug of a Mac name, unique among `taken`: "Tommy's MacBook Pro" → "tommys-macbook-pro". */
export function macSlug(name: string, taken: Iterable<string>): string {
  const base = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'mac'
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`
}

export function rpcError(id: JsonRpcId, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function describe(online: OnlineMac[]): string {
  return online.length ? online.map((mac) => `${mac.slug} (${mac.name})`).join(', ') : 'none'
}

function textOf(result: ToolResult | undefined): string | undefined {
  const text = result?.content
    ?.flatMap((block) => (block && typeof block === 'object' && (block as { type?: string }).type === 'text' ? [(block as { text: string }).text] : []))
    .join(' ')
  return text || undefined
}
