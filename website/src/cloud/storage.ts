// Phone storage in R2 (bucket ghosthand-phones) and the VPhone templates phones start from.
// Hosts hold no keys and never call out: the Worker (fleet.ts) moves every byte between the PHONES
// binding and the host over the tunnel (host.ts). Bodies are piped, never read in JS.
//
// A version stores only what differs from its template: the 64 KiB blocks of Disk.img that changed
// and the small files, as LZ4 frames in packs of ~32 MiB the host writes on stop. A later version
// points into earlier packs for blocks that did not change; the host writes everything again when
// dead bytes pile up. The Worker never parses a pack and reads only the `packs` of a manifest.
//
//   save (after stop)  host uploads ──> each new pack: host GET ──stream──> PHONES.put; manifest
//                      last; delete what neither this version nor `previous` points into; saved
//   load (new host)    R2 manifest ──stream──> host restore ──> missing ranges ──> each:
//                      PHONES.get(range, up to 64 MiB) ──stream──> host PUT range; restore again
//   IPA install        sendBlob: blobs/missing [sha] ──> PHONES.get ──stream──> PUT blob (api.ts)
//
//   phones/<id>/<version>/manifest.json   written last: a missing manifest means no such version
//   phones/<id>/<version>/pack-<n>        LZ4 frames new in that version, never rewritten
//   apps/<id>/<version>.ipa               catalog IPAs (apps.ts)

import { env } from 'cloudflare:workers'
import { HostError, type HostClient, type PackRange } from './host.ts'

/** Copies at once: Workers allow 6 open connections per invocation. */
const COPY_CONCURRENCY = 4

export type Template = {
  model: string
  modelName: string
  iosVersion: string
  /** Screen size in points: the coordinates of input, OCR and screenshots. */
  screen: { width: number; height: number }
}

/** Every host has the same bytes of each template; a restore checks the template's digest. */
// TODO: templates exist only on host disks (copied by hand), and every saved version is a diff
// against one: upload each template to R2 with its digest, or a lost host disk loses them all.
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
/** `pack` is `<version>/pack-<n>`, as the host names it. */
const packKey = ({ phoneId, pack }: { phoneId: string; pack: string }) => `phones/${phoneId}/${pack}`

export class StorageError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'StorageError'
  }
}

/** Progress of one batch: `next` is where the next batch starts (saves only). */
export type Batch = { copied: number; done: boolean; next: number }

/** One batch of a save: copies up to `budget` packs of a stopped phone's local `version` from the
 *  host to R2, starting at the `next`-th. The last batch writes the manifest (a version exists only
 *  once it has one), deletes what neither `version` nor `previous` points into, and tells the host
 *  it is saved. `previous` (the saved version in Postgres) stays loadable until a later save. */
export async function saveBatch({ host, phoneId, version, previous, next, budget, signal }: {
  host: HostClient; phoneId: string; version: number; previous: number; next: number; budget: number; signal: AbortSignal
}): Promise<Batch | HostError | StorageError> {
  const plan = await host.uploads({ phoneId, version, signal })
  if (plan instanceof Error) return plan
  const todo = plan.uploads.slice(next, next + budget)
  const copied = await forEachLimited(todo, async ({ pack }) => {
    const response = await host.pack({ phoneId, pack, signal })
    if (response instanceof Error) return response
    return putObject({ key: packKey({ phoneId, pack }), body: response.body })
  })
  if (copied instanceof Error) return copied
  const reached = next + todo.length
  if (reached < plan.uploads.length) return { copied: todo.length, done: false, next: reached }
  const manifest = await host.manifest({ phoneId, version, signal })
  if (manifest instanceof Error) return manifest
  const written = await putObject({ key: phoneManifestKey({ phoneId, version }), body: manifest.body })
  if (written instanceof Error) return written
  const collected = await collectGarbage({ phoneId, keep: [{ version, packs: plan.packs }, previous] })
  if (collected instanceof Error) return collected
  const saved = await host.saved({ phoneId, version, signal })
  if (saved instanceof Error) return saved
  return { copied: todo.length, done: true, next: reached }
}

/** One batch of a load: asks the host to restore R2 `version`, sends up to `budget` pack ranges it
 *  answers missing, then asks again. Done once the host started the restore (or has the version). */
export async function loadBatch({ host, phoneId, version, budget, signal }: {
  host: HostClient; phoneId: string; version: number; budget: number; signal: AbortSignal
}): Promise<Batch | HostError | StorageError> {
  const restore = async () => {
    const key = phoneManifestKey({ phoneId, version })
    const object = await env.PHONES.get(key).catch((cause) => new StorageError(`R2 read of ${key} failed`, { cause }))
    if (object instanceof Error) return object
    if (!object) return new StorageError(`version ${version} of ${phoneId} is not in R2`)
    return host.restore({ phoneId, version, body: object.body, signal })
  }
  // The host's own answer is the progress: what an earlier batch sent is no longer missing.
  const first = await restore()
  if (first instanceof Error) return first
  if (!first.missing.length) return { copied: 0, done: true, next: 0 }
  const todo = first.missing.slice(0, budget)
  const sent = await forEachLimited(todo, (range) => sendRange({ host, phoneId, range, signal }))
  if (sent instanceof Error) return sent
  if (todo.length < first.missing.length) return { copied: todo.length, done: false, next: 0 }
  const second = await restore()
  if (second instanceof Error) return second
  return { copied: todo.length, done: !second.missing.length, next: 0 }
}

async function sendRange({ host, phoneId, range, signal }: { host: HostClient; phoneId: string; range: PackRange; signal: AbortSignal }): Promise<void | HostError | StorageError> {
  const key = packKey({ phoneId, pack: range.pack })
  const object = await env.PHONES.get(key, { range: { offset: range.offset, length: range.length } })
    .catch((cause) => new StorageError(`R2 read of ${key} failed`, { cause }))
  if (object instanceof Error) return object
  if (!object) return new StorageError(`${key} is not in R2`)
  return host.putRange({ phoneId, pack: range.pack, offset: range.offset, body: object.body, signal })
}

/** Deletes every object of the phone that no kept version points into. A version given as a
 *  number is read from R2; when its manifest is gone nothing is deleted. */
// TODO: a stalled save of v2 that resumes after v3 was saved deletes v3 (oracle review). Never delete
// objects of versions newer than `previous`, or serialize a phone's save and GC across isolates.
async function collectGarbage({ phoneId, keep }: { phoneId: string; keep: ({ version: number; packs: string[] } | number)[] }): Promise<void | StorageError> {
  const kept = new Set<string>()
  for (const entry of keep) {
    if (entry === 0) continue
    const version = typeof entry === 'number' ? entry : entry.version
    const key = phoneManifestKey({ phoneId, version })
    let packs = typeof entry === 'number' ? null : entry.packs
    if (!packs) {
      const object = await env.PHONES.get(key).catch((cause) => new StorageError(`R2 read of ${key} failed`, { cause }))
      if (object instanceof Error) return object
      if (!object) return
      const manifest = await object.json<{ packs: Record<string, number> }>().catch((cause) => new StorageError(`${key} is not JSON`, { cause }))
      if (manifest instanceof Error) return manifest
      packs = Object.keys(manifest.packs)
    }
    kept.add(key)
    for (const pack of packs) kept.add(packKey({ phoneId, pack }))
  }
  const prefix = `phones/${phoneId}/`
  const doomed: string[] = []
  let cursor: string | undefined
  do {
    const listed = await env.PHONES.list({ prefix, cursor }).catch((cause) => new StorageError(`R2 list of ${prefix} failed`, { cause }))
    if (listed instanceof Error) return listed
    for (const object of listed.objects) if (!kept.has(object.key)) doomed.push(object.key)
    cursor = listed.truncated ? listed.cursor : undefined
  } while (cursor)
  for (let i = 0; i < doomed.length; i += 1000) {
    const deleted = await env.PHONES.delete(doomed.slice(i, i + 1000)).catch((cause) => new StorageError(`R2 delete under ${prefix} failed`, { cause }))
    if (deleted instanceof Error) return deleted
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

/** Packs travel as the host wrote them; the host checks every frame's hash on restore. */
async function putObject({ key, body }: { key: string; body: ReadableStream | null }): Promise<void | StorageError> {
  if (body === null) return new StorageError(`no body to store as ${key}`)
  const done = await env.PHONES.put(key, body).catch((cause) => new StorageError(`R2 write of ${key} failed`, { cause }))
  if (done instanceof Error) return done
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
