// The phone task agent: model, system prompt and tools. No Cloudflare imports, so a script
// can run the same agent against a Mac's tunnel (scripts/task-bench.ts).
//
//   streamText (deepseek-v4.1-flash, glm fallback) ──tool call──> daemon client (openapi-fetch)
//                                                                │ task.ts: GhosthandHub.daemonFetch
//                                                                ▼
//                                     daemon POST /v1/leases/<lease>/tap?screentext=true ──> iPhone
//
// Speed: every action asks the daemon for the screen text after the input (`screentext`), so
// one model step is one action plus its result. No screenshots: the models read OCR lines.

import { createGateway } from '@ai-sdk/gateway'
import { createFallback } from 'ai-fallback'
import { isStepCount, jsonSchema, tool, type JSONSchema7 } from 'ai'
import createClient, { type Client } from 'openapi-fetch'
import { z } from 'zod'
import dedent from 'string-dedent'
import type { components, paths } from './generated/daemon-api.ts'
import mcpManual from '../mcp-tools.json'

// Measured on a 4-step Settings task (Oct 2026), reasoning off: v4.1-flash ~0.45 s per step,
// v4-flash ~2 s, glm-5.3-flash ~0.7 s. The `-fast` variant was not faster and costs 8x.
const PRIMARY_MODEL = 'deepseek/deepseek-v4.1-flash'
const FALLBACK_MODEL = 'zai/glm-5.3-flash'
const MODEL_RESET_INTERVAL_MS = 60_000
export const MAX_TASK_STEPS = 40

/** JSON responses only: the daemon also offers SSE on input routes, which the tools never ask for. */
export type DaemonClient = Client<paths, 'application/json' | 'application/problem+json'>

/** The daemon API of one Mac. `fetch` reaches it: the hub in the Worker, the tunnel URL in a script. */
export function createDaemonClient(fetch: (request: Request) => Promise<Response>): DaemonClient {
  return createClient<paths, 'application/json' | 'application/problem+json'>({ baseUrl: 'https://daemon', fetch })
}

export function createTaskModel(apiKey: string) {
  const gateway = createGateway({ apiKey })
  return createFallback({
    models: [gateway(PRIMARY_MODEL), gateway(FALLBACK_MODEL)],
    modelResetInterval: MODEL_RESET_INTERVAL_MS,
  })
}

export const TASK_SYSTEM_PROMPT = dedent`
  You operate the user's iPhone with tools. Do the task in as few steps as possible.

  - Every action returns the screen text after it: OCR lines \`x,y wxh text\` in screen points,
    top to bottom. Call \`screentext\` only to look before the first action.
  - Tap by \`text\` when the target has a label. Use x,y (the center: x+w/2, y+h/2) for icons,
    or when OCR cannot read the label. OCR does not see icons and can misread text.
  - Open an app: \`key\` cmd+space, then \`type\` its name with \`enter: true\`. \`key\` home goes to the Home Screen.
  - Use \`waitText\` when the next screen needs time to load and you know a text it shows.
  - Tool descriptions are the ghosthand CLI help: CLI flags are arguments (--wait-text = waitText).
    There are no screenshots: you read OCR lines in the same coordinates.
  - If an action changed nothing, try another way. Never repeat one failing action more than twice.
  - Never pay, buy, send money, delete data or type passwords unless the task asks exactly that.
  - When the task is done or blocked, reply in one or two short sentences: what you did and
    what the screen shows now. Use the language of the task.
`

/** The leased iPhone, sent by the daemon with each turn (lockdown values over USB). */
export const TaskPhone = z.object({
  name: z.string().max(200),
  model: z.string().max(200).optional(),
  iosVersion: z.string().max(50).optional(),
  language: z.string().max(50).optional(),
  locale: z.string().max(50).optional(),
  timeZone: z.string().max(100).optional(),
})
export type TaskPhone = z.infer<typeof TaskPhone>

/** The system prompt with the phone last, so the shared prefix stays cached across tasks. */
export function taskSystemPrompt(phone?: TaskPhone): string {
  if (!phone) return TASK_SYSTEM_PROMPT
  const device = [phone.name, phone.model, phone.iosVersion && `iOS ${phone.iosVersion}`].filter(Boolean).join(', ')
  const region = [phone.language && `language ${phone.language}`, phone.locale && `region ${phone.locale}`, phone.timeZone && `time zone ${phone.timeZone}`]
    .filter(Boolean).join(', ')
  const lines = [`The iPhone: ${device}.`]
  if (region) lines.push(`Its settings: ${region}. Labels on screen and app names in Spotlight are in that language.`)
  return `${TASK_SYSTEM_PROMPT}\n${lines.join('\n')}`
}

/** OCR lines as `x,y wxh text`, like the CLI and MCP screentext output, after the screen size. */
export function screenLines(screen: components['schemas']['ScreenText']): string {
  const lines = screen.lines.map((l) => `${l.x},${l.y} ${l.width}x${l.height} ${l.text}`)
  return [`screen ${screen.width}x${screen.height}`, ...lines].join('\n')
}

function actionText(result: components['schemas']['ActionResult']): string {
  return result.screen ? `${result.message}\n${screenLines(result.screen)}` : result.message
}

/** A daemon problem as the tool error the model reads. */
function problemError(problem: components['schemas']['Problem']): Error {
  return new Error(`${problem.code}: ${problem.detail ?? problem.title}`)
}

// Arguments of every input tool, as in MCP: wait for a text after the input, OCR language.
const after = {
  waitText: z.string().min(1).optional(),
  timeoutMs: z.number().min(0).optional(),
  language: z.string().optional(),
}

/** The task's tools: a subset of the daemon's MCP tools, with the same names and arguments.
 *  These schemas validate and type the input; the model sees the MCP schema (taskToolSchema). */
export const TASK_TOOL_INPUTS = {
  screentext: z.object({ language: z.string().optional(), settle: z.boolean().optional() }),
  tap: z.object({ x: z.number().optional(), y: z.number().optional(), text: z.string().optional(), index: z.number().int().optional(), ...after }),
  swipe: z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), durationMs: z.number().optional(), ...after }),
  scroll: z.object({ direction: z.enum(['up', 'down', 'left', 'right']), ticks: z.number().int(), x: z.number().optional(), y: z.number().optional(), ...after }),
  key: z.object({ key: z.string(), ...after }),
  type: z.object({ text: z.string(), enter: z.boolean().optional(), ...after }),
}
export type TaskToolName = keyof typeof TASK_TOOL_INPUTS

/** MCP arguments the task sets itself: its lease, its Mac, and OCR output instead of images. */
const FIXED_ARGUMENTS = new Set(['lease', 'mac', 'scale', 'screenshot', 'screentext'])

// Generated from the binary by `pnpm generate-docs`: the same text as `ghosthand <command> --help`.
const MCP_TOOLS = z.array(z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({
    properties: z.record(z.string(), z.custom<JSONSchema7>((value) => typeof value === 'object' && value !== null)),
    required: z.array(z.string()),
  }).loose(),
})).parse(mcpManual.tools)

/** The MCP tool's description and input schema, without the fixed arguments. */
export function taskToolSchema(name: TaskToolName): { description: string; inputSchema: JSONSchema7 } {
  const mcp = MCP_TOOLS.find((t) => t.name === name)
  if (!mcp) throw new Error(`mcp-tools.json has no tool ${name}: run pnpm generate-docs`)
  const properties = Object.fromEntries(Object.entries(mcp.inputSchema.properties).filter(([key]) => !FIXED_ARGUMENTS.has(key)))
  const required = mcp.inputSchema.required.filter((key) => !FIXED_ARGUMENTS.has(key))
  return { description: mcp.description, inputSchema: { ...mcp.inputSchema, type: 'object', properties, required } }
}

function mcpTool<T>(name: TaskToolName, input: z.ZodType<T>) {
  const { description, inputSchema } = taskToolSchema(name)
  return {
    description,
    inputSchema: jsonSchema<T>(inputSchema, {
      validate: (value) => {
        const parsed = input.safeParse(value)
        return parsed.success ? { success: true, value: parsed.data } : { success: false, error: parsed.error }
      },
    }),
  }
}

/** The tools of a task on one lease, as acquire printed it (`studio:42`; the daemon of that Mac drops its own prefix). */
export function createPhoneTools({ daemon, lease }: { daemon: DaemonClient; lease: string }) {
  const path = { lease }
  const query = (input: { waitText?: string; timeoutMs?: number; language?: string }) => ({
    screentext: true,
    waitText: input.waitText,
    timeoutMs: input.timeoutMs,
    language: input.language,
  })

  return {
    screentext: tool({
      ...mcpTool('screentext', TASK_TOOL_INPUTS.screentext),
      execute: async (input) => {
        const { data, error } = await daemon.GET('/v1/leases/{lease}/text', { params: { path, query: { language: input.language, settle: input.settle } } })
        if (error) throw problemError(error)
        return screenLines(data)
      },
    }),
    tap: tool({
      ...mcpTool('tap', TASK_TOOL_INPUTS.tap),
      execute: async (input) => {
        const { data, error } = await daemon.POST('/v1/leases/{lease}/tap', { params: { path, query: query(input) }, body: tapTarget(input) })
        if (error) throw problemError(error)
        return actionText(data)
      },
    }),
    swipe: tool({
      ...mcpTool('swipe', TASK_TOOL_INPUTS.swipe),
      execute: async (input) => {
        const body = { from: { x: input.x1, y: input.y1 }, to: { x: input.x2, y: input.y2 }, durationMs: input.durationMs }
        const { data, error } = await daemon.POST('/v1/leases/{lease}/swipe', { params: { path, query: query(input) }, body })
        if (error) throw problemError(error)
        return actionText(data)
      },
    }),
    scroll: tool({
      ...mcpTool('scroll', TASK_TOOL_INPUTS.scroll),
      execute: async (input) => {
        if ((input.x === undefined) !== (input.y === undefined)) throw new Error('x and y go together')
        const at = input.x !== undefined && input.y !== undefined ? { x: input.x, y: input.y } : undefined
        const body = { direction: input.direction, ticks: input.ticks, at }
        const { data, error } = await daemon.POST('/v1/leases/{lease}/scroll', { params: { path, query: query(input) }, body })
        if (error) throw problemError(error)
        return actionText(data)
      },
    }),
    key: tool({
      ...mcpTool('key', TASK_TOOL_INPUTS.key),
      execute: async (input) => {
        const { data, error } = await daemon.POST('/v1/leases/{lease}/key', { params: { path, query: query(input) }, body: { key: input.key } })
        if (error) throw problemError(error)
        return actionText(data)
      },
    }),
    type: tool({
      ...mcpTool('type', TASK_TOOL_INPUTS.type),
      execute: async (input) => {
        const { data, error } = await daemon.POST('/v1/leases/{lease}/type', { params: { path, query: query(input) }, body: { text: input.text, enter: input.enter } })
        if (error) throw problemError(error)
        return actionText(data)
      },
    }),
  }
}

export type PhoneTools = ReturnType<typeof createPhoneTools>

function tapTarget({ text, index, x, y }: { text?: string; index?: number; x?: number; y?: number }): components['schemas']['TapRequest'] {
  if (text) return { text, index }
  if (x !== undefined && y !== undefined) return { x, y }
  throw new Error('Pass `text`, or both `x` and `y`.')
}

/** streamText options shared by the Durable Object and the bench script. */
export function taskStreamOptions({ apiKey, daemon, lease, phone }: { apiKey: string; daemon: DaemonClient; lease: string; phone?: TaskPhone }) {
  return {
    model: createTaskModel(apiKey),
    system: taskSystemPrompt(phone),
    tools: createPhoneTools({ daemon, lease }),
    stopWhen: isStepCount(MAX_TASK_STEPS),
    // Reasoning adds about a second per step and did not pick better actions.
    reasoning: 'none' as const,
  }
}
