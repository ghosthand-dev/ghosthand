// The phone task agent: model, system prompt and tools. No Cloudflare imports, so a script
// can run the same agent against a Mac's tunnel (scripts/task-bench.ts).
//
//   streamText (claude-haiku-5.5, glm fallback) ──tool call──> daemon client (openapi-fetch)
//                                                                │ task.ts: GhosthandHub.daemonFetch
//                                                                ▼
//                                   daemon POST /v1/leases/<lease>/tap?screenshot=jpeg ──> iPhone
//
// Speed: every action asks the daemon for a screenshot of the settled screen after the input,
// so one model step is one action plus its result.

import { createGateway } from '@ai-sdk/gateway'
import { experimental_createWebFetchTool as createWebFetchTool } from '@ai-sdk/tool-web-fetch'
import { createFallback } from 'ai-fallback'
import { isStepCount, jsonSchema, tool, type JSONSchema7, type Tool } from 'ai'
import createClient, { type Client } from 'openapi-fetch'
import { z } from 'zod'
import dedent from 'string-dedent'
import type { components, paths } from './generated/daemon-api.ts'
import mcpManual from '../mcp-tools.json'
import skillMd from '../../skills/ghosthand/SKILL.md?raw'

const PRIMARY_MODEL = 'anthropic/claude-haiku-5.5'
const FALLBACK_MODEL = 'zai/glm-5.3-flash'
const MODEL_RESET_INTERVAL_MS = 60_000
export const MAX_TASK_STEPS = 40

/** JSON responses only: the daemon also offers SSE on input routes, which the tools never ask for. */
export type DaemonClient = Client<paths, 'application/json' | 'application/problem+json'>

/** The daemon API of one Mac. `fetch` reaches it: the hub in the Worker, the tunnel URL in a script. */
export function createDaemonClient(fetch: (request: Request) => Promise<Response>): DaemonClient {
  // Without Accept, older daemons answer input routes with SSE.
  return createClient<paths, 'application/json' | 'application/problem+json'>({ baseUrl: 'https://daemon', fetch, headers: { accept: 'application/json' } })
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
  Complete the task end to end. Before you stop, try every other way you can (another
  path, a screenshot, search, scrolling). Report a problem only when no way is left.

  - Every action returns a screenshot of the screen after it, in screen points: the same
    coordinates every tool takes. Call \`screenshot\` only to look before the first action.
  - \`tapText\` taps a visible label (OCR finds it). \`tap\` x,y taps icons, images and anything
    without readable text. \`screentext\` gives exact OCR boxes when you need them.
  - \`key\` home goes to the Home Screen.
  - If the screenshot shows a loading screen, call \`screenshot\` with \`settle: true\`.
  - Tool descriptions are the ghosthand CLI help: CLI flags are arguments. Flags that are not in
    the tool's arguments do not exist here.
  - If an action changed nothing, try another way. Never repeat one same failing action more
    than twice, but do not give up: change the approach.
  - Never pay, buy, send money, delete data or type passwords unless the task asks exactly that.
  - Be super concise. Write no text between tool calls. When the task is done, or blocked
    after you tried every way, reply in one short sentence: the result, or why you stopped.
    No lists, no headings, no step recap. Use the language of the task.
  - Each user message is a new task that cancels the previous one, finished or not. Do only
    what the latest user message asks, then stop and reply. Never resume an earlier task.
  - When you are stuck or need tips on a tool, read the ghosthand docs with \`webfetch\`:
    - https://ghosthand.dev/docs/mcp/overview.md: rules of the agent loop
    - https://ghosthand.dev/docs/cli/<tool>.md: one tool's rules and examples (tap, swipe,
      scroll, key, type, screenshot, screentext, unlock)
    - https://ghosthand.dev/docs/scroll.md: how scroll ticks move the screen
    - https://ghosthand.dev/docs/send-media.md: photos and videos for upload in apps
    - https://ghosthand.dev/llms.txt: index of every docs page

  Phone tips:
  ${skillSection('Phone tips')}
`

/** One `##` section of skills/ghosthand/SKILL.md, without its heading. */
function skillSection(heading: string): string {
  const marker = `\n## ${heading}\n`
  const start = skillMd.indexOf(marker)
  if (start < 0) throw new Error(`skills/ghosthand/SKILL.md has no "## ${heading}" section`)
  const body = skillMd.slice(start + marker.length)
  const end = body.indexOf('\n## ')
  return (end < 0 ? body : body.slice(0, end)).trim()
}

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

/** A daemon problem as the tool error the model reads. */
function problemError(problem: components['schemas']['Problem']): Error {
  return new Error(`${problem.code}: ${problem.detail ?? problem.title}`)
}

/** The task's tools. Each calls one MCP tool with some of its arguments; the model sees that
 *  MCP tool's description and argument descriptions (taskToolSchema). `input` validates and
 *  types the call. The task sets the rest: lease, Mac, scale, and a screenshot after each input.
 *  No waitText (the model cannot know the next screen's text) and no OCR language. */
export const TASK_TOOLS = {
  screentext: { mcp: 'screentext', input: z.object({ settle: z.boolean().optional() }) },
  screenshot: { mcp: 'screenshot', input: z.object({ settle: z.boolean().optional(), native: z.boolean().optional() }) },
  tap: { mcp: 'tap', input: z.object({ x: z.number(), y: z.number() }) },
  tapText: { mcp: 'tap', input: z.object({ text: z.string(), index: z.number().int().optional() }) },
  swipe: { mcp: 'swipe', input: z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), durationMs: z.number().optional() }) },
  scroll: { mcp: 'scroll', input: z.object({ direction: z.enum(['up', 'down', 'left', 'right']), ticks: z.number().int(), x: z.number().optional(), y: z.number().optional() }) },
  key: { mcp: 'key', input: z.object({ key: z.string() }) },
  type: { mcp: 'type', input: z.object({ text: z.string(), enter: z.boolean().optional() }) },
  unlock: { mcp: 'unlock', input: z.object({ passcode: z.string() }) },
} as const
export type TaskToolName = keyof typeof TASK_TOOLS
type TaskToolInput<N extends TaskToolName> = z.infer<(typeof TASK_TOOLS)[N]['input']>
type ModelOutput = Awaited<ReturnType<NonNullable<Tool['toModelOutput']>>>

// Generated from the binary by `pnpm generate-docs`: the same text as `ghosthand <command> --help`.
const MCP_TOOLS = z.array(z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.object({ properties: z.record(z.string(), z.custom<JSONSchema7>((value) => typeof value === 'object' && value !== null)) }).loose(),
})).parse(mcpManual.tools)

/** The model-facing schema: `input`'s shape and required list, with the MCP tool's descriptions.
 *  Throws when an argument is not in the MCP tool, so the two cannot drift. */
export function taskToolSchema(name: TaskToolName): { description: string; inputSchema: JSONSchema7 } {
  const { mcp, input } = TASK_TOOLS[name]
  const manual = MCP_TOOLS.find((t) => t.name === mcp)
  if (!manual) throw new Error(`mcp-tools.json has no tool ${mcp}: run pnpm generate-docs`)
  const schema = z.toJSONSchema(input) as JSONSchema7
  const properties = Object.fromEntries(Object.keys(schema.properties ?? {}).map((key) => {
    const property = manual.inputSchema.properties[key]
    if (!property) throw new Error(`task tool ${name}: MCP tool ${mcp} has no argument ${key}`)
    return [key, property]
  }))
  return { description: manual.description, inputSchema: { type: 'object', properties, required: schema.required ?? [], additionalProperties: false } }
}

function mcpTool<N extends TaskToolName>(name: N) {
  const { description, inputSchema } = taskToolSchema(name)
  const input = TASK_TOOLS[name].input as unknown as z.ZodType<TaskToolInput<N>>
  return {
    description,
    inputSchema: jsonSchema<TaskToolInput<N>>(inputSchema, {
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
  const query = { screenshot: 'jpeg' as const }
  // Screenshots by tool call id: they go to the model only, never into the UI stream (the
  // Durable Object stores every chunk, the CLI prints outputs). Screenshots of earlier turns are gone.
  const images = new Map<string, string | Uint8Array>()

  const withScreen = (output: string, image: string | Uint8Array | undefined): ModelOutput => image
    ? { type: 'content', value: [{ type: 'text', text: output }, { type: 'file', mediaType: 'image/jpeg', data: { type: 'data', data: image } }] }
    : { type: 'text', value: `${output}\nThe screenshot is from an earlier turn and was not kept. Take a new one to see the screen.` }

  /** An input tool: sends the input, returns the daemon's message with the settled screen after it. */
  function inputTool<N extends Exclude<TaskToolName, 'screentext' | 'screenshot'>>(
    name: N,
    send: (input: TaskToolInput<N>) => Promise<{ data?: components['schemas']['ActionResult']; error?: components['schemas']['Problem'] }>,
  ) {
    return tool({
      ...mcpTool(name),
      execute: async (input: TaskToolInput<N>, { toolCallId }) => {
        const { data, error } = await send(input)
        if (error) throw problemError(error)
        if (!data!.screenshot) return data!.message
        images.set(toolCallId, data!.screenshot.data)
        return `${data!.message}\nscreen ${data!.screenshot.width}x${data!.screenshot.height}`
      },
      toModelOutput: ({ toolCallId, output }) => withScreen(output, images.get(toolCallId)),
    })
  }

  return {
    screentext: tool({
      ...mcpTool('screentext'),
      execute: async (input) => {
        const { data, error } = await daemon.GET('/v1/leases/{lease}/text', { params: { path, query: { settle: input.settle } } })
        if (error) throw problemError(error)
        return screenLines(data)
      },
    }),
    screenshot: tool({
      ...mcpTool('screenshot'),
      execute: async (input, { toolCallId }) => {
        const { data, error, response } = await daemon.GET('/v1/leases/{lease}/screenshot', {
          params: { path, query: { format: 'jpeg', settle: input.settle, native: input.native } },
          // The daemon checks Accept against the image type.
          headers: { accept: 'image/jpeg, application/problem+json' },
          parseAs: 'arrayBuffer',
        })
        if (error) throw problemError(error)
        images.set(toolCallId, new Uint8Array(data))
        const note = response.headers.get('x-note')
        return `screen ${response.headers.get('x-image-width')}x${response.headers.get('x-image-height')}${note ? `\n${note}` : ''}`
      },
      toModelOutput: ({ toolCallId, output }) => withScreen(output, images.get(toolCallId)),
    }),
    tap: inputTool('tap', (input) => daemon.POST('/v1/leases/{lease}/tap', { params: { path, query }, body: { x: input.x, y: input.y } })),
    tapText: inputTool('tapText', (input) => daemon.POST('/v1/leases/{lease}/tap', { params: { path, query }, body: { text: input.text, index: input.index } })),
    swipe: inputTool('swipe', (input) => daemon.POST('/v1/leases/{lease}/swipe', {
      params: { path, query },
      body: { from: { x: input.x1, y: input.y1 }, to: { x: input.x2, y: input.y2 }, durationMs: input.durationMs },
    })),
    scroll: inputTool('scroll', (input) => {
      if ((input.x === undefined) !== (input.y === undefined)) throw new Error('x and y go together')
      const at = input.x !== undefined && input.y !== undefined ? { x: input.x, y: input.y } : undefined
      return daemon.POST('/v1/leases/{lease}/scroll', { params: { path, query }, body: { direction: input.direction, ticks: input.ticks, at } })
    }),
    key: inputTool('key', (input) => daemon.POST('/v1/leases/{lease}/key', { params: { path, query }, body: { key: input.key } })),
    type: inputTool('type', (input) => daemon.POST('/v1/leases/{lease}/type', { params: { path, query }, body: { text: input.text, enter: input.enter ?? false } })),
    unlock: inputTool('unlock', (input) => daemon.POST('/v1/leases/{lease}/unlock', { params: { path, query }, body: { passcode: input.passcode } })),
  }
}

export type PhoneTools = ReturnType<typeof createPhoneTools>

const WEBFETCH_MAX_CHARS = 20_000
const WEBFETCH_TIMEOUT_MS = 15_000

/** streamText options shared by the Durable Object and the bench script. */
export function taskStreamOptions({ apiKey, daemon, lease, phone }: { apiKey: string; daemon: DaemonClient; lease: string; phone?: TaskPhone }) {
  // AI SDK web fetch: markdown or HTML converted by defuddle, `offset` for long pages, no private addresses.
  const webfetch = createWebFetchTool({ maxLength: WEBFETCH_MAX_CHARS, timeout: WEBFETCH_TIMEOUT_MS })
  return {
    model: createTaskModel(apiKey),
    system: taskSystemPrompt(phone),
    tools: { ...createPhoneTools({ daemon, lease }), webfetch },
    stopWhen: isStepCount(MAX_TASK_STEPS),
    // Reasoning adds about a second per step and did not pick better actions.
    reasoning: 'none' as const,
    providerOptions: {
      // Anthropic caches only with explicit breakpoints: the gateway adds them (system, tools, history).
      gateway: { caching: 'auto' as const },
      // Haiku sends several taps or keys in one step; they would run in parallel, in any order.
      anthropic: { disableParallelToolUse: true },
    },
  }
}
