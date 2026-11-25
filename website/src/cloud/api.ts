// The ghosthand daemon API for cloud iPhones, translated to vphone.sock lines and vphoned RPC.
// A cloud iPhone is one more Mac, slug `cloud`, so every client that speaks the daemon API
// (the CLI through lease forwarding, scripts, phone tasks) works unchanged:
//
//   /macs/cloud/v1/... (tunnel.ts) ──> cloudApi() ──> ops below ──> CloudFleet (lease check)
//   MCP tools for cloud:<n> (mcp.ts) ──────────────────┘   │
//   task tools: GhosthandHub.daemonFetch('cloud') ─────────┘   └──> host.ts sock ──> vphone.sock
//
// Coordinates are screen points on both sides (vphoned gestures and the daemon's default
// scale). The website is the only tenant gate: only the routes below exist, never a raw RPC.
// Types come from the daemon's OpenAPI (src/generated/daemon-api.ts).

import { generateId, type UIMessage, type UIMessageChunk } from 'ai'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { z } from 'zod'
import { getDb } from '../db.ts'
import type { components } from '../generated/daemon-api.ts'
import { getTask } from '../task.ts'
import type { TaskPhone } from '../task-agent.ts'
import { catalogApp, publicCatalog } from './apps.ts'
import { getFleet, type FleetPhone, type LeaseInfo, type LeaseTarget, type LeaseView } from './fleet.ts'
import { hostClient, type Json, type SockLine, type SockReply } from './host.ts'
import { DEFAULT_IDLE_TIMEOUT_S } from './scheduler.ts'
import { presignPhonesGet, templateInfo } from './storage.ts'

type Schemas = components['schemas']
export type Device = Schemas['Device']
export type ScreenText = Schemas['ScreenText']
export type ActionResult = Schemas['ActionResult']
export type ProblemCode = Schemas['Problem']['code']

export const CLOUD_SLUG = 'cloud'
export const CLOUD_NAME = 'Cloud'
const OCR_POLL_MS = 150
const DEFAULT_WAIT_TEXT_MS = 5_000
const MAX_WAIT_TEXT_MS = 60_000
const DEFAULT_HOLD_MS = 1_000
const DEFAULT_DRAG_MS = 1_000
const DEFAULT_SWIPE_MS = 150
/** Screen points one wheel tick scrolls on a USB iPhone (`ghosthand scroll --help`). */
const POINTS_PER_TICK = 100
/** A scroll drag covers at most this much of the screen height; longer scrolls repeat it. */
const SCROLL_STROKE_FRACTION = 0.6
const SCROLL_STROKE_MS = 400
const TAP_GAP_MS = 120
const TAP_PRESS_MS = 80
const IPA_URL_EXPIRY_S = 3600
const KEEPALIVE_MS = 15_000
const MAX_NAME_LENGTH = 100
const MS_PER_S = 1_000

const PROBLEMS: Partial<Record<ProblemCode, [status: number, title: string]>> = {
  'invalid-request': [400, 'Invalid request'],
  'not-found': [404, 'Not found'],
  'device-not-found': [404, 'Device not found'],
  'no-device': [404, 'No iPhone connected'],
  'multiple-devices': [409, 'Several iPhones connected'],
  'text-not-found': [404, 'Text not on screen'],
  'wait-text-timeout': [504, 'Expected text did not appear'],
  'lease-invalid': [403, 'Lease not valid'],
  'device-leased': [409, 'iPhone leased by another client'],
  'subscription-required': [402, 'Subscription required'],
  'unsupported-in-mode': [409, 'Not available in this control mode'],
  'tunnel-offline': [503, 'Tunnel offline'],
  'task-failed': [502, 'Task failed'],
  'cancelled': [499, 'Client closed request'],
  'internal-error': [500, 'Internal error'],
}

/** A daemon problem (`application/problem+json`), returned as a value by every op. */
export class CloudProblem extends Error {
  readonly code: ProblemCode
  readonly status: number
  readonly title: string
  constructor(code: ProblemCode, detail: string) {
    super(detail)
    this.name = 'CloudProblem'
    const [status, title] = PROBLEMS[code] ?? [500, 'Internal error']
    this.code = code
    this.status = status
    this.title = title
  }

  get body(): Schemas['Problem'] {
    return { code: this.code, title: this.title, status: this.status, detail: this.message }
  }
}

export type Ctx = { orgId: string; signal: AbortSignal }

/** One of the org's cloud iPhones: what was bought (Postgres) and where it runs (CloudFleet). */
export type CloudDevice = FleetPhone & { name: string; model: string; modelName: string; iosVersion: string }

/** Input options every input route takes after the input (daemon `AfterInput`). */
export type After = { waitText?: string; timeoutMs?: number; screenshot?: 'png' | 'jpeg'; screentext?: boolean; language?: string }

type Phone = LeaseTarget & { n: number; sock(line: SockLine): Promise<SockReply | CloudProblem> }
/** The last vphone.sock line of an input, sent with the screen request; what ran before it is done. */
type FinalInput = { line: SockLine; message: string; logs?: string[] }

// ── devices and leases ──

export async function listDevices(ctx: Ctx): Promise<CloudDevice[]> {
  const [phones, rows] = await Promise.all([
    getFleet().devices({ orgId: ctx.orgId }),
    getDb().query.cloudPhone.findMany({ where: { orgId: ctx.orgId }, columns: { cloudPhoneId: true, name: true } }),
  ])
  const names = new Map(rows.map((row) => [row.cloudPhoneId, row.name]))
  return phones.map((phone) => {
    const template = templateInfo(phone.template)
    return { ...phone, name: names.get(phone.phoneId) ?? phone.phoneId, model: template.model, modelName: template.modelName, iosVersion: template.iosVersion }
  })
}

/** `device`: a phone id, a name, or `default` (the only one). Like the daemon's device lookup. */
export function pickDevice({ devices, device }: { devices: CloudDevice[]; device?: string }): CloudDevice | CloudProblem {
  if (!devices.length) return new CloudProblem('no-device', 'this account has no cloud iPhone. Rent one on https://ghosthand.dev/dashboard.')
  if (!device || device === 'default') {
    if (devices.length === 1) return devices[0]!
    return new CloudProblem('multiple-devices', `this account has ${devices.length} cloud iPhones: pass device (one of: ${devices.map((d) => `${d.phoneId} "${d.name}"`).join(', ')})`)
  }
  const found = devices.find((d) => d.phoneId === device) ?? devices.find((d) => d.name.toLowerCase() === device.toLowerCase())
  return found ?? new CloudProblem('device-not-found', `no cloud iPhone "${device}". Cloud iPhones: ${devices.map((d) => `${d.phoneId} "${d.name}"`).join(', ')}`)
}

export type AcquireInput = { device?: string; label?: string; reason: string; idleTimeoutSeconds?: number; waitSeconds?: number; force?: boolean }
export type CloudLease = Omit<LeaseView, 'n'> & { id: string; deviceName: string }

/** Takes the phone; starts it first when it is stopped (seconds to minutes). */
export async function acquire(ctx: Ctx, input: AcquireInput): Promise<CloudLease | CloudProblem> {
  if (input.force && input.waitSeconds !== undefined) return new CloudProblem('invalid-request', 'force cannot be combined with waitSeconds')
  const device = pickDevice({ devices: await listDevices(ctx), device: input.device })
  if (device instanceof Error) return device
  const fleet = getFleet()
  const { waiterId, result: now } = await fleet.acquire({
    orgId: ctx.orgId, phoneId: device.phoneId, label: input.label, reason: input.reason,
    idleTimeoutS: input.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_S, waitS: input.waitSeconds, force: input.force,
  })
  // A signal does not cross Durable Object RPC: a client that goes away cancels its wait here.
  const onAbort = () => void fleet.cancel({ waiterId })
  ctx.signal.addEventListener('abort', onAbort, { once: true })
  const result = now ?? await fleet.waitFor({ waiterId })
  ctx.signal.removeEventListener('abort', onAbort)
  if (!result.ok) return new CloudProblem(result.code, result.detail)
  const { n, ...lease } = result.lease
  return { ...lease, id: leaseId(n), deviceName: device.name }
}

export async function release(ctx: Ctx, lease: string): Promise<string | CloudProblem> {
  const n = parseLease(lease)
  if (n instanceof Error) return n
  return await getFleet().release({ orgId: ctx.orgId, n }) ? 'lease released' : 'lease was already ended (expired, released, or taken with --force)'
}

export function leaseId(n: number): string {
  return `${CLOUD_SLUG}:${n}`
}

/** `cloud:7` or `7`, as the daemon accepts its own prefix. */
export function parseLease(lease: string): number | CloudProblem {
  const match = lease.match(/^(?:([a-z0-9-]+):)?([1-9][0-9]*)$/)
  if (!match || (match[1] !== undefined && match[1] !== CLOUD_SLUG)) {
    return new CloudProblem('lease-invalid', `lease ${lease} is not a cloud lease. Pass the lease exactly as acquire printed it, e.g. cloud:7`)
  }
  return Number(match[2])
}

async function openLease(ctx: Ctx, { lease, command }: { lease: string; command: string }): Promise<Phone | CloudProblem> {
  const n = parseLease(lease)
  if (n instanceof Error) return n
  const target = await getFleet().lease({ orgId: ctx.orgId, n, command })
  if (!target) return new CloudProblem('lease-invalid', `lease ${leaseId(n)} is unknown, expired or released. Acquire the cloud iPhone again.`)
  const client = hostClient(target.address)
  return {
    ...target,
    n,
    async sock(line) {
      const reply = await client.sock({ phoneId: target.phoneId, line, signal: ctx.signal })
      if (reply instanceof Error) return new CloudProblem('internal-error', `the cloud iPhone did not answer: ${reply.message}`)
      if (!reply.ok) return new CloudProblem('internal-error', `the cloud iPhone refused ${String(line.method ?? line.t)}: ${reply.error ?? 'no reason given'}`)
      return reply
    },
  }
}

async function rpc(phone: Phone, method: string, params: { [key: string]: Json } = {}): Promise<Record<string, unknown> | CloudProblem> {
  const reply = await phone.sock({ t: 'rpc', method, params, screen: false })
  if (reply instanceof Error) return reply
  return reply.result ?? {}
}

const rpcLine = (method: string, params: { [key: string]: Json }): SockLine => ({ t: 'rpc', method, params })

// ── screen ──

export type Screenshot = { data: string; width: number; height: number; screen?: ScreenText }

export async function screenshot(ctx: Ctx, { lease, settle, screentext, language }: { lease: string; settle?: boolean; screentext?: boolean; language?: string }): Promise<Screenshot | CloudProblem> {
  const phone = await openLease(ctx, { lease, command: 'screenshot' })
  if (phone instanceof Error) return phone
  const shot = await captureScreen(phone, { settle: settle ?? false })
  if (shot instanceof Error || !screentext) return shot
  const screen = await readScreen(phone, { language })
  if (screen instanceof Error) return screen
  return { ...shot, screen }
}

export async function screenText(ctx: Ctx, { lease, settle, language, waitText, timeoutMs }: { lease: string; settle?: boolean; language?: string; waitText?: string; timeoutMs?: number }): Promise<ScreenText | CloudProblem> {
  const phone = await openLease(ctx, { lease, command: 'screentext' })
  if (phone instanceof Error) return phone
  if (waitText) {
    const found = await waitForText(ctx, phone, { text: waitText, timeoutMs, language })
    if (found instanceof Error || !settle) return found
  }
  if (settle) {
    const shot = await captureScreen(phone, { settle: true })
    if (shot instanceof Error) return shot
  }
  return readScreen(phone, { language })
}

async function captureScreen(phone: Phone, { settle }: { settle: boolean }): Promise<Screenshot | CloudProblem> {
  const reply = await phone.sock({ t: 'screenshot', settle })
  if (reply instanceof Error) return reply
  return imageOf(reply) ?? new CloudProblem('internal-error', 'the cloud iPhone sent no screen image')
}

function imageOf(reply: SockReply): Screenshot | null {
  if (!reply.image) return null
  const size = jpegSize(base64Bytes(reply.image))
  return size && { data: reply.image, ...size }
}

async function readScreen(phone: Phone, { language }: { language?: string }): Promise<ScreenText | CloudProblem> {
  const result = await rpc(phone, 'ui.ocr', { languages: ['en-US', ...(language && language !== 'en-US' ? [language] : [])] })
  if (result instanceof Error) return result
  return ocrScreen({ result, screen: templateInfo(phone.template).screen })
}

const ocrBlocks = z.array(z.object({ text: z.string(), confidence: z.number(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }).loose())
const appRows = z.array(z.object({ bundle_id: z.string(), name: z.string().optional(), version: z.string().optional(), type: z.string().optional() }).loose())

/** vphoned OCR blocks (box centers in points) as daemon lines (top-left corners), top to bottom. */
export function ocrScreen({ result, screen }: { result: Record<string, unknown>; screen: { width: number; height: number } }): ScreenText | CloudProblem {
  const parsed = ocrBlocks.safeParse(result.blocks)
  if (!parsed.success) return new CloudProblem('internal-error', `the cloud iPhone sent OCR blocks of an unknown shape: ${parsed.error.message}`)
  const lines = parsed.data.map((b) => ({
    text: b.text, x: Math.round(b.x - b.width / 2), y: Math.round(b.y - b.height / 2),
    width: Math.round(b.width), height: Math.round(b.height), confidence: Math.round(b.confidence * 100) / 100,
  })).sort((a, b) => a.y - b.y || a.x - b.x)
  return { width: screen.width, height: screen.height, lines }
}

async function waitForText(ctx: Ctx, phone: Phone, { text, timeoutMs, language }: { text: string; timeoutMs?: number; language?: string }): Promise<ScreenText | CloudProblem> {
  const timeout = Math.min(timeoutMs ?? DEFAULT_WAIT_TEXT_MS, MAX_WAIT_TEXT_MS)
  const deadline = Date.now() + timeout
  const needle = text.toLowerCase()
  let reads = 0
  for (;;) {
    if (ctx.signal.aborted) return new CloudProblem('cancelled', 'the client went away')
    const screen = await readScreen(phone, { language })
    if (screen instanceof Error) return screen
    reads++
    if (screen.lines.some((line) => line.text.toLowerCase().includes(needle))) return screen
    if (Date.now() + OCR_POLL_MS > deadline) {
      return new CloudProblem('wait-text-timeout', `"${text}" did not appear in ${timeout} ms (${reads} OCR reads). The input was sent: never repeat it blindly; read the screen first.`)
    }
    await sleep({ ms: OCR_POLL_MS, signal: ctx.signal })
  }
}

/** The daemon's rule: lines equal to the text win over lines that contain it; several need `index`. */
export function pickText({ lines, text, index }: { lines: ScreenText['lines']; text: string; index?: number }): ScreenText['lines'][number] | CloudProblem {
  const query = text.toLowerCase()
  const exact = lines.filter((line) => line.text.toLowerCase() === query)
  const matches = (exact.length ? exact : lines.filter((line) => line.text.toLowerCase().includes(query))).sort((a, b) => a.y - b.y || a.x - b.x)
  if (!matches.length) return new CloudProblem('text-not-found', `no text "${text}" on screen (${lines.length} OCR lines; run \`ghosthand screentext\` to see them)`)
  if (index !== undefined) {
    return matches[index - 1] ?? new CloudProblem('invalid-request', `index must be 1...${matches.length}`)
  }
  if (matches.length === 1) return matches[0]!
  const list = matches.map((line, i) => `  ${i + 1}. ${line.x},${line.y} ${line.text}`).join('\n')
  return new CloudProblem('invalid-request', `${matches.length} lines match "${text}"; pick one with index (CLI: --index):\n${list}`)
}

// ── input ──

/** Runs an input, then the steps after it (waitText, then the settled screen and its text). */
async function input(ctx: Ctx, { lease, command, after, prepare }: { lease: string; command: string; after: After; prepare: (phone: Phone) => Promise<FinalInput | CloudProblem> }): Promise<ActionResult | CloudProblem> {
  const phone = await openLease(ctx, { lease, command })
  if (phone instanceof Error) return phone
  const final = await prepare(phone)
  if (final instanceof Error) return final
  // The host settles best on the input line itself: it saw the screen before the input.
  const settleOnInput = !!after.screenshot && !after.waitText
  const reply = await phone.sock({ ...final.line, ...(settleOnInput ? { screen: true, settle: true } : { screen: false }) })
  if (reply instanceof Error) return reply
  const result: ActionResult = { message: final.message, logs: final.logs ?? [] }
  const sent = (problem: CloudProblem) => new CloudProblem(problem.code, `${final.message}, then: ${problem.message}`)
  if (after.waitText) {
    const found = await waitForText(ctx, phone, { text: after.waitText, timeoutMs: after.timeoutMs, language: after.language })
    if (found instanceof Error) return sent(found)
  }
  if (after.screenshot) {
    const shot = settleOnInput ? imageOf(reply) : await captureScreen(phone, { settle: true })
    if (shot instanceof Error) return sent(shot)
    if (!shot) return sent(new CloudProblem('internal-error', 'the cloud iPhone sent no screen image'))
    result.screenshot = { format: 'jpeg', width: shot.width, height: shot.height, data: shot.data }
  }
  if (after.screentext) {
    const screen = await readScreen(phone, { language: after.language })
    if (screen instanceof Error) return sent(screen)
    result.screen = screen
  }
  return result
}

export type TapInput = ({ x: number; y: number } | { text: string; index?: number }) & { clicks?: 1 | 2 | 3; holdMs?: number }

export function tap(ctx: Ctx, { lease, command, request, after }: { lease: string; command: 'tap' | 'double-tap' | 'triple-tap' | 'hold'; request: TapInput; after: After }) {
  return input(ctx, {
    lease, command, after,
    prepare: async (phone) => {
      const logs: string[] = []
      let point = 'x' in request ? { x: request.x, y: request.y } : null
      if (!point && 'text' in request) {
        const screen = await readScreen(phone, { language: after.language })
        if (screen instanceof Error) return screen
        const line = pickText({ lines: screen.lines, text: request.text, index: request.index })
        if (line instanceof Error) return line
        point = { x: Math.round(line.x + line.width / 2), y: Math.round(line.y + line.height / 2) }
        logs.push(`found "${line.text}" at ${point.x},${point.y}`)
      }
      const { x, y } = point!
      if (command === 'hold') {
        const ms = request.holdMs ?? DEFAULT_HOLD_MS
        return { line: rpcLine('input.long_press', { x, y, seconds: ms / MS_PER_S }), message: `held ${x},${y} for ${ms} ms`, logs }
      }
      if (command === 'double-tap') return { line: rpcLine('input.double_tap', { x, y }), message: `double-tapped ${x},${y}`, logs }
      if (command === 'triple-tap') {
        const events = [0, 1, 2].flatMap((i) => [
          { phase: 'down', x, y, delay_ms: i === 0 ? 0 : TAP_GAP_MS },
          { phase: 'up', x, y, delay_ms: TAP_PRESS_MS },
        ])
        return { line: rpcLine('input.touch_sequence', { events, normalized: false }), message: `triple-tapped ${x},${y}`, logs }
      }
      return { line: rpcLine('input.tap', { x, y }), message: `tapped ${x},${y}`, logs }
    },
  })
}

type Point = { x: number; y: number }

export function swipe(ctx: Ctx, { lease, from, to, durationMs, holdMs, after }: { lease: string; from: Point; to: Point; durationMs?: number; holdMs?: number; after: After }) {
  const drag = holdMs !== undefined
  return input(ctx, {
    lease, command: drag ? 'hold-drag' : 'swipe', after,
    prepare: async () => {
      const route = `${from.x},${from.y} to ${to.x},${to.y}`
      if (drag) {
        const ms = durationMs ?? DEFAULT_DRAG_MS
        return { line: rpcLine('input.drag', { points: [[from.x, from.y], [to.x, to.y]], hold: holdMs / MS_PER_S, seconds: ms / MS_PER_S }), message: `held ${holdMs} ms, dragged ${route}` }
      }
      const ms = durationMs ?? DEFAULT_SWIPE_MS
      return { line: rpcLine('input.swipe', { from: [from.x, from.y], to: [to.x, to.y], seconds: ms / MS_PER_S }), message: `swiped ${route}` }
    },
  })
}

export function scroll(ctx: Ctx, { lease, direction, ticks, at, after }: { lease: string; direction: 'up' | 'down' | 'left' | 'right'; ticks: number; at?: Point; after: After }) {
  return input(ctx, {
    lease, command: 'scroll', after,
    prepare: async (phone) => {
      const lines = scrollStrokes({ direction, ticks, at, screen: templateInfo(phone.template).screen })
      for (const line of lines.slice(0, -1)) {
        const done = await phone.sock({ ...line, screen: false })
        if (done instanceof Error) return done
      }
      return { line: lines.at(-1)!, message: `scrolled ${direction} ${ticks} ticks` }
    },
  })
}

/** Wheel ticks as slow drags (no fling): `down` shows content further down, so the finger moves up. */
export function scrollStrokes({ direction, ticks, at, screen }: { direction: 'up' | 'down' | 'left' | 'right'; ticks: number; at?: Point; screen: { width: number; height: number } }): SockLine[] {
  const center = at ?? { x: Math.round(screen.width / 2), y: Math.round(screen.height / 2) }
  const vertical = direction === 'up' || direction === 'down'
  const stroke = Math.round((vertical ? screen.height : screen.width) * SCROLL_STROKE_FRACTION)
  const sign = direction === 'down' || direction === 'right' ? -1 : 1
  const lines: SockLine[] = []
  for (let left = ticks * POINTS_PER_TICK; left > 0; left -= stroke) {
    const half = Math.min(left, stroke) / 2
    const [from, to] = vertical
      ? [[center.x, center.y - sign * half], [center.x, center.y + sign * half]]
      : [[center.x - sign * half, center.y], [center.x + sign * half, center.y]]
    lines.push(rpcLine('input.swipe', { from: from!.map(Math.round), to: to!.map(Math.round), seconds: SCROLL_STROKE_MS / MS_PER_S }))
  }
  return lines
}

const BUTTON_KEYS: Record<string, string> = { home: 'home', volumeup: 'volume-up', volumedown: 'volume-down' }
const KEY_NAMES: Record<string, string> = { enter: 'return', esc: 'escape' }

export function key(ctx: Ctx, { lease, key, after }: { lease: string; key: string; after: After }) {
  return input(ctx, {
    lease, command: 'key', after,
    prepare: async () => {
      const name = key.toLowerCase()
      if (name === 'mute') return new CloudProblem('invalid-request', 'the Mute key is a toggle: use mute or unmute')
      if (name === 'playpause') return new CloudProblem('unsupported-in-mode', 'cloud iPhones have no media keys')
      const button = BUTTON_KEYS[name]
      if (button) return { line: rpcLine('input.button', { name: button }), message: `pressed ${name}` }
      const keyName = name.split('+').map((part) => KEY_NAMES[part] ?? part).join('+')
      return { line: rpcLine('input.key', { name: keyName }), message: `pressed ${name}` }
    },
  })
}

export function type(ctx: Ctx, { lease, text, enter, after }: { lease: string; text: string; enter?: boolean; after: After }) {
  return input(ctx, {
    lease, command: 'type', after,
    prepare: async (phone) => {
      const message = `typed ${text.length} characters${enter ? ' and Enter' : ''}`
      if (!enter) return { line: rpcLine('input.type', { text }), message }
      if (text) {
        const typed = await rpc(phone, 'input.type', { text })
        if (typed instanceof Error) return typed
      }
      return { line: rpcLine('input.key', { name: 'return' }), message }
    },
  })
}

export function wake(ctx: Ctx, { lease, after }: { lease: string; after: After }) {
  return input(ctx, { lease, command: 'wake', after, prepare: async () => ({ line: rpcLine('input.button', { name: 'wake' }), message: 'woke the screen' }) })
}

export function lock(ctx: Ctx, { lease }: { lease: string }) {
  return input(ctx, { lease, command: 'lock', after: {}, prepare: async () => ({ line: rpcLine('input.button', { name: 'power' }), message: 'locked' }) })
}

export function unlock(ctx: Ctx, { lease, passcode, after }: { lease: string; passcode: string; after: After }) {
  return input(ctx, { lease, command: 'unlock', after, prepare: async () => ({ line: rpcLine('screen.unlock', { passcode }), message: 'unlocked' }) })
}

/** The Mute button toggles: read the state first, press only to change it. */
export function mute(ctx: Ctx, { lease, muted }: { lease: string; muted: boolean }) {
  return input(ctx, {
    lease, command: muted ? 'mute' : 'unmute', after: {},
    prepare: async (phone) => {
      const audio = await rpc(phone, 'audio.state')
      if (audio instanceof Error) return audio
      const message = muted ? 'muted' : 'unmuted'
      if (audio.active_muted === muted) return { line: rpcLine('audio.state', {}), message: `already ${message}` }
      return { line: rpcLine('input.button', { name: 'mute' }), message }
    },
  })
}

// ── apps, info, name ──

export async function listApps(ctx: Ctx, { lease, system }: { lease: string; system?: boolean }): Promise<Schemas['AppList'] | CloudProblem> {
  const phone = await openLease(ctx, { lease, command: 'app list' })
  if (phone instanceof Error) return phone
  const result = await rpc(phone, 'apps.list', { filter: system ? 'all' : 'user' })
  if (result instanceof Error) return result
  const parsed = appRows.safeParse(result.apps)
  if (!parsed.success) return new CloudProblem('internal-error', `the cloud iPhone sent an app list of an unknown shape: ${parsed.error.message}`)
  return {
    apps: parsed.data
      .map((app) => ({ bundleId: app.bundle_id, name: app.name || app.bundle_id, ...(app.version ? { version: app.version } : {}), ...(app.type === 'system' ? { system: true } : {}) }))
      .sort((a, b) => Number(a.system ?? false) - Number(b.system ?? false) || a.name.localeCompare(b.name)),
  }
}

export async function uninstallApp(ctx: Ctx, { lease, bundleId }: { lease: string; bundleId: string }): Promise<string | CloudProblem> {
  const phone = await openLease(ctx, { lease, command: 'app uninstall' })
  if (phone instanceof Error) return phone
  const result = await rpc(phone, 'apps.uninstall', { bundle_id: bundleId, force: true })
  if (result instanceof Error) return result
  return `uninstalled ${bundleId}`
}

export async function launchApp(ctx: Ctx, { lease, bundleId }: { lease: string; bundleId: string }): Promise<string | CloudProblem> {
  const phone = await openLease(ctx, { lease, command: 'app launch' })
  if (phone instanceof Error) return phone
  const result = await rpc(phone, 'apps.launch', { bundle_id: bundleId })
  if (result instanceof Error) return result
  return `launched ${bundleId}${typeof result.warning === 'string' ? ` (${result.warning})` : ''}`
}

/** The catalog, with what the phone has installed. */
export async function catalog(ctx: Ctx, { lease }: { lease: string }): Promise<Schemas['CatalogAppList'] | CloudProblem> {
  const installed = await listApps(ctx, { lease })
  if (installed instanceof Error) return installed
  const bundles = new Set(installed.apps.map((app) => app.bundleId))
  return { apps: publicCatalog().apps.map((app) => ({ ...app, installed: bundles.has(app.bundleId) })) }
}

/** A catalog app: the host downloads the decrypted IPA from R2 (presigned), then vphoned installs it. */
export async function installCatalogApp(ctx: Ctx, { lease, app }: { lease: string; app: string }): Promise<ActionResult | CloudProblem> {
  const entry = catalogApp(app)
  if (!entry) return new CloudProblem('not-found', `no app "${app}" in the catalog. Apps: ${publicCatalog().apps.map((a) => a.id).join(', ')}`)
  const phone = await openLease(ctx, { lease, command: 'app install' })
  if (phone instanceof Error) return phone
  const path = `/var/mobile/Media/Downloads/${entry.id}.ipa`
  const url = await presignPhonesGet({ key: entry.key, expiresS: IPA_URL_EXPIRY_S })
  const pushed = await hostClient(phone.address).pushUrl({ phoneId: phone.phoneId, url, sha256: entry.sha256, path, signal: ctx.signal })
  if (pushed instanceof Error) return new CloudProblem('internal-error', `the cloud iPhone could not download ${entry.name}: ${pushed.message}`)
  if (!pushed.ok) return new CloudProblem('internal-error', `the cloud iPhone could not download ${entry.name}: ${pushed.error ?? 'no reason given'}`)
  const installed = await rpc(phone, 'apps.install', { path })
  if (installed instanceof Error) return installed
  return { message: `installed ${entry.name} (${entry.bundleId})`, logs: [`downloaded ${entry.name} to the cloud iPhone`] }
}

export async function deviceInfo(ctx: Ctx, { lease }: { lease: string }): Promise<Schemas['DeviceInfo'] | CloudProblem> {
  const phone = await openLease(ctx, { lease, command: 'info' })
  if (phone instanceof Error) return phone
  const [result, name] = await Promise.all([rpc(phone, 'device.info'), phoneName(ctx, phone.phoneId)])
  if (result instanceof Error) return result
  const template = templateInfo(phone.template)
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  return {
    udid: phone.phoneId,
    name,
    model: text(result.model) ?? template.model,
    modelName: template.modelName,
    iosVersion: text(result.ios_version) ?? template.iosVersion,
    ...(text(result.ios_build) ? { build: text(result.ios_build) } : {}),
  }
}

export async function rename(ctx: Ctx, { lease, name }: { lease: string; name: string }): Promise<string | CloudProblem> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.length > MAX_NAME_LENGTH) return new CloudProblem('invalid-request', `the name must be 1 to ${MAX_NAME_LENGTH} characters`)
  const phone = await openLease(ctx, { lease, command: 'rename' })
  if (phone instanceof Error) return phone
  await getDb().update(schema.cloudPhone).set({ name: trimmed })
    .where(orm.and(orm.eq(schema.cloudPhone.cloudPhoneId, phone.phoneId), orm.eq(schema.cloudPhone.orgId, ctx.orgId)))
  return `renamed to ${trimmed}`
}

async function phoneName(ctx: Ctx, phoneId: string): Promise<string> {
  const row = await getDb().query.cloudPhone.findFirst({ where: { cloudPhoneId: phoneId, orgId: ctx.orgId }, columns: { name: true } })
  return row?.name ?? phoneId
}

// ── phone tasks ──

const TASK_ID = /^[A-Za-z0-9_-]{8,64}$/

/** One turn of a phone task on the lease (task.ts). A valid cloud lease means an allowed
 *  cloud phone, whose org has unlimited tasks (billing.ts taskDecision): no quota check here. */
export async function startTask(ctx: Ctx, { lease, prompt, task }: { lease: string; prompt?: string; task?: string }): Promise<{ taskId: string; stream: ReadableStream<Uint8Array>; stop(): void } | CloudProblem> {
  if (!prompt && !task) return new CloudProblem('invalid-request', 'pass a prompt, or the id of a running task to follow it')
  if (task && !TASK_ID.test(task)) return new CloudProblem('invalid-request', 'task ids are 8 to 64 letters, digits, - and _, e.g. tsk_8f2k3x9a1b2c')
  const phone = await openLease(ctx, { lease, command: 'task' })
  if (phone instanceof Error) return phone
  const taskId = task ?? `tsk_${generateId()}`
  const stub = getTask({ orgId: ctx.orgId, taskId })
  if (!prompt) {
    const running = await stub.resume({})
    if (!running || running === 'gone') return new CloudProblem('invalid-request', `task ${taskId} has no running turn: pass a prompt to continue it`)
    return { taskId, stream: running, stop: () => {} }
  }
  const template = templateInfo(phone.template)
  const taskPhone: TaskPhone = { name: await phoneName(ctx, phone.phoneId), model: template.modelName, iosVersion: template.iosVersion }
  const message: UIMessage = { id: crypto.randomUUID(), role: 'user', parts: [{ type: 'text', text: prompt }] }
  const stream = await stub.send({ orgId: ctx.orgId, taskId, lease: leaseId(phone.n), phone: taskPhone, message })
  return { taskId, stream, stop: () => void stub.abort({ prompt: message.id }) }
}

/** Reads a turn to its end: the answer text, or the error chunk as a problem. */
export async function finishTask({ taskId, stream }: { taskId: string; stream: ReadableStream<Uint8Array> }): Promise<{ task: string; text: string } | CloudProblem> {
  let text = ''
  let error: string | undefined
  for (const chunk of parseUiStream(await new Response(stream).text())) {
    if (chunk.type === 'start-step') text = ''
    if (chunk.type === 'text-delta') text += chunk.delta
    if (chunk.type === 'error') error = chunk.errorText
  }
  if (error) return new CloudProblem('task-failed', `${error} (task ${taskId})`)
  return { task: taskId, text: text.trim() }
}

function parseUiStream(body: string): UIMessageChunk[] {
  return body.split('\n').flatMap((line) => {
    if (!line.startsWith('data: ') || line === 'data: [DONE]') return []
    try {
      return [JSON.parse(line.slice('data: '.length)) as UIMessageChunk]
    } catch {
      return []
    }
  })
}

// ── HTTP: the daemon routes under /macs/cloud/v1 ──

const pointSchema = z.object({ x: z.number().min(0), y: z.number().min(0) })
const tapSchema = z.union([pointSchema.strict(), z.object({ text: z.string().min(1), index: z.number().int().min(1).optional() }).strict()])
const holdSchema = z.union([
  pointSchema.extend({ durationMs: z.number().min(100).max(10_000).optional() }).strict(),
  z.object({ text: z.string().min(1), index: z.number().int().min(1).optional(), durationMs: z.number().min(100).max(10_000).optional() }).strict(),
])
const BODIES = {
  acquire: z.object({
    reason: z.string().min(1), device: z.string().min(1).optional(), mac: z.string().optional(), label: z.string().optional(),
    idleTimeoutSeconds: z.number().min(1).max(86_400).optional(), force: z.boolean().optional(), waitSeconds: z.number().min(1).max(3600).optional(),
  }).strict(),
  swipe: z.object({ from: pointSchema, to: pointSchema, durationMs: z.number().min(16).max(10_000).optional() }).strict(),
  holdDrag: z.object({ from: pointSchema, to: pointSchema, holdMs: z.number().min(100).max(10_000).optional(), durationMs: z.number().min(16).max(10_000).optional() }).strict(),
  scroll: z.object({ direction: z.enum(['up', 'down', 'left', 'right']), ticks: z.number().int().min(1).max(1000), at: pointSchema.optional() }).strict(),
  key: z.object({ key: z.string().min(1) }).strict(),
  type: z.object({ text: z.string(), enter: z.boolean().optional() }).strict(),
  unlock: z.object({ passcode: z.string().min(1) }).strict(),
  mute: z.object({ muted: z.boolean() }).strict(),
  name: z.object({ name: z.string().min(1) }).strict(),
  task: z.object({ prompt: z.string().min(1).optional(), task: z.string().optional() }).strict(),
}

/** One daemon API request for the org's cloud iPhones. `path` is `/v1/...` with its query. */
export async function cloudApi({ orgId, request, path }: { orgId: string; request: Request; path: string }): Promise<Response> {
  const url = new URL(path, 'https://cloud')
  const ctx: Ctx = { orgId, signal: request.signal }
  const answer = await route({ ctx, request, method: request.method, url })
  if (answer instanceof Response) return answer
  if (answer instanceof CloudProblem) return problemResponse(answer)
  return Response.json(answer)
}

async function route({ ctx, request, method, url }: { ctx: Ctx; request: Request; method: string; url: URL }): Promise<Response | CloudProblem | object> {
  const query = url.searchParams
  const { pathname } = url
  if (pathname === '/v1/devices' && method === 'GET') {
    const devices = await listDevices(ctx)
    return { devices: devices.map(deviceSchema) } satisfies Schemas['DeviceList']
  }
  if (pathname === '/v1/leases' && method === 'POST') {
    const body = await parseBody(request, BODIES.acquire)
    if (body instanceof Error) return body
    if (body.mac && body.mac !== CLOUD_SLUG) return new CloudProblem('invalid-request', `mac must be ${CLOUD_SLUG} or omitted here`)
    const run = acquire(ctx, body).then((lease) => (lease instanceof Error ? lease : leaseSchema(lease)))
    if (wantsStream(request)) return eventStream(run)
    const lease = await run
    return lease instanceof Error ? lease : Response.json(lease, { status: 201 })
  }
  const match = pathname.match(/^\/v1\/leases\/([^/]+)(\/.*)?$/)
  if (!match) return new CloudProblem('unsupported-in-mode', `${method} ${pathname} is not available for cloud iPhones`)
  const lease = decodeURIComponent(match[1]!)
  const op = match[2] ?? ''
  if (op === '' && method === 'DELETE') {
    const message = await release(ctx, lease)
    return message instanceof Error ? message : { message }
  }
  if (query.has('scale')) return new CloudProblem('unsupported-in-mode', 'cloud iPhones use screen points only: omit scale')
  const after: After = {
    waitText: query.get('waitText') || undefined,
    timeoutMs: numberParam(query.get('timeoutMs')),
    screenshot: query.get('screenshot') === 'png' || query.get('screenshot') === 'jpeg' ? query.get('screenshot') as 'png' | 'jpeg' : undefined,
    screentext: boolParam(query.get('screentext')),
    language: query.get('language') || undefined,
  }
  const inputRoute = async <T extends z.ZodType>(schema: T, run: (body: z.infer<T>) => Promise<ActionResult | CloudProblem>) => {
    const body = await parseBody(request, schema)
    if (body instanceof Error) return body
    return wantsStream(request) ? eventStream(run(body)) : run(body)
  }
  switch (`${method} ${op}`) {
    case 'GET /screenshot': {
      if (boolParam(query.get('native'))) return new CloudProblem('unsupported-in-mode', 'cloud iPhones have no native screenshot: their screen capture already shows system dialogs')
      const shot = await screenshot(ctx, { lease, settle: boolParam(query.get('settle')), screentext: boolParam(query.get('screentext')), language: after.language })
      if (shot instanceof Error) return shot
      if (shot.screen) return { screenshot: { format: 'jpeg', width: shot.width, height: shot.height, data: shot.data }, screen: shot.screen } satisfies Schemas['ScreenshotText']
      const headers: Record<string, string> = { 'content-type': 'image/jpeg', 'x-image-width': String(shot.width), 'x-image-height': String(shot.height) }
      if (query.get('format') === 'png') headers['x-note'] = 'cloud iPhones send JPEG screenshots'
      return new Response(base64Bytes(shot.data), { headers })
    }
    case 'GET /text':
      return screenText(ctx, { lease, settle: boolParam(query.get('settle')), language: after.language, waitText: after.waitText, timeoutMs: after.timeoutMs })
    case 'POST /tap':
    case 'POST /double-tap':
    case 'POST /triple-tap': {
      const command = op.slice(1) as 'tap' | 'double-tap' | 'triple-tap'
      return inputRoute(tapSchema, (body) => tap(ctx, { lease, command, request: body, after }))
    }
    case 'POST /hold':
      return inputRoute(holdSchema, ({ durationMs, ...body }) => tap(ctx, { lease, command: 'hold', request: { ...body, holdMs: durationMs }, after }))
    case 'POST /swipe':
      return inputRoute(BODIES.swipe, (body) => swipe(ctx, { lease, ...body, after }))
    case 'POST /hold-drag':
      return inputRoute(BODIES.holdDrag, (body) => swipe(ctx, { lease, ...body, holdMs: body.holdMs ?? DEFAULT_HOLD_MS, after }))
    case 'POST /scroll':
      return inputRoute(BODIES.scroll, (body) => scroll(ctx, { lease, ...body, after }))
    case 'POST /key':
      return inputRoute(BODIES.key, (body) => key(ctx, { lease, key: body.key, after }))
    case 'POST /type':
      return inputRoute(BODIES.type, (body) => type(ctx, { lease, ...body, after }))
    case 'POST /wake':
      return wantsStream(request) ? eventStream(wake(ctx, { lease, after })) : wake(ctx, { lease, after })
    case 'POST /lock':
      return lock(ctx, { lease })
    case 'POST /unlock':
      return inputRoute(BODIES.unlock, (body) => unlock(ctx, { lease, passcode: body.passcode, after }))
    case 'POST /mute':
      return inputRoute(BODIES.mute, (body) => mute(ctx, { lease, muted: body.muted }))
    case 'GET /apps':
      return listApps(ctx, { lease, system: boolParam(query.get('system')) })
    case 'POST /apps':
      return new CloudProblem('unsupported-in-mode', 'cloud iPhones install apps from the catalog only: `ghosthand app catalog`, then `ghosthand app install --app <id>`')
    case 'GET /apps/catalog':
      return catalog(ctx, { lease })
    case 'GET /info':
      return deviceInfo(ctx, { lease })
    case 'PUT /name': {
      const body = await parseBody(request, BODIES.name)
      if (body instanceof Error) return body
      const message = await rename(ctx, { lease, name: body.name })
      return message instanceof Error ? message : { message }
    }
    case 'POST /task': {
      const body = await parseBody(request, BODIES.task)
      if (body instanceof Error) return body
      const turn = await startTask(ctx, { lease, prompt: body.prompt, task: body.task })
      if (turn instanceof Error) return turn
      if (!wantsStream(request)) {
        const result = await finishTask(turn)
        return result instanceof Error ? result : Response.json(result, { headers: { 'ghosthand-task': turn.taskId } })
      }
      // Closing the stream stops the turn, like the daemon.
      const reader = turn.stream.getReader()
      const stream = new ReadableStream<Uint8Array>({
        pull: async (controller) => {
          const { value, done } = await reader.read()
          if (done) controller.close()
          else controller.enqueue(value)
        },
        cancel: () => {
          turn.stop()
          void reader.cancel()
        },
      })
      return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'ghosthand-task': turn.taskId } })
    }
  }
  const app = op.match(/^\/apps\/catalog\/([^/]+)$/)
  if (app && method === 'POST') {
    const install = installCatalogApp(ctx, { lease, app: decodeURIComponent(app[1]!) })
    return wantsStream(request) ? eventStream(install) : install
  }
  const bundle = op.match(/^\/apps\/([^/]+)$/)
  if (bundle && method === 'DELETE') {
    const message = await uninstallApp(ctx, { lease, bundleId: decodeURIComponent(bundle[1]!) })
    return message instanceof Error ? message : { message }
  }
  return new CloudProblem('unsupported-in-mode', `${method} /v1/leases/{lease}${op} is not available for cloud iPhones`)
}

export function deviceSchema(device: CloudDevice): Device {
  return {
    id: device.phoneId, mac: CLOUD_SLUG, name: device.name, model: device.model, modelName: device.modelName,
    iosVersion: device.iosVersion, control: 'bluetooth', ...(device.lease ? { lease: leaseInfoSchema(device.lease) } : {}),
  }
}

export function leaseInfoSchema(info: LeaseInfo): Schemas['LeaseInfo'] {
  return {
    ...(info.label ? { label: info.label } : {}), reason: info.reason, acquiredAt: iso(info.acquiredAt),
    lastUsedAt: iso(info.lastUsedAt), ...(info.lastCommand ? { lastCommand: info.lastCommand } : {}), expiresAt: iso(info.expiresAt),
  }
}

function leaseSchema(lease: CloudLease): Schemas['Lease'] {
  return {
    id: lease.id, device: lease.phoneId, deviceName: lease.deviceName, ...(lease.label ? { label: lease.label } : {}), reason: lease.reason,
    idleTimeoutSeconds: lease.idleTimeoutS, expiresAt: iso(lease.expiresAt), ...(lease.replaced ? { replaced: leaseInfoSchema(lease.replaced) } : {}),
  }
}

function problemResponse(problem: CloudProblem): Response {
  return Response.json(problem.body, { status: problem.status, headers: { 'content-type': 'application/problem+json' } })
}

function wantsStream(request: Request): boolean {
  return request.headers.get('accept')?.includes('text/event-stream') ?? false
}

/** The daemon's stream mode: `: ping` comments, then `result` or `error` (status stays 200). */
function eventStream(run: Promise<object | CloudProblem>): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const ping = setInterval(() => controller.enqueue(encoder.encode(': ping\n\n')), KEEPALIVE_MS)
      const result = await run.catch((cause) => new CloudProblem('internal-error', cause instanceof Error ? cause.message : String(cause)))
      clearInterval(ping)
      const [event, data] = result instanceof CloudProblem ? ['error', result.body] : ['result', result]
      controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      controller.close()
    },
  })
  return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
}

async function parseBody<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T> | CloudProblem> {
  const text = await request.text()
  let value: unknown
  try {
    value = text ? JSON.parse(text) : {}
  } catch {
    return new CloudProblem('invalid-request', 'the body is not JSON')
  }
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  return new CloudProblem('invalid-request', parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
}

function boolParam(value: string | null): boolean {
  return value === 'true' || value === '1'
}

function numberParam(value: string | null): number | undefined {
  if (value === null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

export function base64Bytes(data: string): Uint8Array<ArrayBuffer> {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** Width and height from a JPEG's start-of-frame marker. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null
    const marker = bytes[i + 1]!
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5]! << 8) | bytes[i + 6]!, width: (bytes[i + 7]! << 8) | bytes[i + 8]! }
    }
    i += 2 + length
  }
  return null
}

function sleep({ ms, signal }: { ms: number; signal: AbortSignal }): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}
