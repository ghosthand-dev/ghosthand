// Typed client of the fleet API that `vphone-cli fleet serve` answers on each host Mac. It is
// reached through the `HOSTS` Workers VPC binding: a private IP per host, routed by the host's
// Cloudflare Tunnel, no auth (nothing else can reach it). All host addressing lives here.
// Hosts hold no keys and never call out: the Worker sends catalog IPAs from R2 (storage.ts).
// A phone's VM lives only on its host's disk; nothing here moves it.
//
//   fleet.ts, api.ts ──HOSTS.fetch http://10.77.0.1:7400/v1/...──> cloudflared ──> fleet serve

import { env } from 'cloudflare:workers'
import createClient from 'openapi-fetch'
import type { components, paths } from '../generated/fleet-api.ts'

const STATUS_TIMEOUT_MS = 5_000
const CONTROL_TIMEOUT_MS = 15_000
/** An IPA can be hundreds of MiB. */
const BLOB_TIMEOUT_MS = 600_000
/** An input with settle waits up to ~3.5 s on the host; OCR and installs take longer. */
const SOCK_TIMEOUT_MS = 120_000
const MAX_ERROR_TEXT_LENGTH = 300

export type HostMachine = components['schemas']['HostMachine']
export type HostStatus = components['schemas']['HostStatus']
export type SockLine = components['schemas']['SockLine']
export type SockReply = components['schemas']['SockReply']

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export class HostError extends Error {
  /** The host's HTTP status; absent when it did not answer. 409: busy with another operation. */
  readonly status?: number
  constructor(message: string, options?: ErrorOptions & { status?: number }) {
    super(message, options)
    this.name = 'HostError'
    this.status = options?.status
  }
}

/** `address`: `10.77.0.1:7400`. Tests bind HOSTS to a scripted fake host (test-runtime.ts). */
export function hostClient(address: string) {
  const client = createClient<paths>({
    baseUrl: `http://${address}`,
    async fetch(request) {
      const { method } = request
      const path = new URL(request.url).pathname
      const response = await env.HOSTS.fetch(request).catch((cause) => {
        throw new HostError(`host ${address} did not answer ${method} ${path}: ${String(cause)}`, { cause })
      })
      if (response.ok) return response
      const text = await response.text().catch(() => '')
      throw new HostError(`host ${address} answered ${response.status} to ${method} ${path}: ${text.slice(0, MAX_ERROR_TEXT_LENGTH)}`, { status: response.status })
    },
  })

  const withTimeout = (signal: AbortSignal, timeoutMs: number) =>
    AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  async function result<T, R>(pending: Promise<T>, select: (value: T) => R): Promise<R | HostError> {
    try {
      return select(await pending)
    } catch (cause) {
      if (cause instanceof HostError) return cause
      return new HostError(`host ${address} did not return JSON: ${String(cause)}`, { cause })
    }
  }
  const read = <T>(pending: Promise<{ data?: T }>): Promise<T | HostError> =>
    result(pending, ({ data }) => data ?? new HostError(`host ${address} returned no JSON`))
  const discard = (pending: Promise<{ response: Response }>): Promise<void | HostError> =>
    result(pending, () => undefined)

  return {
    status: ({ signal }: { signal: AbortSignal }) =>
      read(client.GET('/v1/status', { signal: withTimeout(signal, STATUS_TIMEOUT_MS) })),
    /** `create`: the VM never ran, so the host clones `template` unless the phone is there. Without
     *  it the phone must exist; the host answers 409 instead of cloning a fresh one. */
    start: ({ phoneId, template, create, signal }: { phoneId: string; template: string; create: boolean; signal: AbortSignal }) =>
      discard(client.POST('/v1/phones/{id}/start', {
        params: { path: { id: phoneId } }, body: { template, create }, signal: withTimeout(signal, CONTROL_TIMEOUT_MS),
      })),
    stop: ({ phoneId, signal }: { phoneId: string; signal: AbortSignal }) =>
      discard(client.POST('/v1/phones/{id}/stop', {
        params: { path: { id: phoneId } }, signal: withTimeout(signal, CONTROL_TIMEOUT_MS),
      })),
    missing: async ({ hashes, signal }: { hashes: string[]; signal: AbortSignal }): Promise<string[] | HostError> => {
      const result = await read(client.POST('/v1/blobs/missing', { body: { hashes }, signal: withTimeout(signal, CONTROL_TIMEOUT_MS) }))
      return result instanceof Error ? result : result.missing
    },
    putBlob: ({ sha256, body, signal }: { sha256: string; body: ReadableStream; signal: AbortSignal }) =>
      discard(client.PUT('/v1/blobs/{sha256}', {
        params: { path: { sha256 } },
        headers: { 'content-type': 'application/octet-stream' },
        body,
        bodySerializer: (stream) => stream,
        signal: withTimeout(signal, BLOB_TIMEOUT_MS),
      })),
    sock: ({ phoneId, line, signal }: { phoneId: string; line: SockLine; signal: AbortSignal }) =>
      read(client.POST('/v1/phones/{id}/sock', {
        params: { path: { id: phoneId } }, body: line, signal: withTimeout(signal, SOCK_TIMEOUT_MS),
      })),
    push: ({ phoneId, sha256, path, signal }: { phoneId: string; sha256: string; path: string; signal: AbortSignal }) =>
      read(client.POST('/v1/phones/{id}/push', {
        params: { path: { id: phoneId } }, body: { sha256, path }, signal: withTimeout(signal, SOCK_TIMEOUT_MS),
      })),
  }
}

export type HostClient = ReturnType<typeof hostClient>
