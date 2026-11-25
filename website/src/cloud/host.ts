// Typed client of the fleet API that `vphone-cli fleet serve` answers on each host Mac. It is
// reached through the `HOSTS` Workers VPC binding: a private IP per host, routed by the host's
// Cloudflare Tunnel, no auth (nothing else can reach it). All host addressing lives here.
// Hosts hold no keys and never call out: the Worker moves every byte (storage.ts).
//
//   fleet.ts, api.ts ──HOSTS.fetch http://10.77.0.1:7400/v1/...──> cloudflared ──> fleet serve
//
//   GET  /v1/status                                host, slots, free disk, phones and their state
//   POST /v1/phones/{id}/start                     202: clone the template or a local version, launch
//   POST /v1/phones/{id}/stop                      202: shut down, write the packs of `version`
//   GET  /v1/phones/{id}/versions/{v}              that local version's manifest (Content-Length)
//   GET  /v1/phones/{id}/versions/{v}/uploads      packs R2 lacks, and every pack the version uses
//   GET  /v1/phones/{id}/packs/{v}/pack-{n}        one pack (Content-Length)
//   POST /v1/phones/{id}/versions/{v}/saved        R2 has it now: the local copy may be evicted
//   POST /v1/phones/{id}/versions/{v}/restore      body: the manifest. {missing} ranges, or it starts
//   PUT  /v1/phones/{id}/packs/{v}/pack-{n}/{off}  one range of a pack for a restore
//   POST /v1/blobs/missing                         which IPA hashes the host lacks
//   PUT  /v1/blobs/{sha256}                        store an IPA (host checks the hash)
//   POST /v1/phones/{id}/sock                      one vphone.sock JSON line, its reply
//   POST /v1/phones/{id}/push                      vphone.sock push of a blob into the guest

import { env } from 'cloudflare:workers'
import type { HostPhone } from './scheduler.ts'

const STATUS_TIMEOUT_MS = 5_000
const CONTROL_TIMEOUT_MS = 15_000
/** A ~32 MiB pack, or a restore range up to 64 MiB, over the tunnel. */
const TRANSFER_TIMEOUT_MS = 120_000
/** An IPA can be hundreds of MiB. */
const BLOB_TIMEOUT_MS = 600_000
/** An input with settle waits up to ~3.5 s on the host; OCR and installs take longer. */
const SOCK_TIMEOUT_MS = 120_000

/** The host Mac itself, Activity Monitor's numbers. Optional: older `fleet serve` builds do not
 *  report it, and a field whose kernel call failed is left out. */
export type HostMachine = {
  memoryBytes: number
  cores: number
  pressure: 'normal' | 'warning' | 'critical'
  usedBytes?: number
  compressedBytes?: number
  swapUsedBytes?: number
  load1?: number
  uptimeS?: number
}

export type HostStatus = {
  host: string
  /** ⌊(RAM − reserve) / VM memory⌋; the cron copies it to cloud_host.slots. */
  slots: number
  freeDiskBytes: number
  bundleVersion: string
  templates: string[]
  phones: HostPhone[]
  machine?: HostMachine
  /** Memory of each VM. */
  vmMemoryBytes?: number
  /** Memory kept for macOS. */
  reserveBytes?: number
}

/** A byte range of a pack a restore still needs. */
export type PackRange = { pack: string; offset: number; length: number }

/** What a save copies: the packs R2 lacks, and every pack the version points into. */
export type SavePlan = { uploads: { pack: string; size: number }[]; packs: string[] }

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** One vphone.sock JSON line: `t` is the command (`rpc`, `screenshot`, `tap`, ...). */
export type SockLine = { t: string; method?: string; params?: { [key: string]: Json }; screen?: boolean; settle?: boolean }

/** A vphone.sock reply. `image`: base64 JPEG of the screen, when the line asked for one. */
export type SockReply = {
  ok: boolean
  result?: Record<string, unknown>
  error?: string
  image?: string
}

export class HostError extends Error {
  /** The host's HTTP status; absent when it did not answer. 409: busy with another operation. */
  readonly status?: number
  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options)
    this.name = 'HostError'
    this.status = options?.status
  }
}

/** `address`: `10.77.0.1:7400`. Tests bind HOSTS to a scripted fake host (test-runtime.ts). */
export function hostClient(address: string) {
  type Send = { method: string; path: string; body?: object | ReadableStream; signal: AbortSignal; timeoutMs: number }
  /** The response with an OK status, its body unread: packs are piped, never read in JS. */
  async function send({ method, path, body, signal, timeoutMs }: Send): Promise<Response | HostError> {
    const stream = body instanceof ReadableStream
    const request = new Request(`http://${address}${path}`, {
      method,
      headers: body ? { 'content-type': stream ? 'application/octet-stream' : 'application/json' } : {},
      body: stream ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    const response = await env.HOSTS.fetch(request).catch((cause) => new HostError(`host ${address} did not answer ${method} ${path}: ${messageOf(cause)}`, { cause }))
    if (response instanceof Error || response.ok) return response
    const text = await response.text().catch(() => '')
    return new HostError(`host ${address} answered ${response.status} to ${method} ${path}: ${text.slice(0, 300)}`, { status: response.status })
  }

  async function call<T>(options: Send): Promise<T | HostError> {
    const response = await send(options)
    if (response instanceof Error) return response
    const { method, path } = options
    const text = await response.text().catch((cause) => new HostError(`host ${address} dropped the answer: ${messageOf(cause)}`, { cause }))
    if (text instanceof Error) return text
    if (!text) return undefined as T
    try {
      return JSON.parse(text) as T
    } catch (cause) {
      return new HostError(`host ${address} answered ${method} ${path} with no JSON`, { cause })
    }
  }

  return {
    status: ({ signal }: { signal: AbortSignal }) => call<HostStatus>({ method: 'GET', path: '/v1/status', signal, timeoutMs: STATUS_TIMEOUT_MS }),
    start: ({ phoneId, version, template, signal }: { phoneId: string; version: number; template: string; signal: AbortSignal }) =>
      call<void>({ method: 'POST', path: `/v1/phones/${phoneId}/start`, body: { version, template }, signal, timeoutMs: CONTROL_TIMEOUT_MS }),
    stop: ({ phoneId, version, signal }: { phoneId: string; version: number; signal: AbortSignal }) =>
      call<void>({ method: 'POST', path: `/v1/phones/${phoneId}/stop`, body: { version }, signal, timeoutMs: CONTROL_TIMEOUT_MS }),
    manifest: ({ phoneId, version, signal }: { phoneId: string; version: number; signal: AbortSignal }) =>
      send({ method: 'GET', path: `/v1/phones/${phoneId}/versions/${version}`, signal, timeoutMs: CONTROL_TIMEOUT_MS }),
    uploads: ({ phoneId, version, signal }: { phoneId: string; version: number; signal: AbortSignal }) =>
      call<SavePlan>({ method: 'GET', path: `/v1/phones/${phoneId}/versions/${version}/uploads`, signal, timeoutMs: CONTROL_TIMEOUT_MS }),
    pack: ({ phoneId, pack, signal }: { phoneId: string; pack: string; signal: AbortSignal }) =>
      send({ method: 'GET', path: `/v1/phones/${phoneId}/packs/${pack}`, signal, timeoutMs: TRANSFER_TIMEOUT_MS }),
    saved: ({ phoneId, version, signal }: { phoneId: string; version: number; signal: AbortSignal }) =>
      call<void>({ method: 'POST', path: `/v1/phones/${phoneId}/versions/${version}/saved`, signal, timeoutMs: CONTROL_TIMEOUT_MS }),
    missing: async ({ hashes, signal }: { hashes: string[]; signal: AbortSignal }): Promise<string[] | HostError> => {
      const result = await call<{ missing: string[] }>({ method: 'POST', path: '/v1/blobs/missing', body: { hashes }, signal, timeoutMs: CONTROL_TIMEOUT_MS })
      return result instanceof Error ? result : result.missing
    },
    putBlob: ({ sha256, body, signal }: { sha256: string; body: ReadableStream; signal: AbortSignal }) =>
      call<void>({ method: 'PUT', path: `/v1/blobs/${sha256}`, body, signal, timeoutMs: BLOB_TIMEOUT_MS }),
    /** `body`: the manifest as R2 holds it. Empty `missing`: the restore started, or the version is there. */
    restore: ({ phoneId, version, body, signal }: { phoneId: string; version: number; body: ReadableStream; signal: AbortSignal }) =>
      call<{ state: string; missing: PackRange[] }>({ method: 'POST', path: `/v1/phones/${phoneId}/versions/${version}/restore`, body, signal, timeoutMs: TRANSFER_TIMEOUT_MS }),
    putRange: ({ phoneId, pack, offset, body, signal }: { phoneId: string; pack: string; offset: number; body: ReadableStream; signal: AbortSignal }) =>
      call<void>({ method: 'PUT', path: `/v1/phones/${phoneId}/packs/${pack}/${offset}`, body, signal, timeoutMs: TRANSFER_TIMEOUT_MS }),
    sock: ({ phoneId, line, signal }: { phoneId: string; line: SockLine; signal: AbortSignal }) =>
      call<SockReply>({ method: 'POST', path: `/v1/phones/${phoneId}/sock`, body: line, signal, timeoutMs: SOCK_TIMEOUT_MS }),
    push: ({ phoneId, sha256, path, signal }: { phoneId: string; sha256: string; path: string; signal: AbortSignal }) =>
      call<SockReply>({ method: 'POST', path: `/v1/phones/${phoneId}/push`, body: { sha256, path }, signal, timeoutMs: SOCK_TIMEOUT_MS }),
  }
}

export type HostClient = ReturnType<typeof hostClient>

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
