// `ghosthand upload`: files the daemon puts in R2 so the iPhone can save them to Photos.
//
//   daemon ── POST /api/cli/upload?name=clip.mp4 (Bearer, raw body) ──▶ R2 object <id>      up to 100 MB
//   daemon ── POST /api/cli/upload/multipart?name=clip.mp4&size=N ──▶ {id, uploadId, partSize}  up to 2 GB
//          ── PUT  /api/cli/upload/multipart/<id>/<part>?uploadId= (raw body, partSize) ──▶ {partNumber, etag}
//          ── POST /api/cli/upload/multipart/<id>/complete {uploadId, parts} ──▶ same answer as /upload
//          ── DELETE /api/cli/upload/multipart/<id>?uploadId= ──▶ abort after a failed part
//   iPhone Safari ── GET /u/<id> ──▶ share page ── fetch /u/<id>/file ──▶ blob
//                    tap Save ──▶ navigator.share({ files }) ──▶ Save Video / Save Image
//
// Cloudflare refuses request bodies over 100 MB (Free and Pro plans), so bigger files go
// to R2 in parts, each its own request. The R2 uploadId is only returned to the creator.
// The share sheet of a File offers Save Video / Save Image in iOS Safari.
// navigator.share runs only from a tap, so the page has a button.
// The id (12 base62 chars, ~71 bits) is the only secret: the GET routes need no auth.
// The bucket lifecycle rule deletes objects after 1 day, but it runs late (up to a
// day), so the GET routes also check expiresAt and answer 404 on time.
import { env } from 'cloudflare:workers'
import { Spiceflow, json } from 'spiceflow'
import dedent from 'string-dedent'
import { z } from 'zod'
import { getBaseUrl } from './db.ts'
import { trackEvent } from './telemetry.ts'

export const UPLOAD_MAX_BYTES = 2_000_000_000
/** The Worker request body limit of the Free and Pro plans; Cloudflare answers 413 above it. */
const REQUEST_BODY_MAX_BYTES = 100_000_000
/** R2 needs every part but the last at the same size, at least 5 MiB. */
const PART_BYTES = 64 * 1024 * 1024
const MAX_PARTS = Math.ceil(UPLOAD_MAX_BYTES / PART_BYTES)
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const ID_LENGTH = 12

/** Crypto random base62; bytes >= 248 are dropped so every character is equally likely. */
function uploadId(): string {
  let id = ''
  while (id.length < ID_LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(ID_LENGTH * 2))) {
      if (byte < 248 && id.length < ID_LENGTH) id += ALPHABET[byte % 62]
    }
  }
  return id
}

const UPLOAD_ID = /^[0-9A-Za-z]{12}$/

export function parseUploadId(id: string): string {
  if (!UPLOAD_ID.test(id)) throw json({ message: 'invalid upload id' }, { status: 400 })
  return id
}

/** Content-Length of a raw request body; R2 needs it to stream the body. */
function bodySize(request: Request): number {
  const size = Number(request.headers.get('content-length'))
  if (!request.body || !Number.isSafeInteger(size) || size <= 0) {
    throw json({ message: 'Send the file as the request body, with Content-Length.' }, { status: 400 })
  }
  return size
}

function checkSize(size: number) {
  if (size > UPLOAD_MAX_BYTES) {
    throw json({ message: `The file is ${formatSize(size)}; uploads are at most ${formatSize(UPLOAD_MAX_BYTES)}. Use the USB way: https://ghosthand.dev/docs/send-media` }, { status: 413 })
  }
}

function newUpload({ request, name, userId }: { request: Request; name: string; userId: string }) {
  const id = uploadId()
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS).toISOString()
  const options = {
    httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
    customMetadata: { name, userId, expiresAt },
  }
  return { id, options }
}

function uploaded({ id, object, userId }: { id: string; object: R2Object; userId: string }) {
  const name = object.customMetadata?.name ?? id
  console.log('upload', { id, userId, name, size: object.size })
  trackEvent('upload_created', { size: object.size }, { userId })
  return { url: new URL(`/u/${id}`, getBaseUrl()).toString(), name, size: object.size, expiresAt: object.customMetadata?.expiresAt ?? '' }
}

/** One request: the body goes straight to R2. Cloudflare caps it at 100 MB. */
export async function createUpload({ request, name, userId }: { request: Request; name: string; userId: string }) {
  const size = bodySize(request)
  checkSize(size)
  if (size > REQUEST_BODY_MAX_BYTES) {
    throw json({ message: `The file is ${formatSize(size)}; one request carries at most ${formatSize(REQUEST_BODY_MAX_BYTES)}. Use /api/cli/upload/multipart.` }, { status: 413 })
  }
  const { id, options } = newUpload({ request, name, userId })
  const object = await env.UPLOADS.put(id, request.body, options)
  return uploaded({ id, object, userId })
}

/** Starts an upload in parts; `size` is checked here so a too big file fails before any part. */
export async function startMultipartUpload({ request, name, size, userId }: { request: Request; name: string; size: number; userId: string }) {
  checkSize(size)
  const { id, options } = newUpload({ request, name, userId })
  const upload = await env.UPLOADS.createMultipartUpload(id, options)
  return { id, uploadId: upload.uploadId, partSize: PART_BYTES }
}

/** R2 errors carry their code only in the message: 10024 is NoSuchUpload (completed, aborted or wrong id). */
async function onMultipart<T>({ id, uploadId }: { id: string; uploadId: string }, run: (upload: R2MultipartUpload) => Promise<T>): Promise<T> {
  try {
    return await run(env.UPLOADS.resumeMultipartUpload(id, uploadId))
  } catch (error) {
    if (error instanceof Error && error.message.includes('(10024)')) {
      throw json({ message: 'This upload does not exist, or it was completed or aborted. Start a new one.' }, { status: 404 })
    }
    throw error
  }
}

/** Part numbers stop at MAX_PARTS, so parts of one upload hold at most MAX_PARTS * PART_BYTES. */
export async function uploadPart({ request, id, uploadId, partNumber }: { request: Request; id: string; uploadId: string; partNumber: number }) {
  if (partNumber > MAX_PARTS) throw json({ message: `An upload has at most ${MAX_PARTS} parts.` }, { status: 413 })
  if (bodySize(request) > PART_BYTES) throw json({ message: `A part is at most ${PART_BYTES} bytes.` }, { status: 413 })
  return onMultipart({ id, uploadId }, (upload) => upload.uploadPart(partNumber, request.body!))
}

export async function completeMultipartUpload({ id, uploadId, parts, userId }: { id: string; uploadId: string; parts: R2UploadedPart[]; userId: string }) {
  const object = await onMultipart({ id, uploadId }, (upload) => upload.complete(parts))
  if (object.size > UPLOAD_MAX_BYTES) {
    await env.UPLOADS.delete(id)
    checkSize(object.size)
  }
  return uploaded({ id, object, userId })
}

export async function abortMultipartUpload({ id, uploadId }: { id: string; uploadId: string }) {
  await onMultipart({ id, uploadId }, (upload) => upload.abort())
}

function isLive<T extends R2Object>(object: T | null): object is T {
  return !!object && Date.parse(object.customMetadata?.expiresAt ?? '') > Date.now()
}

function formatSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`
  return `${Number((bytes / 1e9).toFixed(2))} GB`
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

/** JSON inside <script>: `<` escaped so a name cannot close the tag. */
function scriptJson(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

function notFound(): Response {
  return new Response('This link expired or does not exist. Uploads last 1 day.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

function sharePage(id: string, object: R2Object): string {
  const name = object.customMetadata?.name ?? id
  const type = object.httpMetadata?.contentType ?? 'application/octet-stream'
  const fileUrl = `/u/${id}/file`
  return dedent`
    <!doctype html>
    <html lang="en">
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="robots" content="noindex">
    <title>${escapeHtml(name)}</title>
    <style>
      body { font: 18px -apple-system, system-ui, sans-serif; margin: 0; padding: 32px 24px; text-align: center; }
      p { margin: 8px 0; word-break: break-all; }
      .size { color: #666; }
      button { font: 600 28px -apple-system, system-ui, sans-serif; width: 100%; max-width: 420px; margin: 32px 0 16px; padding: 22px; border: 0; border-radius: 16px; background: #0a84ff; color: #fff; }
      button:disabled { background: #999; }
      a { color: #0a84ff; }
      @media (prefers-color-scheme: dark) { body { background: #000; color: #fff; } .size { color: #999; } }
    </style>
    <p>${escapeHtml(name)}</p>
    <p class="size">${formatSize(object.size)}</p>
    <button id="save" disabled>Loading...</button>
    <p id="status"></p>
    <p><a href="${fileUrl}">Open the file</a></p>
    <script>
      const button = document.getElementById('save')
      const status = document.getElementById('status')
      let file
      fetch(${scriptJson(fileUrl)})
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob() })
        .then((blob) => {
          file = new File([blob], ${scriptJson(name)}, { type: ${scriptJson(type)} })
          button.textContent = 'Save'
          button.disabled = false
        })
        .catch((e) => { button.textContent = 'Failed'; status.textContent = String(e) })
      button.onclick = async () => {
        try { await navigator.share({ files: [file] }); status.textContent = 'Shared' }
        catch (e) { status.textContent = e.name === 'AbortError' ? '' : String(e) }
      }
    </script>
  `
}

/** RFC 9110 Content-Range of a ranged R2 read. */
function contentRange(range: { offset?: number; length?: number; suffix?: number }, size: number): string {
  // R2 can include unset keys, so choose suffix ranges by value.
  const { offset: start, length: count, suffix } = range
  const offset = suffix !== undefined ? size - suffix : (start ?? 0)
  const length = suffix !== undefined ? suffix : (count ?? size - offset)
  return `bytes ${offset}-${offset + length - 1}/${size}`
}

const idParams = z.object({ id: z.string().regex(UPLOAD_ID) })

export const uploadsApp = new Spiceflow()
  .route({
    method: 'GET',
    path: '/u/:id',
    detail: { hide: true },
    async handler({ params }) {
      const parsed = idParams.safeParse(params)
      if (!parsed.success) return notFound()
      const object = await env.UPLOADS.head(parsed.data.id)
      if (!isLive(object)) return notFound()
      return new Response(sharePage(parsed.data.id, object), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'referrer-policy': 'no-referrer' },
      })
    },
  })
  .route({
    method: 'GET',
    path: '/u/:id/file',
    detail: { hide: true },
    async handler({ params, request }) {
      const parsed = idParams.safeParse(params)
      if (!parsed.success) return notFound()
      // Download bytes only: uploaded HTML must never run on the account's origin.
      const object = await env.UPLOADS.get(parsed.data.id, { range: request.headers })
      if (!isLive(object)) return notFound()
      const headers = new Headers({
        'cache-control': 'private, no-store',
        'accept-ranges': 'bytes',
        etag: object.httpEtag,
        'content-type': 'application/octet-stream',
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff',
      })
      const name = object.customMetadata?.name ?? parsed.data.id
      headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
      const ranged = request.headers.has('range') && object.range
      if (ranged) headers.set('content-range', contentRange(object.range!, object.size))
      return new Response(object.body, { status: ranged ? 206 : 200, headers })
    },
  })
