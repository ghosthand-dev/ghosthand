// MCP tools for cloud iPhones: the hub (tunnel.ts) sends `tools/call` here for `cloud:<n>`
// leases and `mac: "cloud"`, and `list` fans out here too. Each tool calls the same ops as
// the REST routes (api.ts) and prints text like the daemon's MCP tools (daemon/.../mcp.swift),
// so an agent cannot tell a cloud iPhone from a USB one except where a tool is unsupported.
// Tools and arguments are typed from the daemon (src/generated/mcp-tools.ts, pnpm generate-docs):
// tsc fails until every tool is in HANDLERS or UNSUPPORTED_TOOLS and every argument is decided.

import manual from '../../mcp-tools.json'
import type { McpToolArgs, McpToolName } from '../generated/mcp-tools.ts'
import {
  CLOUD_NAME,
  CLOUD_SLUG,
  NO_NATIVE_SCREENSHOT,
  acquire,
  catalog,
  deviceInfo,
  finishTask,
  installCatalogApp,
  key,
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
import { CloudProblem } from './core.ts'
import type { LeaseInfo } from './fleet.ts'

export type McpContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type McpToolResult = { content: McpContent[]; isError: boolean }

const DEFAULT_WAIT_S = 600
const SECOND_MS = 1_000

/** Tools a cloud iPhone cannot do, with the one-line reason the agent reads. */
export const UNSUPPORTED_TOOLS = {
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
} satisfies Partial<Record<McpToolName, string>>

type UnsupportedTool = keyof typeof UNSUPPORTED_TOOLS
type SupportedTool = Exclude<McpToolName, UnsupportedTool>

/** A cloud tool. `args` names every argument of the daemon's tool: `true` when `run` reads it,
 *  else why the cloud ignores it, so a new daemon argument fails tsc until it is decided. */
type Tool<T extends McpToolName> = {
  args: { [K in keyof McpToolArgs[T]]-?: true | string }
  run: (ctx: Ctx, args: McpToolArgs[T]) => Promise<McpContent[] | CloudProblem>
}

/** Read by the hub, which routes the call by it; never by a tool. */
const MAC = 'the hub routes by it'
/** Checked for every tool in callCloudTool. */
const SCALE = 'callCloudTool refuses it: cloud iPhones use screen points only'
/** The arguments of every input tool (the daemon's AfterInput). */
const AFTER = {
  waitText: true, timeoutMs: true, screenshot: true, screentext: true, language: true, scale: SCALE, mac: MAC,
  fast: 'the host settles the screen itself, late dialogs included',
} as const
const TAP_ARGS = { lease: true, x: true, y: true, text: true, index: true, ...AFTER } as const

const HANDLERS: { [T in SupportedTool]: Tool<T> } = {
  list: { args: { mac: MAC }, run: async (ctx) => [text(listLines(await listDevices(ctx)))] },
  acquire: {
    args: { reason: true, device: true, label: true, idleTimeoutSeconds: true, force: true, mac: MAC },
    run: (ctx, { reason, device, label, idleTimeoutSeconds, force }) => acquireTool(ctx, { reason, device, label, idleTimeoutSeconds, force }),
  },
  wait: {
    args: { reason: true, device: true, label: true, idleTimeoutSeconds: true, timeout: true, mac: MAC },
    run: (ctx, { reason, device, label, idleTimeoutSeconds, timeout }) => acquireTool(ctx, { reason, device, label, idleTimeoutSeconds, waitSeconds: timeout ?? DEFAULT_WAIT_S }),
  },
  release: { args: { lease: true, mac: MAC }, run: async (ctx, args) => message(await release(ctx, args.lease)) },
  screenshot: {
    args: { lease: true, settle: true, screentext: true, language: true, native: true, scale: SCALE, mac: MAC },
    run: async (ctx, args) => {
      if (args.native) return new CloudProblem('unsupported-in-mode', NO_NATIVE_SCREENSHOT)
      const shot = await screenshot(ctx, args)
      if (shot instanceof Error) return shot
      return [text(`${shot.width}x${shot.height}${shot.screen ? `\n${screenLines(shot.screen)}` : ''}`), image(shot.data)]
    },
  },
  screentext: {
    args: { lease: true, settle: true, language: true, waitText: true, timeoutMs: true, scale: SCALE, mac: MAC },
    run: async (ctx, args) => {
      const screen = await screenText(ctx, args)
      return screen instanceof Error ? screen : [text(screenLines(screen))]
    },
  },
  tap: { args: TAP_ARGS, run: (ctx, args) => tapTool(ctx, args, 'tap') },
  'double-tap': { args: TAP_ARGS, run: (ctx, args) => tapTool(ctx, args, 'double-tap') },
  'triple-tap': { args: TAP_ARGS, run: (ctx, args) => tapTool(ctx, args, 'triple-tap') },
  hold: { args: { ...TAP_ARGS, durationMs: true }, run: (ctx, args) => tapTool(ctx, args, 'hold') },
  swipe: {
    args: { lease: true, x1: true, y1: true, x2: true, y2: true, durationMs: true, ...AFTER },
    run: async (ctx, args) => actionContent(await swipe(ctx, { lease: args.lease, ...line(args), durationMs: args.durationMs, after: after(args) })),
  },
  'hold-drag': {
    args: { lease: true, x1: true, y1: true, x2: true, y2: true, durationMs: true, holdMs: true, ...AFTER },
    run: async (ctx, args) => actionContent(await swipe(ctx, {
      lease: args.lease, ...line(args), durationMs: args.durationMs, holdMs: args.holdMs ?? SECOND_MS, after: after(args),
    })),
  },
  scroll: {
    args: { lease: true, direction: true, ticks: true, x: true, y: true, ...AFTER },
    run: async (ctx, args) => {
      const { x, y } = args
      if ((x === undefined) !== (y === undefined)) return new CloudProblem('invalid-request', 'x and y go together')
      const at = x !== undefined && y !== undefined ? { x, y } : undefined
      return actionContent(await scroll(ctx, { lease: args.lease, direction: args.direction, ticks: args.ticks, at, after: after(args) }))
    },
  },
  key: { args: { lease: true, key: true, ...AFTER }, run: async (ctx, args) => actionContent(await key(ctx, { lease: args.lease, key: args.key, after: after(args) })) },
  type: {
    args: { lease: true, text: true, enter: true, ...AFTER },
    run: async (ctx, args) => actionContent(await type(ctx, { lease: args.lease, text: args.text, enter: args.enter, after: after(args) })),
  },
  mute: { args: { lease: true, mac: MAC }, run: async (ctx, args) => actionContent(await mute(ctx, { lease: args.lease, muted: true })) },
  unmute: { args: { lease: true, mac: MAC }, run: async (ctx, args) => actionContent(await mute(ctx, { lease: args.lease, muted: false })) },
  wake: { args: { lease: true, ...AFTER }, run: async (ctx, args) => actionContent(await wake(ctx, { lease: args.lease, after: after(args) })) },
  lock: { args: { lease: true, mac: MAC }, run: async (ctx, args) => actionContent(await lock(ctx, { lease: args.lease })) },
  unlock: {
    args: { lease: true, passcode: true, ...AFTER },
    run: async (ctx, args) => actionContent(await unlock(ctx, { lease: args.lease, passcode: args.passcode, after: after(args) })),
  },
  rename: { args: { lease: true, name: true, mac: MAC }, run: async (ctx, args) => message(await rename(ctx, args)) },
  task: {
    args: { lease: true, prompt: true, task: true, mac: MAC },
    run: async (ctx, args) => {
      const turn = await startTask(ctx, args)
      if (turn instanceof Error) return turn
      const result = await finishTask(turn)
      if (result instanceof Error) return result
      return [text(`${result.text}\n\ntask ${result.task}: to continue it, call task with task "${result.task}"`)]
    },
  },
  'app-list': {
    args: { lease: true, system: true, mac: MAC },
    run: async (ctx, args) => {
      const list = await listApps(ctx, args)
      if (list instanceof Error) return list
      return [text(list.apps.length ? list.apps.map((a) => `${a.bundleId}  ${a.name}${a.version ? ` ${a.version}` : ''}${a.system ? '  [system]' : ''}`).join('\n') : 'no apps')]
    },
  },
  'app-install': {
    args: { lease: true, app: true, data: true, mac: MAC },
    run: async (ctx, args) => {
      if (args.data !== undefined || !args.app) return new CloudProblem('unsupported-in-mode', 'cloud iPhones install apps from the catalog only: call app-catalog, then app-install with app')
      return actionContent(await installCatalogApp(ctx, { lease: args.lease, app: args.app }))
    },
  },
  'app-catalog': {
    args: { lease: true, mac: MAC },
    run: async (ctx, args) => {
      const list = await catalog(ctx, args)
      if (list instanceof Error) return list
      return [text(list.apps.length ? list.apps.map((a) => `${a.id}  ${a.name}  ${a.bundleId}${a.installed ? '  [installed]' : ''}`).join('\n') : 'the catalog is empty')]
    },
  },
  'app-uninstall': { args: { lease: true, bundleId: true, mac: MAC }, run: async (ctx, args) => message(await uninstallApp(ctx, args)) },
  info: {
    args: { lease: true, mac: MAC },
    run: async (ctx, args) => {
      const info = await deviceInfo(ctx, args)
      if (info instanceof Error) return info
      const lines = [`name: ${info.name}`, `udid: ${info.udid}`]
      if (info.model) lines.push(`model: ${info.modelName ? `${info.modelName} (${info.model})` : info.model}`)
      if (info.iosVersion) lines.push(`iOS: ${info.iosVersion}${info.build ? ` (${info.build})` : ''}`)
      return [text(lines.join('\n'))]
    },
  },
  'setup-status': {
    args: { device: 'every cloud iPhone is ready once its subscription is active', mac: MAC },
    run: async (ctx) => {
      const devices = await listDevices(ctx)
      const ready = devices.some((d) => d.allowed)
      const next = ready
        ? `The cloud iPhone is ready: call list, then acquire it with mac "${CLOUD_SLUG}".`
        : 'The subscription of every cloud iPhone ended. Renew one on https://ghosthand.dev/dashboard: its data is kept.'
      return [text(JSON.stringify({ ready, next, macs: [{ slug: CLOUD_SLUG, name: CLOUD_NAME, online: true }] }))]
    },
  },
}

/** One `tools/call` on the org's cloud iPhones. Errors are results, as only results reach the model. */
export async function callCloudTool({ ctx, name, args }: { ctx: Ctx; name: string; args: Record<string, unknown> }): Promise<McpToolResult> {
  const content = await runTool({ ctx, name, args })
  if (content instanceof CloudProblem) return { content: [text(`error ${content.code}: ${content.message}`)], isError: true }
  return { content, isError: false }
}

async function runTool({ ctx, name, args }: { ctx: Ctx; name: string; args: Record<string, unknown> }): Promise<McpContent[] | CloudProblem> {
  if (Object.hasOwn(UNSUPPORTED_TOOLS, name)) return new CloudProblem('unsupported-in-mode', UNSUPPORTED_TOOLS[name as UnsupportedTool])
  if (!isSupported(name)) return new CloudProblem('invalid-request', `unknown tool: ${name}`)
  return runSupported({ ctx, name, args })
}

function isSupported(name: string): name is SupportedTool {
  return Object.hasOwn(HANDLERS, name)
}

async function runSupported<T extends SupportedTool>({ ctx, name, args }: { ctx: Ctx; name: T; args: Record<string, unknown> }): Promise<McpContent[] | CloudProblem> {
  const checked = checkArgs({ name, args })
  if (checked instanceof Error) return checked
  if ('scale' in checked) return new CloudProblem('unsupported-in-mode', 'cloud iPhones use screen points only: omit scale')
  const tool: Tool<T> = HANDLERS[name]
  return tool.run(ctx, checked)
}

type ArgSchema = { type: string; enum?: string[]; items?: { type: string } }
const SCHEMAS = new Map<string, { properties: Record<string, ArgSchema | undefined>; required: string[] }>(manual.tools.map((t) => [t.name, t.inputSchema]))

/** The arguments checked against the tool's inputSchema (mcp-tools.json, the source of
 *  McpToolArgs), with the daemon's messages (`MCPArgs`). Nulls are dropped, `mac` is the hub's. */
function checkArgs<T extends McpToolName>({ name, args }: { name: T; args: Record<string, unknown> }): McpToolArgs[T] | CloudProblem {
  const schema = SCHEMAS.get(name)
  if (!schema) return new CloudProblem('invalid-request', `unknown tool: ${name}`)
  const checked: Record<string, unknown> = {}
  for (const key of Object.keys(args).sort()) {
    const value = args[key]
    if (key === 'mac' || value === undefined || value === null) continue
    const arg = schema.properties[key]
    if (!arg) return new CloudProblem('invalid-request', `unknown argument: ${key}`)
    // Models often send the lease as a number, like the daemon accepts.
    const coerced = key === 'lease' && typeof value === 'number' && Number.isInteger(value) ? String(value) : value
    const problem = argProblem({ key, value: coerced, arg })
    if (problem) return new CloudProblem('invalid-request', problem)
    checked[key] = coerced
  }
  const missing = schema.required.find((key) => checked[key] === undefined)
  if (missing) return new CloudProblem('invalid-request', `${missing} is required`)
  return checked as McpToolArgs[T]
}

function argProblem({ key, value, arg }: { key: string; value: unknown; arg: ArgSchema }): string | undefined {
  if (arg.enum && !arg.enum.includes(String(value))) return `${key} must be one of: ${arg.enum.join(', ')}`
  if (arg.type === 'string' && typeof value !== 'string') return `${key} must be a string`
  if (arg.type === 'boolean' && typeof value !== 'boolean') return `${key} must be true or false`
  if ((arg.type === 'number' || arg.type === 'integer') && (typeof value !== 'number' || !Number.isFinite(value))) return `${key} must be a number`
  if (arg.type === 'integer' && !Number.isInteger(value)) return `${key} must be a whole number`
  if (arg.type === 'array' && !(Array.isArray(value) && value.every((item) => typeof item === arg.items?.type))) return `${key} must be a list of ${arg.items?.type ?? 'values'}s`
  return undefined
}

async function acquireTool(ctx: Ctx, args: { reason: string; device?: string; label?: string; idleTimeoutSeconds?: number; force?: boolean; waitSeconds?: number }): Promise<McpContent[] | CloudProblem> {
  const lease = await acquire(ctx, args)
  if (lease instanceof Error) return lease
  const replaced = lease.replaced ? `took the iPhone from ${describeLease(lease.replaced)}\n` : ''
  return [text(`${replaced}lease ${lease.id} on ${lease.deviceName} (${lease.phoneId}); it ends after ${lease.idleTimeoutS}s without a call. Pass lease "${lease.id}" to every tool; call release when done.`)]
}

type TapArgs = McpToolArgs['tap'] & { durationMs?: number }

async function tapTool(ctx: Ctx, args: TapArgs, command: 'tap' | 'double-tap' | 'triple-tap' | 'hold'): Promise<McpContent[] | CloudProblem> {
  const { x, y, text: target, index } = args
  const point = x !== undefined && y !== undefined && target === undefined && index === undefined
  if (!point && (target === undefined || x !== undefined || y !== undefined)) {
    return new CloudProblem('invalid-request', `${command} needs x and y, or text (with an optional index)`)
  }
  const holdMs = command === 'hold' ? args.durationMs : undefined
  const request = point ? { x: x!, y: y!, holdMs } : { text: target!, index, holdMs }
  return actionContent(await tap(ctx, { lease: args.lease, command, request, after: after(args) }))
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
function after(args: { waitText?: string; timeoutMs?: number; screenshot?: boolean; screentext?: boolean; language?: string }): After {
  return { waitText: args.waitText, timeoutMs: args.timeoutMs, screenshot: args.screenshot ? 'jpeg' : undefined, screentext: args.screentext, language: args.language }
}

function line(args: { x1: number; y1: number; x2: number; y2: number }) {
  return { from: { x: args.x1, y: args.y1 }, to: { x: args.x2, y: args.y2 } }
}

/** `list` for the hub's fan-out: one header per Mac, then one line per iPhone. */
export function listLines(devices: CloudDevice[], now = Date.now()): string {
  const header = `mac ${CLOUD_SLUG} (${CLOUD_NAME}):`
  if (!devices.length) return `${header}\nno iPhone`
  return [header, ...devices.map((d) => {
    const state = d.allowed ? `  (${d.state === 'stopped' ? 'stopped, starts on acquire' : d.state})` : '  [subscription ended: renew on the dashboard]'
    return `${d.phoneId}  ${d.name}  ${d.modelName} (${d.model}) iOS ${d.iosVersion}${state}${d.lease ? `  [leased by ${describeLease(d.lease, now)}]` : ''}`
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
