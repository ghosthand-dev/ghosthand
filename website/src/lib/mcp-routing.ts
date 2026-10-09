// Pure MCP routing for the per-user hub (tunnel.ts): which Mac gets a JSON-RPC message,
// what to answer locally when none can, and how `list` replies from several Macs merge.
// No Cloudflare imports, so vitest runs it in Node.

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

export type McpRoute =
  /** Stream the daemon's answer through unchanged. */
  | { kind: 'forward'; slug: string }
  /** Ask every Mac, merge with mergeListReplies. */
  | { kind: 'fanout'; slugs: string[] }
  /** Answer here. `offline` marks errors that a reconnecting daemon could fix. */
  | { kind: 'reply'; status: number; body: object | null; offline?: boolean }

export const NO_MAC_MESSAGE =
  'No Mac is connected to this ghosthand account. Ghosthand controls an iPhone plugged into a Mac over USB. ' +
  'On that Mac, run `npx ghosthand setup` and ask the user to complete setup in the small Ghosthand window, using the same Google account as this MCP server. Agents must not interact with the window or complete setup for the user. ' +
  'Then, while the Mac is on with the iPhone plugged in, this MCP server can control the iPhone.'

const LEASE_PATTERN = /^([a-z0-9-]+):(.+)$/
const CACHED_METHODS = new Set(['initialize', 'tools/list', 'server/discover'])

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

/** Storage key for results that let a client connect while every Mac is offline. */
export function mcpCacheKey(message: JsonRpcMessage): string | null {
  if (!message.method || !CACHED_METHODS.has(message.method)) return null
  const params = message.params ?? {}
  const meta = params._meta as Record<string, unknown> | undefined
  const version = message.method === 'initialize' ? params.protocolVersion : meta?.['io.modelcontextprotocol/protocolVersion']
  return `cache:${message.method}:${typeof version === 'string' ? version : ''}`
}

export function routeMcpCall({ message, online, cached }: {
  message: JsonRpcMessage
  online: OnlineMac[]
  /** The stored result for mcpCacheKey(message), if any. */
  cached?: unknown
}): McpRoute {
  const newest = online[0]
  const isRequest = typeof message.method === 'string' && message.id !== undefined && message.id !== null
  // Notifications and client responses: any Mac may take them; nothing to answer.
  if (!isRequest) return newest ? { kind: 'forward', slug: newest.slug } : { kind: 'reply', status: 202, body: null }
  const id = message.id ?? null

  if (message.method === 'tools/call') {
    const params = message.params ?? {}
    const args = (params.arguments ?? {}) as Record<string, unknown>
    const leaseSlug = typeof args.lease === 'string' ? args.lease.match(LEASE_PATTERN)?.[1] : undefined
    const target = leaseSlug ?? (typeof args.mac === 'string' ? args.mac : undefined)
    if (target !== undefined) {
      if (online.some((mac) => mac.slug === target)) return { kind: 'forward', slug: target }
      const others = online.length ? `Online: ${describe(online)}` : NO_MAC_MESSAGE
      return reply(id, -32602, `Mac ${target} is offline. ${others}`, true)
    }
    if (params.name === 'list' && online.length > 1) return { kind: 'fanout', slugs: online.map((mac) => mac.slug) }
    if (online.length === 1) return { kind: 'forward', slug: online[0]!.slug }
    if (online.length === 0) return reply(id, -32603, NO_MAC_MESSAGE, true)
    return reply(id, -32602, `Several Macs are online: pass mac (one of: ${describe(online)})`)
  }

  if (newest) return { kind: 'forward', slug: newest.slug }
  if (message.method === 'ping') return { kind: 'reply', status: 200, body: { jsonrpc: '2.0', id, result: {} } }
  if (cached !== undefined) return { kind: 'reply', status: 200, body: { jsonrpc: '2.0', id, result: cached } }
  return reply(id, -32603, NO_MAC_MESSAGE, true)
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

function reply(id: JsonRpcId, code: number, message: string, offline = false): McpRoute {
  return { kind: 'reply', status: 200, body: rpcError(id, code, message), ...(offline ? { offline } : {}) }
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
