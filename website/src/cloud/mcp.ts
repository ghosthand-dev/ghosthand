// MCP tools for cloud iPhones: the hub (tunnel.ts) sends `tools/call` here for `cloud:<n>`
// leases and `mac: "cloud"`, and `list` fans out here too. Each tool calls the same ops as
// the REST routes (api.ts) and prints text like the daemon's MCP tools (daemon/.../mcp.swift),
// so an agent cannot tell a cloud iPhone from a USB one except where a tool is unsupported.
// Tool and argument names come from mcp-tools.json; mcp.test.ts checks every tool is covered.

import {
  CLOUD_NAME,
  CLOUD_SLUG,
  CloudProblem,
  acquire,
  catalog,
  deviceInfo,
  finishTask,
  installCatalogApp,
  key,
  launchApp,
  listApps,
  listDevices,
  lock,
  mute,
  release,
  rename,
  screenText,
  screenshot,
  scroll,
  startTask,
  swipe,
  tap,
  type,
  uninstallApp,
  unlock,
  wake,
  type ActionResult,
  type After,
  type CloudDevice,
  type Ctx,
  type ScreenText,
} from './api.ts'
import type { LeaseInfo } from './fleet.ts'

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type McpToolResult = { content: McpContent[]; isError: boolean }
type Args = Record<string, unknown>
type Handler = (ctx: Ctx, args: Args) => Promise<McpContent[] | CloudProblem>

const DEFAULT_WAIT_S = 600
const SECOND_MS = 1_000

/** Tools a cloud iPhone cannot do, with the one-line reason the agent reads. */
export const UNSUPPORTED_TOOLS: Record<string, string> = {
  'record-start': 'cloud iPhones cannot record video yet; take screenshots instead',
  'record-stop': 'cloud iPhones cannot record video yet',
  assistivetouch: 'cloud iPhones take touches directly; there is no AssistiveTouch pointer',
  control: 'cloud iPhones have one control mode',
  forget: 'cloud iPhones have no Bluetooth bond',
  random: 'random values are saved on a Mac; cloud iPhones have none',
  'file-list': 'files are not available on cloud iPhones yet',
  'file-pull': 'files are not available on cloud iPhones yet',
  'file-push': 'files are not available on cloud iPhones yet',
  'file-remove': 'files are not available on cloud iPhones yet',
  'photo-list': 'photos are not available on cloud iPhones yet',
  'photo-pull': 'photos are not available on cloud iPhones yet',
  'photo-delete': 'photos are not available on cloud iPhones yet',
  upload: 'upload runs on a Mac; cloud iPhones have none',
  logs: 'the system log is not available on cloud iPhones',
  restart: 'cloud iPhones restart by themselves when they move; release the lease instead',
  shutdown: 'cloud iPhones stop by themselves when idle; release the lease instead',
  setup: 'cloud iPhones need no setup: call list, then acquire one',
  account: 'the account runs on a Mac; see https://ghosthand.dev/dashboard for cloud iPhones',
}

const HANDLERS: Record<string, Handler> = {
  list: async (ctx) => [text(listLines(await listDevices(ctx)))],
  acquire: (ctx, args) => acquireTool(ctx, args, { force: optional(args, 'force', 'boolean') }),
  wait: (ctx, args) => acquireTool(ctx, args, { waitSeconds: optional(args, 'timeout', 'number') ?? DEFAULT_WAIT_S }),
  release: async (ctx, args) => message(await release(ctx, lease(args))),
  screenshot: async (ctx, args) => {
    const shot = await screenshot(ctx, { lease: lease(args), settle: optional(args, 'settle', 'boolean'), screentext: optional(args, 'screentext', 'boolean'), language: optional(args, 'language', 'string') })
    if (shot instanceof Error) return shot
    return [text(`${shot.width}x${shot.height}${shot.screen ? `\n${screenLines(shot.screen)}` : ''}`), image(shot.data)]
  },
  screentext: async (ctx, args) => {
    const screen = await screenText(ctx, {
      lease: lease(args), settle: optional(args, 'settle', 'boolean'), language: optional(args, 'language', 'string'),
      waitText: optional(args, 'waitText', 'string'), timeoutMs: optional(args, 'timeoutMs', 'number'),
    })
    return screen instanceof Error ? screen : [text(screenLines(screen))]
  },
  tap: (ctx, args) => tapTool(ctx, args, 'tap'),
  'double-tap': (ctx, args) => tapTool(ctx, args, 'double-tap'),
  'triple-tap': (ctx, args) => tapTool(ctx, args, 'triple-tap'),
  hold: (ctx, args) => tapTool(ctx, args, 'hold'),
  swipe: async (ctx, args) => actionContent(await swipe(ctx, { lease: lease(args), ...line(args), durationMs: optional(args, 'durationMs', 'number'), after: after(args) })),
  'hold-drag': async (ctx, args) => actionContent(await swipe(ctx, {
    lease: lease(args), ...line(args), durationMs: optional(args, 'durationMs', 'number'), holdMs: optional(args, 'holdMs', 'number') ?? SECOND_MS, after: after(args),
  })),
  scroll: async (ctx, args) => {
    const direction = required(args, 'direction', 'string')
    if (!['up', 'down', 'left', 'right'].includes(direction)) return new CloudProblem('invalid-request', 'direction must be up, down, left or right')
    const x = optional(args, 'x', 'number')
    const y = optional(args, 'y', 'number')
    if ((x === undefined) !== (y === undefined)) return new CloudProblem('invalid-request', 'x and y go together')
    return actionContent(await scroll(ctx, {
      lease: lease(args), direction: direction as 'up', ticks: required(args, 'ticks', 'number'),
      at: x !== undefined && y !== undefined ? { x, y } : undefined, after: after(args),
    }))
  },
  key: async (ctx, args) => actionContent(await key(ctx, { lease: lease(args), key: required(args, 'key', 'string'), after: after(args) })),
  type: async (ctx, args) => actionContent(await type(ctx, { lease: lease(args), text: required(args, 'text', 'string'), enter: optional(args, 'enter', 'boolean'), after: after(args) })),
  mute: async (ctx, args) => actionContent(await mute(ctx, { lease: lease(args), muted: true })),
  unmute: async (ctx, args) => actionContent(await mute(ctx, { lease: lease(args), muted: false })),
  wake: async (ctx, args) => actionContent(await wake(ctx, { lease: lease(args), after: after(args) })),
  lock: async (ctx, args) => actionContent(await lock(ctx, { lease: lease(args) })),
  unlock: async (ctx, args) => actionContent(await unlock(ctx, { lease: lease(args), passcode: required(args, 'passcode', 'string'), after: after(args) })),
  rename: async (ctx, args) => message(await rename(ctx, { lease: lease(args), name: required(args, 'name', 'string') })),
  task: async (ctx, args) => {
    const turn = await startTask(ctx, { lease: lease(args), prompt: optional(args, 'prompt', 'string'), task: optional(args, 'task', 'string') })
    if (turn instanceof Error) return turn
    const result = await finishTask(turn)
    if (result instanceof Error) return result
    return [text(`${result.text}\n\ntask ${result.task}: to continue it, call task with task "${result.task}"`)]
  },
  'app-list': async (ctx, args) => {
    const list = await listApps(ctx, { lease: lease(args), system: optional(args, 'system', 'boolean') })
    if (list instanceof Error) return list
    return [text(list.apps.length ? list.apps.map((a) => `${a.bundleId}  ${a.name}${a.version ? ` ${a.version}` : ''}${a.system ? '  [system]' : ''}`).join('\n') : 'no apps')]
  },
  'app-install': async (ctx, args) => {
    const app = optional(args, 'app', 'string')
    if (!app) return new CloudProblem('unsupported-in-mode', 'cloud iPhones install apps from the catalog only: call app-catalog, then app-install with app')
    return actionContent(await installCatalogApp(ctx, { lease: lease(args), app }))
  },
  'app-catalog': async (ctx, args) => {
    const list = await catalog(ctx, { lease: lease(args) })
    if (list instanceof Error) return list
    return [text(list.apps.length ? list.apps.map((a) => `${a.id}  ${a.name}  ${a.bundleId}${a.installed ? '  [installed]' : ''}`).join('\n') : 'the catalog is empty')]
  },
  'app-launch': async (ctx, args) => message(await launchApp(ctx, { lease: lease(args), bundleId: required(args, 'bundleId', 'string') })),
  'app-uninstall': async (ctx, args) => message(await uninstallApp(ctx, { lease: lease(args), bundleId: required(args, 'bundleId', 'string') })),
  info: async (ctx, args) => {
    const info = await deviceInfo(ctx, { lease: lease(args) })
    if (info instanceof Error) return info
    const lines = [`name: ${info.name}`, `udid: ${info.udid}`]
    if (info.model) lines.push(`model: ${info.modelName ? `${info.modelName} (${info.model})` : info.model}`)
    if (info.iosVersion) lines.push(`iOS: ${info.iosVersion}${info.build ? ` (${info.build})` : ''}`)
    return [text(lines.join('\n'))]
  },
  'setup-status': async (ctx) => {
    const devices = await listDevices(ctx)
    const ready = devices.some((d) => d.allowed)
    const next = ready
      ? `The cloud iPhone is ready: call list, then acquire it with mac "${CLOUD_SLUG}".`
      : 'The subscription of every cloud iPhone ended. Renew one on https://ghosthand.dev/dashboard: its data is kept.'
    return [text(JSON.stringify({ ready, next, macs: [{ slug: CLOUD_SLUG, name: CLOUD_NAME, online: true }] }))]
  },
}

/** Tool names this file answers, supported or not. */
export const CLOUD_TOOL_NAMES = new Set([...Object.keys(HANDLERS), ...Object.keys(UNSUPPORTED_TOOLS)])

/** One `tools/call` on the org's cloud iPhones. Errors are results, as only results reach the model. */
export async function callCloudTool({ ctx, name, args }: { ctx: Ctx; name: string; args: Args }): Promise<McpToolResult> {
  const unsupported = UNSUPPORTED_TOOLS[name]
  const handler = HANDLERS[name]
  let content: McpContent[] | CloudProblem
  try {
    content = unsupported ? new CloudProblem('unsupported-in-mode', unsupported)
      : handler ? await handler(ctx, args)
      : new CloudProblem('invalid-request', `unknown tool: ${name}`)
  } catch (error) {
    // Argument errors from required() and optional(); anything else is a bug and goes up.
    if (!(error instanceof CloudProblem)) throw error
    content = error
  }
  if (content instanceof CloudProblem) return { content: [text(`error ${content.code}: ${content.message}`)], isError: true }
  return { content, isError: false }
}

async function acquireTool(ctx: Ctx, args: Args, mode: { force?: boolean; waitSeconds?: number }): Promise<McpContent[] | CloudProblem> {
  const lease = await acquire(ctx, {
    reason: required(args, 'reason', 'string'), device: optional(args, 'device', 'string'), label: optional(args, 'label', 'string'),
    idleTimeoutSeconds: optional(args, 'idleTimeoutSeconds', 'number'), ...mode,
  })
  if (lease instanceof Error) return lease
  const replaced = lease.replaced ? `took the iPhone from ${describeLease(lease.replaced)}\n` : ''
  return [text(`${replaced}lease ${lease.id} on ${lease.deviceName} (${lease.phoneId}); it ends after ${lease.idleTimeoutS}s without a call. Pass lease "${lease.id}" to every tool; call release when done.`)]
}

async function tapTool(ctx: Ctx, args: Args, command: 'tap' | 'double-tap' | 'triple-tap' | 'hold'): Promise<McpContent[] | CloudProblem> {
  const x = optional(args, 'x', 'number')
  const y = optional(args, 'y', 'number')
  const target = optional(args, 'text', 'string')
  const index = optional(args, 'index', 'number')
  const point = x !== undefined && y !== undefined && target === undefined && index === undefined
  if (!point && (target === undefined || x !== undefined || y !== undefined)) {
    return new CloudProblem('invalid-request', `${command} needs x and y, or text (with an optional index)`)
  }
  const holdMs = command === 'hold' ? optional(args, 'durationMs', 'number') : undefined
  const request = point ? { x: x!, y: y!, holdMs } : { text: target!, index, holdMs }
  return actionContent(await tap(ctx, { lease: lease(args), command, request, after: after(args) }))
}

/** The daemon's input output: progress lines, the message with the screen text, the image. */
function actionContent(result: ActionResult | CloudProblem): McpContent[] | CloudProblem {
  if (result instanceof Error) return result
  const content: McpContent[] = result.logs.length ? [text(result.logs.join('\n'))] : []
  content.push(text(result.message + (result.screen ? `\n${screenLines(result.screen)}` : '')))
  if (result.screenshot) content.push(image(result.screenshot.data))
  return content
}

/** MCP screenshots are JPEG, like the daemon's. */
function after(args: Args): After {
  return {
    waitText: optional(args, 'waitText', 'string'), timeoutMs: optional(args, 'timeoutMs', 'number'),
    screenshot: optional(args, 'screenshot', 'boolean') ? 'jpeg' : undefined, screentext: optional(args, 'screentext', 'boolean'),
    language: optional(args, 'language', 'string'),
  }
}

function line(args: Args) {
  return {
    from: { x: required(args, 'x1', 'number'), y: required(args, 'y1', 'number') },
    to: { x: required(args, 'x2', 'number'), y: required(args, 'y2', 'number') },
  }
}

/** `list` for the hub's fan-out: one header per Mac, then one line per iPhone. */
export function listLines(devices: CloudDevice[], now = Date.now()): string {
  const header = `mac ${CLOUD_SLUG} (${CLOUD_NAME}):`
  if (!devices.length) return `${header}\nno iPhone`
  return [header, ...devices.map((d) => {
    const state = d.allowed ? `  (${d.state === 'stored' ? 'stopped, starts on acquire' : d.state})` : '  [subscription ended: renew on the dashboard]'
    const waiting = d.waiting.length ? `  [${d.waiting.length} waiting]` : ''
    return `${d.phoneId}  ${d.name}  ${d.modelName} (${d.model}) iOS ${d.iosVersion}${state}${d.lease ? `  [leased by ${describeLease(d.lease, now)}]` : ''}${waiting}`
  })].join('\n')
}

function describeLease(lease: LeaseInfo, now = Date.now()): string {
  const used = lease.lastCommand ? `last command ${lease.lastCommand} ${durationLabel(now - lease.lastUsedAt)} ago` : 'no command yet'
  return `${lease.label ? `"${lease.label}"` : 'an unlabeled client'} for "${lease.reason}": acquired ${durationLabel(now - lease.acquiredAt)} ago, `
    + `${used}, ends after ${durationLabel(lease.expiresAt - now)} idle`
}

/** 5s, 12m3s, 2h5m, like the daemon. */
function durationLabel(ms: number): string {
  const s = Math.max(0, Math.round(ms / SECOND_MS))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
}

function screenLines(screen: ScreenText): string {
  return screen.lines.map((l) => `${l.x},${l.y} ${l.width}x${l.height} ${l.text}`).join('\n')
}

function message(result: string | CloudProblem): McpContent[] | CloudProblem {
  return result instanceof Error ? result : [text(result)]
}

function text(value: string): McpContent {
  return { type: 'text', text: value }
}

function image(data: string): McpContent {
  return { type: 'image', data, mimeType: 'image/jpeg' }
}

function lease(args: Args): string {
  return required(args, 'lease', 'string')
}

type Kinds = { string: string; number: number; boolean: boolean }

function optional<K extends keyof Kinds>(args: Args, name: string, kind: K): Kinds[K] | undefined {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== kind) throw new CloudProblem('invalid-request', `${name} must be a ${kind}`)
  return value as Kinds[K]
}

function required<K extends keyof Kinds>(args: Args, name: string, kind: K): Kinds[K] {
  const value = optional(args, name, kind)
  if (value === undefined) throw new CloudProblem('invalid-request', `missing argument: ${name}`)
  return value
}
