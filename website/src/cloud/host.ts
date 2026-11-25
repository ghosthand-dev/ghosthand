// Typed client of the fleet API that `vphone-cli fleet serve` answers on each host Mac. It is
// reached through the `HOSTS` Workers VPC binding: a private IP per host, routed by the host's
// Cloudflare Tunnel, no auth (nothing else can reach it). All host addressing lives here.
//
//   CloudFleet, api.ts ──HOSTS.fetch http://10.77.0.1:7400/v1/...──> cloudflared ──> fleet serve
//
//   GET  /v1/status                      host, slots, free disk, phones and their state
//   POST /v1/phones/{id}/start           202: download or clone to `version`, then launch
//   POST /v1/phones/{id}/stop            202: shut down, upload as `uploadVersion`
//   POST /v1/phones/{id}/sock            one vphone.sock JSON line, its reply
//   POST /v1/phones/{id}/push-url        download a URL to the host cache, then vphone.sock push

import { env } from 'cloudflare:workers'
import type { HostPhone } from './scheduler.ts'

const STATUS_TIMEOUT_MS = 5_000
const CONTROL_TIMEOUT_MS = 15_000
/** An input with settle waits up to ~3.5 s on the host; OCR and installs take longer. */
const SOCK_TIMEOUT_MS = 120_000

export type HostStatus = {
  host: string
  slots: number
  freeDiskBytes: number
  bundleVersion: string
  templates: string[]
  phones: HostPhone[]
}

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
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'HostError'
  }
}

/** `address`: `10.77.0.1:7400`. Tests bind HOSTS to a scripted fake host (test-runtime.ts). */
export function hostClient(address: string) {
  async function call<T>({ method, path, body, signal, timeoutMs }: { method: string; path: string; body?: object; signal: AbortSignal; timeoutMs: number }): Promise<T | HostError> {
    const request = new Request(`http://${address}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    })
    const response = await env.HOSTS.fetch(request).catch((cause) => new HostError(`host ${address} did not answer: ${messageOf(cause)}`, { cause }))
    if (response instanceof Error) return response
    const text = await response.text().catch((cause) => new HostError(`host ${address} dropped the answer: ${messageOf(cause)}`, { cause }))
    if (text instanceof Error) return text
    if (!response.ok) return new HostError(`host ${address} answered ${response.status} to ${method} ${path}: ${text.slice(0, 300)}`)
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
    stop: ({ phoneId, uploadVersion, signal }: { phoneId: string; uploadVersion: number; signal: AbortSignal }) =>
      call<void>({ method: 'POST', path: `/v1/phones/${phoneId}/stop`, body: { uploadVersion }, signal, timeoutMs: CONTROL_TIMEOUT_MS }),
    sock: ({ phoneId, line, signal }: { phoneId: string; line: SockLine; signal: AbortSignal }) =>
      call<SockReply>({ method: 'POST', path: `/v1/phones/${phoneId}/sock`, body: line, signal, timeoutMs: SOCK_TIMEOUT_MS }),
    pushUrl: ({ phoneId, url, sha256, path, signal }: { phoneId: string; url: string; sha256: string; path: string; signal: AbortSignal }) =>
      call<SockReply>({ method: 'POST', path: `/v1/phones/${phoneId}/push-url`, body: { url, sha256, path }, signal, timeoutMs: SOCK_TIMEOUT_MS }),
  }
}

export type HostClient = ReturnType<typeof hostClient>

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
