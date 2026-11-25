// Phone storage in R2 (bucket ghosthand-phones) and the VPhone templates phones start from.
// Hosts upload and download the chunks themselves with their own R2 token (`vphone-cli fleet
// serve`); the Worker only reads manifests, e.g. a phone's size for the dashboard.
//
//   templates/<key>/manifest.json       chunk list of the template Disk.img and its small files
//   chunks/<sha256>                      4 MiB chunk, LZ4 compressed
//   phones/<id>/<version>/manifest.json  written last: a missing manifest means no such version
//   phones/<id>/<version>/<small file>   config.plist, SEPStorage, nvram.bin, ...
//   apps/<id>/<version>.ipa              catalog IPAs (apps.ts)

import { env } from 'cloudflare:workers'

/** Uncompressed size of one Disk.img chunk. */
export const CHUNK_BYTES = 4 * 1024 * 1024

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

/** Bytes of a phone version that are not zeros, from its manifest; null before its first upload. */
export async function phoneStoredBytes({ phoneId, version }: { phoneId: string; version: number }): Promise<number | null> {
  if (version === 0) return null
  const object = await env.PHONES.get(phoneManifestKey({ phoneId, version }))
  if (!object) return null
  const manifest = await object.json<PhoneManifest>()
  const files = Object.values(manifest.files).reduce((sum, file) => sum + file.size, 0)
  return manifest.chunks.filter((chunk) => chunk !== '0').length * CHUNK_BYTES + files
}

const SIGV4_ALGORITHM = 'AWS4-HMAC-SHA256'
const R2_REGION = 'auto'

/** A presigned S3 GET of a ghosthand-phones object (SigV4 query auth), e.g. a catalog IPA a
 *  host downloads. The R2 token is a Worker secret; hosts use their own token for chunks. */
export async function presignPhonesGet({ key, expiresS, now = new Date() }: { key: string; expiresS: number; now?: Date }): Promise<string> {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
  const path = `/${env.PHONES_BUCKET}/${key.split('/').map(rfc3986).join('/')}`
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '')
  const day = amzDate.slice(0, 8)
  const scope = `${day}/${R2_REGION}/s3/aws4_request`
  const query = [
    ['X-Amz-Algorithm', SIGV4_ALGORITHM],
    ['X-Amz-Credential', `${env.R2_PHONES_ACCESS_KEY_ID}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expiresS)],
    ['X-Amz-SignedHeaders', 'host'],
  ].map(([name, value]) => `${rfc3986(name!)}=${rfc3986(value!)}`).sort().join('&')
  const canonical = ['GET', path, query, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = [SIGV4_ALGORITHM, amzDate, scope, hex(await crypto.subtle.digest('SHA-256', utf8(canonical)))].join('\n')
  let signingKey: ArrayBuffer = utf8(`AWS4${env.R2_PHONES_SECRET_ACCESS_KEY}`).buffer
  for (const part of [day, R2_REGION, 's3', 'aws4_request']) signingKey = await hmac({ key: signingKey, data: part })
  return `https://${host}${path}?${query}&X-Amz-Signature=${hex(await hmac({ key: signingKey, data: toSign }))}`
}

async function hmac({ key, data }: { key: ArrayBuffer; data: string }): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, utf8(data))
}

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text)
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('')
}

function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}
