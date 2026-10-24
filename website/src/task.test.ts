// Phone tasks end to end: the real Worker, task and hub Durable Objects, and the real model
// (Vercel AI Gateway, so run with `sigillo run -- pnpm test`). Only the Mac is scripted: a
// WebSocket on /tunnel/upstream that answers the daemon routes with a small Settings app.
import { afterAll, beforeAll, expect, test } from 'vitest'
import type { UIMessage, UIMessageChunk } from 'ai'
import { z } from 'zod'
import { startTestRuntime } from './test-runtime.ts'
import { TASK_TOOL_INPUTS, taskToolSchema, type TaskToolName } from './task-agent.ts'

let runtime: Awaited<ReturnType<typeof startTestRuntime>>
beforeAll(async () => {
  if (!process.env.AI_GATEWAY_API_KEY) throw new Error('AI_GATEWAY_API_KEY is missing: run `sigillo run -- pnpm test`')
  runtime = await startTestRuntime()
})
afterAll(async () => { await runtime?.close() })

const SCREENS: Record<string, string[]> = {
  home: ['Settings', 'Photos', 'TikTok'],
  settings: ['Settings', 'General', 'Accessibility'],
  general: ['General', 'About', 'Software Update'],
  about: ['About', 'Name', 'Morse iPhone'],
}
const TAPS: Record<string, Record<string, string>> = { home: { Settings: 'settings' }, settings: { General: 'general' }, general: { About: 'about' } }

type DaemonRequest = { type: 'request'; id: string; method: string; path: string; body: string | null }

/** A signed-in Mac named Studio with one iPhone on lease 7. `hold` keeps a request unanswered. */
async function fakeMac({ hold }: { hold?: (op: string) => boolean } = {}) {
  const response = await runtime.worker.fetch('/__test/session', { method: 'POST' })
  const identity = await response.json() as { user: { id: string }; session: { token: string } }
  const upstream = await runtime.worker.fetch('/tunnel/upstream', {
    headers: { upgrade: 'websocket', authorization: `Bearer ${identity.session.token}`, 'user-agent': 'ghosthand/test (Studio)' },
  })
  const socket = upstream.webSocket!
  socket.accept()
  const mac = { screen: 'home', ops: [] as string[], held: [] as (() => void)[], token: identity.session.token, orgId: identity.user.id }

  const screenText = () => ({
    width: 375, height: 667,
    lines: SCREENS[mac.screen]!.map((text, i) => ({ text, x: 20, y: 100 + i * 44, width: 120, height: 20, confidence: 1 })),
  })
  const answer = (id: string, status: number, body: object) => {
    const contentType = status === 200 ? 'application/json' : 'application/problem+json'
    socket.send(JSON.stringify({ type: 'response', id, status, headers: { 'content-type': contentType } }))
    socket.send(JSON.stringify({ type: 'chunk', id, data: Buffer.from(JSON.stringify(body)).toString('base64') }))
    socket.send(JSON.stringify({ type: 'end', id }))
  }
  const handle = (request: DaemonRequest) => {
    const url = new URL(request.path, 'http://mac')
    const [, lease, op] = url.pathname.match(/^\/v1\/leases\/([^/]+)\/([a-z-]+)$/) ?? []
    if (decodeURIComponent(lease ?? '') !== 'studio:7') return answer(request.id, 403, { code: 'lease-invalid', title: 'Lease not valid', status: 403, detail: `unknown lease ${lease}` })
    const body = request.body ? JSON.parse(Buffer.from(request.body, 'base64').toString()) : {}
    mac.ops.push(op === 'tap' || op === 'type' || op === 'key' ? `${op} ${body.text ?? body.key}` : op!)
    if (op === 'text') return answer(request.id, 200, screenText())
    if (op === 'key' && body.key === 'home') mac.screen = 'home'
    if (op === 'type' && /settings/i.test(body.text) && body.enter) mac.screen = 'settings'
    if (op === 'tap') {
      if (!SCREENS[mac.screen]!.some((line) => line.toLowerCase().includes(String(body.text).toLowerCase()))) {
        return answer(request.id, 404, { code: 'text-not-found', title: 'Text not on screen', status: 404, detail: `no line contains "${body.text}"` })
      }
      mac.screen = TAPS[mac.screen]?.[body.text] ?? mac.screen
    }
    const after = url.searchParams.get('screentext') === 'true' ? { screen: screenText() } : {}
    answer(request.id, 200, { message: `${op} sent`, logs: [], ...after })
  }
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data))
    if (message.type !== 'request') return
    const request = message as DaemonRequest
    const op = request.path.match(/\/([a-z-]+)(\?|$)/)?.[1] ?? ''
    if (hold?.(op)) mac.held.push(() => handle(request))
    else handle(request)
  })
  return mac
}

async function readStream(response: { text(): Promise<string> }): Promise<UIMessageChunk[]> {
  const chunks: UIMessageChunk[] = []
  const text = await response.text().catch(() => '')
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue
    chunks.push(JSON.parse(line.slice('data: '.length)))
  }
  return chunks
}

function startTask({ mac, taskId, prompt }: { mac: Awaited<ReturnType<typeof fakeMac>>; taskId: string; prompt: string }) {
  return runtime.worker.fetch('/api/cli/tasks', {
    method: 'POST',
    headers: { authorization: `Bearer ${mac.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: taskId, lease: 'studio:7', phone: { name: 'Test iPhone', model: 'iPhone XR', iosVersion: '18.7', language: 'en' }, messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: prompt }] }] }),
  })
}

/** TestTask hooks: `alarm` runs the real alarm now, `crash` resets the object like a deploy. */
function testTask({ orgId, taskId, action }: { orgId: string; taskId: string; action: 'alarm' | 'crash' | 'keys' }) {
  return runtime.worker.fetch(`/__test/task/${action}?org=${orgId}&task=${taskId}`).catch(() => null)
}

test('task tools are MCP tools: same names and arguments, without lease, mac, scale, screenshot, screentext, waitText, timeoutMs', () => {
  const names = Object.keys(TASK_TOOL_INPUTS) as TaskToolName[]
  const shapes = names.map((name) => {
    const mcp = taskToolSchema(name).inputSchema
    const ours = z.toJSONSchema(TASK_TOOL_INPUTS[name])
    return { name, mcp: [Object.keys(mcp.properties ?? {}).sort(), mcp.required], ours: [Object.keys(ours.properties ?? {}).sort(), ours.required ?? []] }
  })
  for (const { mcp, ours } of shapes) expect(ours).toEqual(mcp)
  expect(Object.fromEntries(shapes.map(({ name, mcp }) => [name, mcp[0]!.join(' ')]))).toMatchInlineSnapshot(`
    {
      "key": "key language",
      "screenshot": "native settle",
      "screentext": "language settle",
      "scroll": "direction language ticks x y",
      "swipe": "durationMs language x1 x2 y1 y2",
      "tap": "index language text x y",
      "type": "enter language text",
    }
  `)
})

const PROMPT = 'Open Settings, then General, then About. Tell me the name of the iPhone.'

test('a task streams AI SDK chunks, drives the Mac through the hub, then deletes itself after a day', async () => {
  const mac = await fakeMac()
  const taskId = 'task-happy-path'
  const response = await startTask({ mac, taskId, prompt: PROMPT })
  expect(response.status).toBe(200)
  expect(response.headers.get('x-vercel-ai-ui-message-stream')).toBe('v1')
  const chunks = await readStream(response)

  expect(mac.screen).toBe('about')
  expect(chunks[0]).toMatchObject({ type: 'start' })
  expect(chunks.at(-1)).toMatchObject({ type: 'finish', finishReason: 'stop' })
  const answer = chunks.flatMap((c) => (c.type === 'text-delta' ? [c.delta] : [])).join('')
  expect(answer).toContain('Morse iPhone')

  const auth = { headers: { authorization: `Bearer ${mac.token}` } }
  const { messages } = await (await runtime.worker.fetch(`/api/cli/tasks/${taskId}`, auth)).json() as { messages: UIMessage[] }
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
  expect((await runtime.worker.fetch(`/api/cli/tasks/${taskId}/stream`, auth)).status).toBe(204)
  // A client that lost the stream after all but the last two chunks gets exactly those.
  const messageId = (chunks[0] as { messageId: string }).messageId
  const rest = await runtime.worker.fetch(`/api/cli/tasks/${taskId}/stream?from=${chunks.length - 2}&message=${messageId}`, auth)
  expect(rest.status).toBe(200)
  expect(await readStream(rest)).toEqual(chunks.slice(-2))
  expect((await runtime.worker.fetch(`/api/cli/tasks/${taskId}/stream?from=0&message=other`, auth)).status).toBe(410)

  // Rows are written in batches, one before each tool call and one at the end: not one per chunk.
  const keys = await (await testTask({ orgId: mac.orgId, taskId, action: 'keys' }))!.json() as string[]
  const toolCalls = chunks.filter((c) => c.type === 'tool-input-available').length
  expect(keys.filter((key) => key.startsWith('chunks:')).length).toBe(toolCalls + 1)
  expect(chunks.length).toBeGreaterThan(toolCalls * 4)

  // A follow-up prompt continues the same task with its history.
  const followUp = await runtime.worker.fetch('/api/cli/tasks', {
    method: 'POST',
    headers: { authorization: `Bearer ${mac.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: taskId, lease: 'studio:7', messages: [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Now go back to the Home Screen.' }] }] }),
  })
  expect((await readStream(followUp)).at(-1)).toMatchObject({ type: 'finish' })
  expect(mac.screen).toBe('home')
  const all = await (await runtime.worker.fetch(`/api/cli/tasks/${taskId}`, auth)).json() as { messages: UIMessage[] }
  expect(all.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])

  // Idle: the alarm deletes the whole object.
  expect(await (await testTask({ orgId: mac.orgId, taskId, action: 'alarm' }))?.json()).toEqual({ meta: null })
  const after = await (await runtime.worker.fetch(`/api/cli/tasks/${taskId}`, auth)).json() as { messages: UIMessage[] }
  expect(after.messages).toEqual([])
}, 60_000)

test('a new prompt stops the running turn and starts at once, with the stopped answer in the history', async () => {
  // The first action never answers: the turn would wait for it forever.
  let holding = true
  const mac = await fakeMac({ hold: (op) => holding && op !== 'text' })
  const taskId = 'task-interrupted'
  const first = startTask({ mac, taskId, prompt: PROMPT }).then(readStream)
  await expect.poll(() => mac.held.length, { timeout: 30_000 }).toBe(1)
  holding = false

  const second = await runtime.worker.fetch('/api/cli/tasks', {
    method: 'POST',
    headers: { authorization: `Bearer ${mac.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ id: taskId, lease: 'studio:7', messages: [{ id: 'm2', role: 'user', parts: [{ type: 'text', text: 'Stop that. Go to the Home Screen instead.' }] }] }),
  })
  expect(second.status).toBe(200)
  expect((await first).at(-1)).toMatchObject({ type: 'abort' })
  // The first client's late abort names its own prompt: the new turn keeps running.
  const auth = { headers: { authorization: `Bearer ${mac.token}` } }
  const lateAbort = await runtime.worker.fetch(`/api/cli/tasks/${taskId}/abort?prompt=m1`, { method: 'POST', ...auth })
  expect(await lateAbort.json()).toEqual({ aborted: false })
  expect((await readStream(second)).at(-1)).toMatchObject({ type: 'finish' })
  expect(mac.screen).toBe('home')

  const { messages } = await (await runtime.worker.fetch(`/api/cli/tasks/${taskId}`, auth)).json() as { messages: UIMessage[] }
  expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
}, 60_000)

test('a task stopped by a restart continues from its stored chunks', async () => {
  // The first tap never answers before the restart, like an action in flight during a deploy.
  let holding = true
  const mac = await fakeMac({ hold: (op) => holding && op === 'tap' })
  const taskId = 'task-restarted'
  const first = startTask({ mac, taskId, prompt: PROMPT }).then(readStream)
  await expect.poll(() => mac.held.length, { timeout: 30_000 }).toBe(1)

  await testTask({ orgId: mac.orgId, taskId, action: 'crash' })
  holding = false
  mac.held[0]!() // the tap ran on the iPhone after all
  const cut = await first
  expect(cut.at(-1)?.type).not.toBe('finish')

  const auth = { headers: { authorization: `Bearer ${mac.token}` } }
  const resumed = await runtime.worker.fetch(`/api/cli/tasks/${taskId}/stream`, auth)
  expect(resumed.status).toBe(200)
  const chunks = await readStream(resumed)
  expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-output-error', errorText: expect.stringContaining('Interrupted') }))
  expect(chunks.at(-1)).toMatchObject({ type: 'finish' })
  expect(mac.screen).toBe('about')
  expect(chunks.flatMap((c) => (c.type === 'text-delta' ? [c.delta] : [])).join('')).toContain('Morse iPhone')
}, 90_000)
