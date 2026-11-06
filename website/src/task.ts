// One Durable Object per phone task: the AI SDK chat API around the agent in task-agent.ts.
// Responses are the AI SDK UI message stream (SSE `data: <UIMessageChunk>`) as is, so any
// AI SDK client (`useChat`, DefaultChatTransport with resume) works, and so does the daemon.
//
//   POST /api/cli/tasks {id, messages, lease} ─> send()    new turn (a running one stops); SSE of the turn
//   GET  /api/cli/tasks/:id/stream            ─> resume()  the running turn from its first chunk, or 204
//   GET  .../stream?from=<n>&message=<id>     ─> resume()  a reconnecting client: chunks from n, also of
//                                                           an ended turn (until the next one starts)
//   GET  /api/cli/tasks/:id                   ─> messages()
//   POST /api/cli/tasks/:id/abort?prompt=<id> ─> abort()   the running turn, or only the one that message started
//
// The turn runs detached from the request: a client that drops reconnects with /stream.
//
// Storage is billed per row written (setAlarm and deletes too), so chunks stay in memory and
// are written in batches: one row before each tool runs (a phone action may follow, so a
// restart must know about it) and one when the turn ends. A 6-step turn writes about 15 rows.
// Old turns' rows are never deleted one by one: deleteAll() drops them with the object.
//
//   meta                       lease, phone, running, turn number, recoveries
//   message:<n>                one UIMessage per row, oldest first
//   chunks:<turn>:<first seq>  the chunks of a turn from that index, one row per batch
//
// Alarm, one per object:
//   running, turn in memory      re-arm in 30 s (a heartbeat; never a message to anyone)
//   running, no turn in memory   a deploy or crash stopped it: continue the turn (recover)
//   idle                         one day after the last activity: deleteAll()

import { DurableObject, env } from 'cloudflare:workers'
import { convertToModelMessages, generateId, isToolUIPart, readUIMessageStream, streamText, type UIMessage, type UIMessageChunk } from 'ai'
import { createDaemonClient, taskStreamOptions, type TaskPhone } from './task-agent.ts'
import { getHub } from './tunnel.ts'
import { captureException, reportErrors, trackEvent } from './telemetry.ts'

const HEARTBEAT_MS = 30_000
const EXPIRY_MS = 24 * 60 * 60 * 1000
/** A turn that keeps crashing is stopped instead of restarted forever. */
const MAX_RECOVERIES = 2
const KEEPALIVE_MS = 15_000
const KEY_DIGITS = 8
const INTERRUPTED = 'Interrupted by a server restart: this action may or may not have run. Read the screen before you continue.'
// No "continue": the model would take it as an order to go on with the stopped task.
const STOPPED_ACTION = 'Stopped by the user while this action ran: it may or may not have happened on the iPhone.'
// Like Claude Code's "[Request interrupted by user]": without it the model reads the stopped
// prompt and the next one as one user message, and goes on with the stopped task.
const STOPPED_NOTE = '[The user stopped the task above before it finished.]'

/** `stopped`: the user stopped this answer (Stop, or a new prompt) before it finished. */
type TaskMetadata = { stopped?: boolean }

/** `studio:42`: the Mac's slug and the lease on it. */
export const TASK_LEASE_PATTERN = /^([a-z0-9-]+):([^:/]+)$/

/** `taskId` is missing in tasks started before it was stored. */
/** `prompt`: id of the user message that started the turn, so an abort can name its turn. */
type Meta = { orgId: string; taskId?: string; lease: string; phone?: TaskPhone; running: boolean; turn: number; recoveries: number; prompt?: string }
/** The running turn: all its chunks (`saved` of them stored) and the open streams with their ping timer. */
type Turn = {
  number: number
  startedAt: number
  abort: AbortController
  /** Resolves in endTurn, after the turn's answer is saved. */
  ended: PromiseWithResolvers<void>
  chunks: UIMessageChunk[]
  saved: number
  listeners: Map<ReadableStreamDefaultController<Uint8Array>, ReturnType<typeof setInterval>>
}

export function getTask({ orgId, taskId }: { orgId: string; taskId: string }) {
  return env.GHOSTHAND_TASK.getByName(`${orgId}:${taskId}`)
}

export class GhosthandTask extends DurableObject<Env> {
  private turn: Turn | null = null

  /** Starts a turn with a new user message. A running turn stops first (its stream ends with
   *  `abort`, its partial answer stays in the history): the new prompt replaces it. */
  async send({ orgId, taskId, lease, phone, message }: { orgId: string; taskId: string; lease: string; phone?: TaskPhone; message: UIMessage }): Promise<ReadableStream<Uint8Array>> {
    // A turn a restart stopped is rebuilt first, so its partial answer stays in the history.
    await this.recover()
    // Another send can arrive while this one waits: the last prompt wins.
    while (this.turn) {
      this.turn.abort.abort()
      await this.turn.ended.promise
    }
    // From here to `this.turn =` nothing awaits, so no other send starts a turn in between.
    const meta = this.meta()
    const history = [...this.messages(), message]
    this.saveMessage(message)
    const turn = (meta?.turn ?? 0) + 1
    this.ctx.storage.kv.put('meta', { orgId, taskId, lease, phone, running: true, turn, recoveries: 0, prompt: message.id } satisfies Meta)
    this.turn = newTurn(turn, [])
    this.run(history)
    return this.follow(0)
  }

  /** AI SDK resume: the running turn from its first chunk, null when none runs. With `from`:
   *  the turn's chunks from that index, also after it ended, so a client that saw `from`
   *  chunks gets the rest once. `gone` when a newer turn replaced message `messageId`. */
  async resume({ from, messageId }: { from?: number; messageId?: string } = {}): Promise<ReadableStream<Uint8Array> | null | 'gone'> {
    await this.recover()
    if (from === undefined) return this.turn ? this.follow(0) : null
    const first = this.chunks()[0]
    if (!first || (messageId && first.type === 'start' && first.messageId !== messageId)) return 'gone'
    return this.follow(from)
  }

  /** Stored messages, oldest first. The running turn's answer is added when it ends. */
  messages(): UIMessage[] {
    return [...this.ctx.storage.kv.list<UIMessage>({ prefix: 'message:' })].map(([, message]) => message)
  }

  /** Stops the running turn. Its stream ends with an `abort` chunk. With `prompt`, only the
   *  turn that user message started: a late abort of a replaced turn never stops its successor.
   *  A turn a restart stopped is rebuilt first, like in send(), so it ends through endTurn():
   *  its partial answer is saved as stopped and the alarm becomes the expiry, not a heartbeat
   *  that would find the task idle and delete it. */
  async abort({ prompt }: { prompt?: string } = {}): Promise<boolean> {
    const meta = this.meta()
    if (!meta?.running) return false
    if (prompt && meta.prompt !== prompt) return false
    await this.recover()
    this.turn?.abort.abort()
    return true
  }

  async alarm(): Promise<void> {
    await reportErrors('GhosthandTask.alarm', async () => {
      const meta = this.meta()
      if (!meta) return
      if (!meta.running) return this.ctx.storage.deleteAll()
      if (this.turn) return this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS)
      await this.recover()
    })
  }

  /** Runs `this.turn` detached from the request. Every step of it, the alarm too, runs inside
   *  runTurn's try, so whatever fails, endTurn() ends the turn and nothing waits on it forever. */
  private run(history: UIMessage[]): void {
    const meta = this.meta()!
    // A pending promise keeps the object in memory, also after the client disconnects.
    this.ctx.waitUntil(this.runTurn({ meta, history, signal: this.turn!.abort.signal }))
  }

  private async runTurn({ meta, history, signal }: { meta: Meta; history: UIMessage[]; signal: AbortSignal }): Promise<void> {
    const [, mac] = meta.lease.match(TASK_LEASE_PATTERN)!
    const hub = getHub(meta.orgId)
    // An aborted turn sends no more input; a request in flight still ends on the Mac (an
    // AbortSignal does not cross Durable Object RPC), but the turn stops waiting for it.
    const daemon = createDaemonClient((request) => {
      signal.throwIfAborted()
      return untilAborted(hub.daemonFetch(mac!, request), signal)
    })
    try {
      // The heartbeat is set once per turn and re-armed only by the alarm: one row per 30 s.
      await this.ctx.storage.setAlarm(Date.now() + HEARTBEAT_MS)
      const options = taskStreamOptions({ apiKey: this.env.AI_GATEWAY_API_KEY, daemon, lease: meta.lease, phone: meta.phone })
      // The history the model reads: a note from the user after each answer they stopped.
      const modelHistory = history.flatMap((message): UIMessage[] => {
        if (!(message.metadata as TaskMetadata | undefined)?.stopped) return [message]
        return [message, { id: `${message.id}-stopped`, role: 'user', parts: [{ type: 'text', text: STOPPED_NOTE }] }]
      })
      const result = streamText({
        ...options,
        // With the tools, old screenshots in the history tell the model they were not kept.
        messages: await convertToModelMessages(modelHistory, { tools: options.tools, ignoreIncompleteToolCalls: true }),
        abortSignal: signal,
        // Model and gateway failures. Tool errors are the daemon's answers: the model reads them.
        onError: ({ error }) => {
          captureException(error, { tags: { handler: 'task.streamText' } })
        },
      })
      const stream = result.toUIMessageStream({
        originalMessages: history,
        // The `start` chunk and the saved answer need an id: reconnects check it.
        generateMessageId: generateId,
        // Tool errors are daemon problems for this account's own Mac: show them as they are.
        onError: (error) => (error instanceof Error ? error.message : String(error)),
        // A stopped answer is kept, with its open action failed, and marked for modelHistory.
        onEnd: ({ responseMessage, isAborted }) => {
          if (!isAborted) return this.saveMessage(responseMessage)
          failOpenToolCalls(responseMessage, STOPPED_ACTION)
          this.saveMessage({ ...responseMessage, metadata: { stopped: true } satisfies TaskMetadata })
        },
      })
      for await (const chunk of stream) this.push(chunk)
    } catch (error) {
      if (!signal.aborted) captureException(error, { tags: { handler: 'task.runTurn' } })
      this.push({ type: 'error', errorText: error instanceof Error ? error.message : String(error) })
    } finally {
      this.endTurn()
    }
  }

  private endTurn(outcome?: string): void {
    this.saveChunks()
    const meta = this.meta()
    if (meta) this.ctx.storage.kv.put('meta', { ...meta, running: false } satisfies Meta)
    if (meta && this.turn) trackTurn({ meta, turn: this.turn, outcome })
    for (const [listener, keepalive] of this.turn?.listeners ?? []) {
      clearInterval(keepalive)
      try {
        listener.enqueue(sse('[DONE]'))
        listener.close()
      } catch {}
    }
    this.turn?.ended.resolve()
    this.turn = null
    void this.ctx.storage.setAlarm(Date.now() + EXPIRY_MS)
  }

  /** A turn marked running with nothing in memory was stopped by a deploy or crash.
   *  Rebuild its answer from the stored chunks, mark unfinished tool calls as failed, and
   *  continue: the model reads the screen again, so a tap is never repeated blindly. */
  private async recover(): Promise<void> {
    const meta = this.meta()
    if (!meta?.running || this.turn) return
    const chunks = this.chunks()
    this.turn = newTurn(meta.turn, chunks)
    if (meta.recoveries >= MAX_RECOVERIES) {
      const errorText = 'The task stopped after repeated server restarts. Send it again.'
      captureException(new Error(errorText), { tags: { handler: 'task.recover' } })
      this.push({ type: 'error', errorText })
      return this.endTurn('stopped')
    }
    this.ctx.storage.kv.put('meta', { ...meta, recoveries: meta.recoveries + 1 } satisfies Meta)
    const history = this.messages()
    let partial: UIMessage | undefined
    const stream = new ReadableStream<UIMessageChunk>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })
    try {
      for await (const message of readUIMessageStream({ stream })) partial = message
    } catch (error) {
      // `this.turn` is set: without endTurn() every later send() would wait on it forever.
      captureException(error, { tags: { handler: 'task.recover' } })
      this.push({ type: 'error', errorText: 'The task could not continue after a server restart. Send it again.' })
      return this.endTurn('failed')
    }
    for (const toolCallId of partial ? failOpenToolCalls(partial, INTERRUPTED) : []) {
      this.push({ type: 'tool-output-error', toolCallId, errorText: INTERRUPTED })
    }
    this.run(partial?.parts.length ? [...history, partial] : history)
  }

  /** SSE of the stored chunks from index `from`, then the live ones until the turn ends. */
  private follow(from: number): ReadableStream<Uint8Array> {
    const turn = this.turn
    let listener: ReadableStreamDefaultController<Uint8Array> | undefined
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        // Replay and subscribe in one synchronous step: no chunk can fall between them.
        for (const chunk of this.chunks().slice(from)) controller.enqueue(sse(JSON.stringify(chunk)))
        if (!turn) {
          controller.enqueue(sse('[DONE]'))
          return controller.close()
        }
        listener = controller
        // Proxies drop an SSE response after ~100 s without bytes; a tool can wait longer.
        const keepalive = setInterval(() => {
          try {
            controller.enqueue(PING)
          } catch {
            clearInterval(keepalive)
            turn.listeners.delete(controller)
          }
        }, KEEPALIVE_MS)
        turn.listeners.set(controller, keepalive)
      },
      cancel: () => {
        if (!listener || !turn) return
        clearInterval(turn.listeners.get(listener))
        turn.listeners.delete(listener)
      },
    })
  }

  /** Sends a chunk to every open stream. Stores the batch before a tool runs. */
  private push(chunk: UIMessageChunk): void {
    const turn = this.turn!
    turn.chunks.push(chunk)
    const data = sse(JSON.stringify(chunk))
    for (const [listener, keepalive] of turn.listeners) {
      try {
        listener.enqueue(data)
      } catch {
        clearInterval(keepalive)
        turn.listeners.delete(listener)
      }
    }
    if (chunk.type === 'tool-input-available') this.saveChunks()
  }

  /** One row with the chunks not stored yet. */
  private saveChunks(): void {
    const turn = this.turn
    if (!turn || turn.saved === turn.chunks.length) return
    this.ctx.storage.kv.put(`chunks:${pad(turn.number)}:${pad(turn.saved)}`, turn.chunks.slice(turn.saved))
    turn.saved = turn.chunks.length
  }

  /** The current turn's chunks: from memory while it runs, else the stored ones. */
  private chunks(): UIMessageChunk[] {
    if (this.turn) return this.turn.chunks
    const meta = this.meta()
    if (!meta) return []
    return [...this.ctx.storage.kv.list<UIMessageChunk[]>({ prefix: `chunks:${pad(meta.turn)}:` })].flatMap(([, batch]) => batch)
  }

  /** One row per message, so a long chat never hits the value size limit. Same id: replaced. */
  private saveMessage(message: UIMessage): void {
    const messages = [...this.ctx.storage.kv.list<UIMessage>({ prefix: 'message:' })]
    const key = messages.find(([, m]) => m.id === message.id)?.[0] ?? `message:${pad(messages.length)}`
    this.ctx.storage.kv.put(key, message)
  }

  private meta(): Meta | undefined {
    return this.ctx.storage.kv.get<Meta>('meta')
  }
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
  ])
}

/** Fails the tool calls that started but have no result, so the model knows they may have run.
 *  Calls still streaming their input never ran: ignoreIncompleteToolCalls drops them. */
function failOpenToolCalls(message: UIMessage, errorText: string): string[] {
  const failed: string[] = []
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.state !== 'input-available') continue
    Object.assign(part, { state: 'output-error', errorText })
    failed.push(part.toolCallId)
  }
  return failed
}

function newTurn(number: number, chunks: UIMessageChunk[]): Turn {
  return { number, startedAt: Date.now(), abort: new AbortController(), ended: Promise.withResolvers(), chunks: [...chunks], saved: chunks.length, listeners: new Map() }
}

/** `task_finished` from the turn's chunks. The duration of a recovered turn starts at its restart. */
function trackTurn({ meta, turn, outcome }: { meta: Meta; turn: Turn; outcome?: string }): void {
  const count = (type: UIMessageChunk['type']) => turn.chunks.filter((chunk) => chunk.type === type).length
  trackEvent('task_finished', {
    org_id: meta.orgId,
    task_id: meta.taskId ?? '',
    outcome: outcome ?? (count('abort') ? 'aborted' : count('error') ? 'failed' : 'finished'),
    steps: count('start-step'),
    tool_calls: count('tool-input-available'),
    tool_errors: count('tool-output-error'),
    duration_ms: Date.now() - turn.startedAt,
  })
}

function pad(n: number): string {
  return String(n).padStart(KEY_DIGITS, '0')
}

const PING = new TextEncoder().encode(': ping\n\n')

function sse(data: string): Uint8Array {
  return new TextEncoder().encode(`data: ${data}\n\n`)
}
