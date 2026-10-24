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
