// Phone storage in R2 (bucket ghosthand-phones) and the VPhone templates phones start from.
// Hosts hold no keys and never call out: CloudFleet moves every byte between the PHONES
// binding and the host over the tunnel (host.ts). Bodies are piped, never read in JS.
//
//   save (after stop)  host manifest ──> diff vs previous + template manifest ──> each new chunk:
//                      host GET chunk ──stream──> PHONES.put; small files; manifest last; saved
//   load (new host)    R2 manifest ──> host blobs/missing ──> each: PHONES.get ──stream──> host
//                      PUT blob ──> restore (CloudFleet then starts it)
//   IPA install        sendBlob: blobs/missing [sha] ──> PHONES.get ──stream──> PUT blob (api.ts)
//
//   templates/<key>/manifest.json       chunk list of the template Disk.img and its small files
//   chunks/<sha256>                      4 MiB chunk, LZ4 compressed
//   phones/<id>/<version>/manifest.json  written last: a missing manifest means no such version
//   phones/<id>/<version>/<small file>   config.plist, SEPStorage, nvram.bin, ...
//   apps/<id>/<version>.ipa              catalog IPAs (apps.ts)

import { env } from 'cloudflare:workers'
import { HostError, type HostClient } from './host.ts'

/** Uncompressed size of one Disk.img chunk. */
export const CHUNK_BYTES = 4 * 1024 * 1024
/** Copies at once: Workers allow 6 open connections per invocation. */
const COPY_CONCURRENCY = 4
const HOLE = '0'

/** `"0"`: a hole (all zeros) in the sparse disk image. */
export type PhoneManifest = {
  template: string
  /** Logical size of Disk.img in bytes. */
  size: number
  chunks: string[]
  files: Record<string, { sha256: string; size: number }>
}

export type Template = {
  model: string
  modelName: string
  iosVersion: string
  /** Screen size in points: the coordinates of input, OCR and screenshots. */
  screen: { width: number; height: number }
}

/** Every host has the same bytes of each template (downloaded from R2, never built locally). */
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

export const phoneManifestKey = ({ phoneId, version }: { phoneId: string; version: number }) => `phones/${phoneId}/${version}/manifest.json`
export const templateManifestKey = (template: string) => `templates/${template}/manifest.json`
const chunkKey = (sha256: string) => `chunks/${sha256}`
const fileKey = ({ phoneId, version, name }: { phoneId: string; version: number; name: string }) => `phones/${phoneId}/${version}/${name}`

/** Bytes of a phone version that are not zeros, from its manifest; null before its first upload. */
export async function phoneStoredBytes({ phoneId, version }: { phoneId: string; version: number }): Promise<number | null> {
  if (version === 0) return null
  const object = await env.PHONES.get(phoneManifestKey({ phoneId, version }))
  if (!object) return null
  const manifest = await object.json<PhoneManifest>()
  const files = Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0)
  return manifest.chunks.filter((chunk) => chunk !== '0').length * CHUNK_BYTES + files
}

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
  }
}

/** Progress of one batch: `next` is where the next batch starts (saves only). */
export type Batch = { copied: number; done: boolean; next: number }

/** One batch of a save: copies up to `budget` new chunks of a stopped phone's local `version`
 *  from the host to R2, starting at the `next`-th. The last batch copies the small files, writes
 *  the manifest (a version exists only once it has one) and tells the host it is saved. */
export async function saveBatch({ host, phoneId, template, version, previous, next, budget, signal }: {
  host: HostClient; phoneId: string; template: string; version: number; previous: number; next: number; budget: number; signal: AbortSignal
}): Promise<Batch | HostError | StorageError> {
  const manifest = await host.manifest({ phoneId, version, signal })
  if (manifest instanceof Error) return manifest
  const base = await readManifest(templateManifestKey(template))
  if (base instanceof Error) return base
  if (!base) return new StorageError(`template ${template} has no manifest in R2: upload ${templateManifestKey(template)} first`)
  const known = new Set(base.chunks)
  if (previous > 0) {
    const old = await readManifest(phoneManifestKey({ phoneId, version: previous }))
    if (old instanceof Error) return old
    for (const chunk of old?.chunks ?? []) known.add(chunk)
  }
  const fresh = [...new Set(manifest.chunks)].filter((chunk) => chunk !== HOLE && !known.has(chunk))
  const todo = fresh.slice(next, next + budget)
  const copied = await forEachLimited(todo, async (sha256) => {
    const response = await host.chunk({ phoneId, sha256, signal })
    if (response instanceof Error) return response
    return putObject({ key: chunkKey(sha256), body: response.body })
  })
  if (copied instanceof Error) return copied
  const reached = next + todo.length
  if (reached < fresh.length) return { copied: todo.length, done: false, next: reached }
  const files = await forEachLimited(Object.keys(manifest.files), async (name) => {
    const response = await host.file({ phoneId, name, signal })
    if (response instanceof Error) return response
    return putObject({ key: fileKey({ phoneId, version, name }), body: response.body })
  })
  if (files instanceof Error) return files
  const written = await putObject({ key: phoneManifestKey({ phoneId, version }), body: JSON.stringify(manifest) })
  if (written instanceof Error) return written
  const saved = await host.saved({ phoneId, version, signal })
  if (saved instanceof Error) return saved
  return { copied: todo.length, done: true, next: reached }
}

/** One batch of a load: sends up to `budget` blobs of R2 `version` the host lacks. The last
 *  batch (nothing missing) asks the host to restore the version, ready for its start. */
export async function loadBatch({ host, phoneId, version, budget, signal }: {
  host: HostClient; phoneId: string; version: number; budget: number; signal: AbortSignal
}): Promise<Batch | HostError | StorageError> {
  const manifest = await readManifest(phoneManifestKey({ phoneId, version }))
  if (manifest instanceof Error) return manifest
  if (!manifest) return new StorageError(`version ${version} of ${phoneId} is not in R2`)
  const keys = new Map<string, string>()
  for (const chunk of manifest.chunks) if (chunk !== HOLE) keys.set(chunk, chunkKey(chunk))
  for (const [name, file] of Object.entries(manifest.files)) keys.set(file.sha256, fileKey({ phoneId, version, name }))
  // The host's own answer is the progress: what an earlier batch sent is no longer missing.
  const missing = await host.missing({ hashes: [...keys.keys()], signal })
  if (missing instanceof Error) return missing
  const todo = missing.slice(0, budget)
  const sent = await forEachLimited(todo, (sha256) => sendObject({ host, key: keys.get(sha256) ?? chunkKey(sha256), sha256, signal }))
  if (sent instanceof Error) return sent
  if (todo.length < missing.length) return { copied: todo.length, done: false, next: 0 }
  const restored = await host.restore({ phoneId, version, manifest, signal })
  if (restored instanceof Error) return restored
  return { copied: todo.length, done: true, next: 0 }
}

/** Puts the R2 object `key` into the host's blob store as `sha256`, unless the host has it. */
export async function sendBlob({ host, key, sha256, signal }: { host: HostClient; key: string; sha256: string; signal: AbortSignal }): Promise<void | HostError | StorageError> {
  const missing = await host.missing({ hashes: [sha256], signal })
  if (missing instanceof Error) return missing
  if (!missing.includes(sha256)) return
  return sendObject({ host, key, sha256, signal })
}

async function sendObject({ host, key, sha256, signal }: { host: HostClient; key: string; sha256: string; signal: AbortSignal }): Promise<void | HostError | StorageError> {
  const object = await env.PHONES.get(key).catch((cause) => new StorageError(`R2 read of ${key} failed`, { cause }))
  if (object instanceof Error) return object
  if (!object) return new StorageError(`${key} is not in R2`)
  return host.putBlob({ sha256, body: object.body, signal })
}

/** Chunks travel LZ4 compressed, so R2 cannot check their hash; the host checks it on PUT blob. */
async function putObject({ key, body }: { key: string; body: ReadableStream | string | null }): Promise<void | StorageError> {
  if (body === null) return new StorageError(`no body to store as ${key}`)
  const done = await env.PHONES.put(key, body).catch((cause) => new StorageError(`R2 write of ${key} failed`, { cause }))
  if (done instanceof Error) return done
}

async function readManifest(key: string): Promise<PhoneManifest | null | StorageError> {
  const object = await env.PHONES.get(key).catch((cause) => new StorageError(`R2 read of ${key} failed`, { cause }))
  if (object === null || object instanceof Error) return object
  return object.json<PhoneManifest>().catch((cause) => new StorageError(`${key} is not JSON`, { cause }))
}

/** Runs `fn` over `items`, COPY_CONCURRENCY at a time; stops at the first error. */
async function forEachLimited<T>(items: T[], fn: (item: T) => Promise<void | Error>): Promise<void | Error> {
  let next = 0
  let failed: Error | undefined
  const worker = async () => {
    while (!failed && next < items.length) {
      const result = await fn(items[next++]!)
      if (result instanceof Error) failed ??= result
    }
  }
  await Promise.all(Array.from({ length: Math.min(COPY_CONCURRENCY, items.length) }, worker))
  return failed
}
