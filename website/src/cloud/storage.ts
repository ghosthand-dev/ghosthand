// The VPhone templates phones are cloned from, and catalog IPAs sent from R2 (bucket
// ghosthand-phones, `PHONES` binding) to a host. Phone disks never go to R2: each phone lives on
// its host's disk only (docs/cloud-phones.md). Hosts hold no keys and never call out, so the
// Worker pipes the bytes, never reading them in JS.
//
//   IPA install  sendBlob: blobs/missing [sha] ──> PHONES.get ──stream──> PUT blob (api.ts)
//
//   apps/<id>/<version>.ipa   catalog IPAs (apps.ts), uploaded by hand

import { env } from 'cloudflare:workers'
import type { HostClient, HostError } from './host.ts'

export type Template = {
  model: string
  modelName: string
  iosVersion: string
  /** Screen size in points: the coordinates of input, OCR and screenshots. */
  screen: { width: number; height: number }
}

/** Every host has the same bytes of each template, copied in by the operator (docs/cloud-hosts.md). */
export const TEMPLATES: Record<string, Template> = {
  // iPhone 16 userland, iOS 27.0.1 (24A446). docs/research-notes/vphone-ipa-trial/vm-density-resume.md
  '13e3716a2e12': { model: 'iPhone17,3', modelName: 'iPhone 16', iosVersion: '27.0.1', screen: { width: 393, height: 852 } },
}

/** The template new phones are cloned from. */
export const DEFAULT_TEMPLATE = '13e3716a2e12'

export function templateInfo(key: string): Template {
  const template = TEMPLATES[key]
  if (!template) throw new Error(`unknown VPhone template ${key}: add it to TEMPLATES in src/cloud/storage.ts`)
  return template
}

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
  }
}

/** Puts the R2 object `key` into the host's blob store as `sha256`, unless the host has it. */
export async function sendBlob({ host, key, sha256, signal }: { host: HostClient; key: string; sha256: string; signal: AbortSignal }): Promise<void | HostError | StorageError> {
  const missing = await host.missing({ hashes: [sha256], signal })
  if (missing instanceof Error) return missing
  if (!missing.includes(sha256)) return
  const object = await env.PHONES.get(key).catch((cause) => new StorageError(`R2 read of ${key} failed`, { cause }))
  if (object instanceof Error) return object
  if (!object) return new StorageError(`${key} is not in R2`)
  return host.putBlob({ sha256, body: object.body, signal })
}
