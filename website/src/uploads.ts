// `ghosthand upload`: files the daemon puts in R2 so the iPhone can save them to Photos.
//
//   daemon ── POST /api/cli/upload?name=clip.mp4 (Bearer, raw body) ──▶ R2 object <id>
//   iPhone Safari ── GET /u/<id> ──▶ share page ── fetch /u/<id>/file ──▶ blob
//                    tap Save ──▶ navigator.share({ files }) ──▶ Save Video / Save Image
//
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

/** The Worker request body limit of the Free and Pro plans; Cloudflare answers 413 above it. */
export const UPLOAD_MAX_BYTES = 100_000_000
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

/** Streams the request body to R2. The daemon always sends Content-Length, which R2 needs. */
export async function createUpload({ request, name, userId }: { request: Request; name: string; userId: string }) {
  const size = Number(request.headers.get('content-length'))
  if (!request.body || !Number.isSafeInteger(size) || size <= 0) {
    throw json({ message: 'Send the file as the request body, with Content-Length.' }, { status: 400 })
  }
  if (size > UPLOAD_MAX_BYTES) {
    throw json({ message: `The file is ${formatSize(size)}; uploads are at most ${formatSize(UPLOAD_MAX_BYTES)}. Use the USB way: https://ghosthand.dev/docs/send-media` }, { status: 413 })
  }
  const id = uploadId()
  const expiresAt = new Date(Date.now() + UPLOAD_TTL_MS)
  await env.UPLOADS.put(id, request.body, {
    httpMetadata: { contentType: request.headers.get('content-type') || 'application/octet-stream' },
    customMetadata: { name, userId, expiresAt: expiresAt.toISOString() },
  })
  console.log('upload', { id, userId, name, size })
  return { url: new URL(`/u/${id}`, getBaseUrl()).toString(), name, size, expiresAt: expiresAt.toISOString() }
}

function isLive<T extends R2Object>(object: T | null): object is T {
  return !!object && Date.parse(object.customMetadata?.expiresAt ?? '') > Date.now()
}

function formatSize(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`
  return `${(bytes / 1e6).toFixed(1)} MB`
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

const idParams = z.object({ id: z.string().regex(/^[0-9A-Za-z]{12}$/) })

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
