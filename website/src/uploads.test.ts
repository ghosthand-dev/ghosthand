import dedent from 'string-dedent'
import { expect, test } from 'vitest'
import { z } from 'zod'
import { startTestRuntime } from './test-runtime.ts'

const TEST_TIMEOUT_MS = 30_000

test('uploaded HTML stays inert without breaking sharing or ranges', async () => {
  const runtime = await startTestRuntime()
  const { worker } = runtime
  try {
    const body = dedent`
      <script>fetch('/api/auth/api-key/create')</script>
    `
    const signal = AbortSignal.timeout(TEST_TIMEOUT_MS)
    const identity = await worker.fetch('/__test/session', { signal })
    const { session } = z.object({ session: z.object({ token: z.string() }) }).parse(await identity.json())
    const uploaded = await worker.fetch('/api/cli/upload?name=attack.html', {
      method: 'POST',
      headers: { authorization: `Bearer ${session.token}`, 'content-type': 'text/html' },
      body,
      signal,
    })
    expect(uploaded.status).toBe(200)
    const upload = z.object({ url: z.string() }).parse(await uploaded.json())
    const fileUrl = `${upload.url}/file`
    const file = await worker.fetch(fileUrl, { signal })
    expect({
      status: file.status,
      type: file.headers.get('content-type'),
      disposition: file.headers.get('content-disposition'),
      policy: file.headers.get('content-security-policy'),
      sniffing: file.headers.get('x-content-type-options'),
      body: await file.text(),
    }).toMatchInlineSnapshot(`
      {
        "body": "<script>fetch('/api/auth/api-key/create')</script>",
        "disposition": "attachment; filename*=UTF-8''attack.html",
        "policy": "sandbox; default-src 'none'",
        "sniffing": "nosniff",
        "status": 200,
        "type": "application/octet-stream",
      }
    `)
    const share = await worker.fetch(upload.url, { signal })
    expect(share.status).toBe(200)
    expect(await share.text()).toContain('"text/html"')
    const range = await worker.fetch(fileUrl, { headers: { range: 'bytes=0-7' }, signal })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-type')).toBe('application/octet-stream')
    expect(range.headers.get('content-disposition')).toBe(file.headers.get('content-disposition'))
    expect(range.headers.get('content-range')).toBe(`bytes 0-7/${body.length}`)
    expect(await range.text()).toBe(body.slice(0, 8))
  } finally {
    await runtime.close()
  }
}, TEST_TIMEOUT_MS)

test('multipart upload: size checks, parts, complete, abort', async () => {
  const runtime = await startTestRuntime()
  const { worker } = runtime
  try {
    const signal = AbortSignal.timeout(TEST_TIMEOUT_MS)
    const identity = await worker.fetch('/__test/session', { signal })
    const { session } = z.object({ session: z.object({ token: z.string() }) }).parse(await identity.json())
    const auth = { authorization: `Bearer ${session.token}` }
    const call = async (path: string, init: { method: string; headers?: Record<string, string>; body?: string }) => {
      const response = await worker.fetch(path, { ...init, headers: { ...auth, ...init.headers }, signal })
      return { status: response.status, body: z.looseObject({}).parse(await response.json()) }
    }
    const started = z.object({ id: z.string(), uploadId: z.string(), partSize: z.number() })

    expect(await call('/api/cli/upload/multipart?name=big.mp4&size=3000000000', { method: 'POST' })).toMatchInlineSnapshot(`
      {
        "body": {
          "message": "The file is 3 GB; uploads are at most 2 GB. Use the USB way: https://ghosthand.dev/docs/send-media",
        },
        "status": 413,
      }
    `)

    const start = started.parse((await call('/api/cli/upload/multipart?name=clip.mp4&size=5', { method: 'POST', headers: { 'content-type': 'video/mp4' } })).body)
    const tooMany = await call(`/api/cli/upload/multipart/${start.id}/31?uploadId=${start.uploadId}`, { method: 'PUT', body: 'x' })
    const part = await call(`/api/cli/upload/multipart/${start.id}/1?uploadId=${start.uploadId}`, { method: 'PUT', body: 'hello' })
    const completed = await call(`/api/cli/upload/multipart/${start.id}/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uploadId: start.uploadId, parts: [part.body] }),
    })
    const upload = z.object({ url: z.string(), expiresAt: z.string() }).parse(completed.body)
    const file = await worker.fetch(`${upload.url}/file`, { signal })
    expect({
      partSize: start.partSize,
      tooMany,
      part: part.status,
      completed: { ...completed.body, url: new URL(upload.url).pathname.replace(start.id, '<id>'), expiresAt: Date.parse(upload.expiresAt) > Date.now() },
      file: { status: file.status, disposition: file.headers.get('content-disposition'), body: await file.text() },
    }).toMatchInlineSnapshot(`
      {
        "completed": {
          "expiresAt": true,
          "name": "clip.mp4",
          "size": 5,
          "url": "/u/<id>",
        },
        "file": {
          "body": "hello",
          "disposition": "attachment; filename*=UTF-8''clip.mp4",
          "status": 200,
        },
        "part": 200,
        "partSize": 67108864,
        "tooMany": {
          "body": {
            "message": "An upload has at most 30 parts.",
          },
          "status": 413,
        },
      }
    `)

    const aborted = started.parse((await call('/api/cli/upload/multipart?name=gone.mp4&size=5', { method: 'POST' })).body)
    expect(await call(`/api/cli/upload/multipart/${aborted.id}?uploadId=${aborted.uploadId}`, { method: 'DELETE' })).toMatchInlineSnapshot(`
      {
        "body": {
          "ok": true,
        },
        "status": 200,
      }
    `)
    const late = await call(`/api/cli/upload/multipart/${aborted.id}/1?uploadId=${aborted.uploadId}`, { method: 'PUT', body: 'hello' })
    expect(late).toMatchInlineSnapshot(`
      {
        "body": {
          "message": "This upload does not exist, or it was completed or aborted. Start a new one.",
        },
        "status": 404,
      }
    `)
  } finally {
    await runtime.close()
  }
}, TEST_TIMEOUT_MS)
