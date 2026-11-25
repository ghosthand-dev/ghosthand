// The ghosthand daemon API for cloud iPhones, translated to vphone.sock lines and vphoned RPC.
// A cloud iPhone is one more Mac, slug `cloud`, so every client that speaks the daemon API
// (the CLI through lease forwarding, scripts, phone tasks) works unchanged:
//
//   /macs/cloud/v1/... (tunnel.ts, in the Worker) ──> cloudApi() ──> ops below ──> fleet.ts (lease check)
//   MCP tools for cloud:<n> (mcp.ts) ─────────────────────┘   │
//   task tools (task.ts, slug `cloud`) ───────────────────────┘   └──> host.ts sock ──> vphone.sock
//
// Coordinates are screen points on both sides (vphoned gestures and the daemon's default
// scale). The website is the only tenant gate: only the routes below exist, never a raw RPC.
// Types come from the daemon's OpenAPI (src/generated/daemon-api.ts): ROUTES must name every
// daemon route, as a handler or an unsupported reason. Pure logic shared with the daemon is in core.ts.

import { generateId, type UIMessage, type UIMessageChunk } from 'ai'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { z } from 'zod'
import { getDb } from '../db.ts'
import type { components, paths } from '../generated/daemon-api.ts'
import { getTask } from '../task.ts'
import type { TaskPhone } from '../task-agent.ts'
import { catalogApp, publicCatalog } from './apps.ts'
import { acquire as acquireLease, listPhones, release as releaseLease, useLease, type FleetPhone, type LeaseInfo, type LeaseTarget, type LeaseView } from './fleet.ts'
import { hostClient, type Json, type SockLine, type SockReply } from './host.ts'
import { DEFAULT_IDLE_TIMEOUT_S } from './scheduler.ts'
import { sendBlob, templateInfo } from './storage.ts'
import { CloudProblem, checkWaitText, hasText, ocrScreen, pickText, scrollStrokes, type Direction, type Point, type WaitText } from './core.ts'

type Schemas = components['schemas']
export type Device = Schemas['Device']
export type ScreenText = Schemas['ScreenText']
export type ActionResult = Schemas['ActionResult']

export const CLOUD_SLUG = 'cloud'
export const CLOUD_NAME = 'Cloud'
const OCR_POLL_MS = 150
const DEFAULT_HOLD_MS = 1_000
const DEFAULT_DRAG_MS = 1_000
const DEFAULT_SWIPE_MS = 150
const MAX_SCROLL_TICKS = 1_000
const MIN_HOLD_MS = 100
const MIN_SWIPE_MS = 16
const MAX_GESTURE_MS = 10_000
const TAP_GAP_MS = 120
const TAP_PRESS_MS = 80
const KEEPALIVE_MS = 15_000
const MAX_NAME_LENGTH = 100
const MS_PER_S = 1_000

export type Ctx = { orgId: string; signal: AbortSignal }

/** One of the org's cloud iPhones, with its model from the template. */
export type CloudDevice = FleetPhone & { model: string; modelName: string; iosVersion: string }

/** Input options every input route takes after the input (daemon `AfterInput`). */
export type After = { waitText?: string; timeoutMs?: number; screenshot?: 'png' | 'jpeg'; screentext?: boolean; language?: string }

type Phone = LeaseTarget & { n: number; sock(line: SockLine): Promise<SockReply | CloudProblem> }
/** The last vphone.sock line of an input, sent with the screen request; what ran before it is done. */
type FinalInput = { line: SockLine; message: string; logs?: string[] }

// ── devices and leases ──

export async function listDevices(ctx: Ctx): Promise<CloudDevice[]> {
  const phones = await listPhones({ orgId: ctx.orgId })
  return phones.map((phone) => {
    const template = templateInfo(phone.template)
    return { ...phone, model: template.model, modelName: template.modelName, iosVersion: template.iosVersion }
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
  const result = await acquireLease({
    orgId: ctx.orgId, phoneId: device.phoneId, label: input.label, reason: input.reason,
    idleTimeoutS: input.idleTimeoutSeconds ?? DEFAULT_IDLE_TIMEOUT_S, waitS: input.waitSeconds, force: input.force, signal: ctx.signal,
  })
  if (!result.ok) return new CloudProblem(result.code, result.detail)
  const { n, ...lease } = result.lease
  return { ...lease, id: leaseId(n), deviceName: device.name }
}

export async function release(ctx: Ctx, lease: string): Promise<string | CloudProblem> {
  const n = parseLease(lease)
  if (n instanceof Error) return n
  return await releaseLease({ orgId: ctx.orgId, n }) ? 'lease released' : 'lease was already ended (expired, released, or taken with --force)'
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
  const target = await useLease({ orgId: ctx.orgId, n, command })
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
  const wait = checkWaitText({ waitText, timeoutMs })
  if (wait instanceof Error) return wait
  const phone = await openLease(ctx, { lease, command: 'screentext' })
  if (phone instanceof Error) return phone
  if (wait) {
    const found = await waitForText(ctx, phone, { wait, language })
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

const appRows = z.array(z.object({ bundle_id: z.string(), name: z.string().optional(), version: z.string().optional(), type: z.string().optional() }).loose())

async function waitForText(ctx: Ctx, phone: Phone, { wait, language }: { wait: WaitText; language?: string }): Promise<ScreenText | CloudProblem> {
  const deadline = Date.now() + wait.timeoutMs
  let reads = 0
  for (;;) {
    if (ctx.signal.aborted) return new CloudProblem('cancelled', 'the client went away')
    const screen = await readScreen(phone, { language })
    if (screen instanceof Error) return screen
    reads++
    if (hasText({ lines: screen.lines, text: wait.text })) return screen
    if (Date.now() + OCR_POLL_MS > deadline) {
      return new CloudProblem('wait-text-timeout', `"${wait.text}" did not appear in ${wait.timeoutMs} ms (${reads} OCR reads). The input was sent: never repeat it blindly; read the screen first.`)
    }
    await sleep({ ms: OCR_POLL_MS, signal: ctx.signal })
  }
}

// ── input ──

/** Runs an input, then the steps after it (waitText, then the settled screen and its text). */
async function input(ctx: Ctx, { lease, command, after, prepare }: { lease: string; command: string; after: After; prepare: (phone: Phone) => Promise<FinalInput | CloudProblem> }): Promise<ActionResult | CloudProblem> {
  const wait = checkWaitText(after)
  if (wait instanceof Error) return wait
  const phone = await openLease(ctx, { lease, command })
  if (phone instanceof Error) return phone
  const final = await prepare(phone)
  if (final instanceof Error) return final
  // The host settles best on the input line itself: it saw the screen before the input.
  const settleOnInput = !!after.screenshot && !wait
  const reply = await phone.sock({ ...final.line, ...(settleOnInput ? { screen: true, settle: true } : { screen: false }) })
  if (reply instanceof Error) return reply
  const result: ActionResult = { message: final.message, logs: final.logs ?? [] }
  const sent = (problem: CloudProblem) => new CloudProblem(problem.code, `${final.message}, then: ${problem.message}`)
  if (wait) {
    const found = await waitForText(ctx, phone, { wait, language: after.language })
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

/** Points in messages, as the daemon prints them (`Int()`). */
const pointLabel = ({ x, y }: Point) => `${Math.trunc(x)},${Math.trunc(y)}`

export async function tap(ctx: Ctx, { lease, command, request, after }: { lease: string; command: 'tap' | 'double-tap' | 'triple-tap' | 'hold'; request: TapInput; after: After }) {
  const holdMs = command === 'hold' ? request.holdMs ?? DEFAULT_HOLD_MS : undefined
  if (holdMs !== undefined && !(holdMs >= MIN_HOLD_MS && holdMs <= MAX_GESTURE_MS)) {
    return new CloudProblem('invalid-request', `durationMs must be between ${MIN_HOLD_MS} and ${MAX_GESTURE_MS}`)
  }
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
        point = { x: line.x + line.width / 2, y: line.y + line.height / 2 }
        logs.push(`found "${line.text}" at ${pointLabel(point)}`)
      }
      const { x, y } = point!
      if (holdMs !== undefined) {
        return { line: rpcLine('input.long_press', { x, y, seconds: holdMs / MS_PER_S }), message: `held ${pointLabel(point!)} for ${Math.trunc(holdMs)} ms`, logs }
      }
      if (command === 'double-tap') return { line: rpcLine('input.double_tap', { x, y }), message: `double-tapped ${pointLabel(point!)}`, logs }
      if (command === 'triple-tap') {
        const events = [0, 1, 2].flatMap((i) => [
          { phase: 'down', x, y, delay_ms: i === 0 ? 0 : TAP_GAP_MS },
          { phase: 'up', x, y, delay_ms: TAP_PRESS_MS },
        ])
        return { line: rpcLine('input.touch_sequence', { events, normalized: false }), message: `triple-tapped ${pointLabel(point!)}`, logs }
      }
      return { line: rpcLine('input.tap', { x, y }), message: `tapped ${pointLabel(point!)}`, logs }
    },
  })
}

export async function swipe(ctx: Ctx, { lease, from, to, durationMs, holdMs, after }: { lease: string; from: Point; to: Point; durationMs?: number; holdMs?: number; after: After }) {
  const drag = holdMs !== undefined
  const ms = durationMs ?? (drag ? DEFAULT_DRAG_MS : DEFAULT_SWIPE_MS)
  if (!(ms >= MIN_SWIPE_MS && ms <= MAX_GESTURE_MS)) return new CloudProblem('invalid-request', `durationMs must be between ${MIN_SWIPE_MS} and ${MAX_GESTURE_MS}`)
  if (drag && !(holdMs >= MIN_HOLD_MS && holdMs <= MAX_GESTURE_MS)) return new CloudProblem('invalid-request', `holdMs must be between ${MIN_HOLD_MS} and ${MAX_GESTURE_MS}`)
  return input(ctx, {
    lease, command: drag ? 'hold-drag' : 'swipe', after,
    prepare: async () => {
      const path = `${pointLabel(from)} -> ${pointLabel(to)}`
      if (drag) {
        return { line: rpcLine('input.drag', { points: [[from.x, from.y], [to.x, to.y]], hold: holdMs / MS_PER_S, seconds: ms / MS_PER_S }), message: `held ${Math.trunc(holdMs)} ms, then dragged ${path}` }
      }
      return { line: rpcLine('input.swipe', { from: [from.x, from.y], to: [to.x, to.y], seconds: ms / MS_PER_S }), message: `swiped ${path} in ${Math.trunc(ms)} ms` }
    },
  })
}

export async function scroll(ctx: Ctx, { lease, direction, ticks, at: point, after }: { lease: string; direction: Direction; ticks: number; at?: Point; after: After }) {
  if (!(Number.isInteger(ticks) && ticks >= 1 && ticks <= MAX_SCROLL_TICKS)) return new CloudProblem('invalid-request', `ticks must be between 1 and ${MAX_SCROLL_TICKS}`)
  return input(ctx, {
    lease, command: 'scroll', after,
    prepare: async (phone) => {
      const screen = templateInfo(phone.template).screen
      const lines = scrollStrokes({ direction, ticks, center: point ?? { x: screen.width / 2, y: screen.height / 2 }, screen })
        .map((s) => rpcLine('input.swipe', { from: [s.from.x, s.from.y], to: [s.to.x, s.to.y], seconds: s.durationMs / MS_PER_S }))
      for (const line of lines.slice(0, -1)) {
        const done = await phone.sock({ ...line, screen: false })
        if (done instanceof Error) return done
      }
      return { line: lines.at(-1)!, message: `scrolled ${direction} ${ticks} ticks` }
    },
  })
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

/** The catalog, with what the phone has installed. */
export async function catalog(ctx: Ctx, { lease }: { lease: string }): Promise<Schemas['CatalogAppList'] | CloudProblem> {
  const installed = await listApps(ctx, { lease })
  if (installed instanceof Error) return installed
  const bundles = new Set(installed.apps.map((app) => app.bundleId))
  return { apps: publicCatalog().apps.map((app) => ({ ...app, installed: bundles.has(app.bundleId) })) }
}

/** A catalog app: the Worker streams the decrypted IPA from R2 into the host's blob store (unless
 *  it has it), the host pushes it into the guest, then vphoned installs it. */
export async function installCatalogApp(ctx: Ctx, { lease, app }: { lease: string; app: string }): Promise<ActionResult | CloudProblem> {
  const entry = catalogApp(app)
  if (!entry) return new CloudProblem('not-found', `no app "${app}" in the catalog. Apps: ${publicCatalog().apps.map((a) => a.id).join(', ')}`)
  const phone = await openLease(ctx, { lease, command: 'app install' })
  if (phone instanceof Error) return phone
  const path = `/var/mobile/Media/Downloads/${entry.id}.ipa`
  const host = hostClient(phone.address)
  const sent = await sendBlob({ host, key: entry.key, sha256: entry.sha256, signal: ctx.signal })
  if (sent instanceof Error) return new CloudProblem('internal-error', `the cloud iPhone could not get ${entry.name}: ${sent.message}`)
  const pushed = await host.push({ phoneId: phone.phoneId, sha256: entry.sha256, path, signal: ctx.signal })
  if (pushed instanceof Error) return new CloudProblem('internal-error', `the cloud iPhone could not get ${entry.name}: ${pushed.message}`)
  if (!pushed.ok) return new CloudProblem('internal-error', `the cloud iPhone could not get ${entry.name}: ${pushed.error ?? 'no reason given'}`)
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

/** Methods openapi.yaml may give a path. */
type Method = 'get' | 'put' | 'post' | 'delete' | 'patch'
/** Every daemon route as `METHOD /path`, from the daemon's openapi.yaml (src/generated/daemon-api.ts). */
type DaemonRoute = {
  [P in keyof paths]: { [M in Method]: [NonNullable<paths[P][M]>] extends [never] ? never : `${Uppercase<M>} ${P}` }[Method]
}[keyof paths]
/** `{lease}` and the other path parameters of a route. */
type PathParams<R> = R extends `${string}{${infer K}}${infer Rest}` ? Record<K, string> & PathParams<Rest> : unknown
type RouteInput<R> = { ctx: Ctx; request: Request; query: URLSearchParams; params: PathParams<R>; after: After }
/** A cloud handler, or why cloud iPhones cannot do the route. */
type Route<R> = ((input: RouteInput<R>) => Promise<Response | CloudProblem | object>) | { unsupported: string }

const NO_MAC = 'cloud iPhones have no Mac: this route belongs to a Mac\'s daemon'
const NO_FILES = 'files are not available on cloud iPhones yet'
const NO_PHOTOS = 'photos are not available on cloud iPhones yet'
export const NO_NATIVE_SCREENSHOT = 'cloud iPhones have no native screenshot: their screen capture already shows system dialogs'

/** Every daemon route: a missing or unknown one fails tsc, so a new daemon route needs a decision here. */
const ROUTES: { [R in DaemonRoute]: Route<R> } = {
  'GET /v1/devices': async ({ ctx }) => {
    const devices = await listDevices(ctx)
    return { devices: devices.map(deviceSchema) } satisfies Schemas['DeviceList']
  },
  'POST /v1/leases': async ({ ctx, request }) => {
    const body = await parseBody(request, BODIES.acquire)
    if (body instanceof Error) return body
    if (body.mac && body.mac !== CLOUD_SLUG) return new CloudProblem('invalid-request', `mac must be ${CLOUD_SLUG} or omitted here`)
    const run = acquire(ctx, body).then((lease) => (lease instanceof Error ? lease : leaseSchema(lease)))
    if (wantsStream(request)) return eventStream(run)
    const lease = await run
    return lease instanceof Error ? lease : Response.json(lease, { status: 201 })
  },
  'DELETE /v1/leases/{lease}': async ({ ctx, params }) => messageBody(await release(ctx, params.lease)),
  'GET /v1/leases/{lease}/screenshot': async ({ ctx, query, params, after }) => {
    if (boolParam(query.get('native'))) return new CloudProblem('unsupported-in-mode', NO_NATIVE_SCREENSHOT)
    const shot = await screenshot(ctx, { lease: params.lease, settle: boolParam(query.get('settle')), screentext: boolParam(query.get('screentext')), language: after.language })
    if (shot instanceof Error) return shot
    if (shot.screen) return { screenshot: { format: 'jpeg', width: shot.width, height: shot.height, data: shot.data }, screen: shot.screen } satisfies Schemas['ScreenshotText']
    const headers: Record<string, string> = { 'content-type': 'image/jpeg', 'x-image-width': String(shot.width), 'x-image-height': String(shot.height) }
    if (query.get('format') === 'png') headers['x-note'] = 'cloud iPhones send JPEG screenshots'
    return new Response(base64Bytes(shot.data), { headers })
  },
  'GET /v1/leases/{lease}/text': ({ ctx, query, params, after }) =>
    screenText(ctx, { lease: params.lease, settle: boolParam(query.get('settle')), language: after.language, waitText: after.waitText, timeoutMs: after.timeoutMs }),
  'POST /v1/leases/{lease}/tap': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: tapSchema, run: (body) => tap(ctx, { lease: params.lease, command: 'tap', request: body, after }) }),
  'POST /v1/leases/{lease}/double-tap': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: tapSchema, run: (body) => tap(ctx, { lease: params.lease, command: 'double-tap', request: body, after }) }),
  'POST /v1/leases/{lease}/triple-tap': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: tapSchema, run: (body) => tap(ctx, { lease: params.lease, command: 'triple-tap', request: body, after }) }),
  'POST /v1/leases/{lease}/hold': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: holdSchema, run: ({ durationMs, ...body }) => tap(ctx, { lease: params.lease, command: 'hold', request: { ...body, holdMs: durationMs }, after }) }),
  'POST /v1/leases/{lease}/swipe': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: BODIES.swipe, run: (body) => swipe(ctx, { lease: params.lease, ...body, after }) }),
  'POST /v1/leases/{lease}/hold-drag': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: BODIES.holdDrag, run: (body) => swipe(ctx, { lease: params.lease, ...body, holdMs: body.holdMs ?? DEFAULT_HOLD_MS, after }) }),
  'POST /v1/leases/{lease}/scroll': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: BODIES.scroll, run: (body) => scroll(ctx, { lease: params.lease, ...body, after }) }),
  'POST /v1/leases/{lease}/key': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: BODIES.key, run: (body) => key(ctx, { lease: params.lease, key: body.key, after }) }),
  'POST /v1/leases/{lease}/type': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: BODIES.type, run: (body) => type(ctx, { lease: params.lease, ...body, after }) }),
  'POST /v1/leases/{lease}/wake': async ({ ctx, request, params, after }) => {
    const run = wake(ctx, { lease: params.lease, after })
    return wantsStream(request) ? eventStream(run) : run
  },
  'POST /v1/leases/{lease}/lock': ({ ctx, params }) => lock(ctx, { lease: params.lease }),
  'POST /v1/leases/{lease}/unlock': ({ ctx, request, params, after }) =>
    inputRoute({ request, schema: BODIES.unlock, run: (body) => unlock(ctx, { lease: params.lease, passcode: body.passcode, after }) }),
  'POST /v1/leases/{lease}/mute': ({ ctx, request, params }) =>
    inputRoute({ request, schema: BODIES.mute, run: (body) => mute(ctx, { lease: params.lease, muted: body.muted }) }),
  'GET /v1/leases/{lease}/apps': ({ ctx, query, params }) => listApps(ctx, { lease: params.lease, system: boolParam(query.get('system')) }),
  'POST /v1/leases/{lease}/apps': { unsupported: 'cloud iPhones install apps from the catalog only: `ghosthand app catalog`, then `ghosthand app install --app <id>`' },
  'GET /v1/leases/{lease}/apps/catalog': ({ ctx, params }) => catalog(ctx, { lease: params.lease }),
  'POST /v1/leases/{lease}/apps/catalog/{app}': async ({ ctx, request, params }) => {
    const install = installCatalogApp(ctx, { lease: params.lease, app: params.app })
    return wantsStream(request) ? eventStream(install) : install
  },
  'DELETE /v1/leases/{lease}/apps/{bundle}': async ({ ctx, params }) => messageBody(await uninstallApp(ctx, { lease: params.lease, bundleId: params.bundle })),
  'GET /v1/leases/{lease}/info': ({ ctx, params }) => deviceInfo(ctx, { lease: params.lease }),
  'PUT /v1/leases/{lease}/name': async ({ ctx, request, params }) => {
    const body = await parseBody(request, BODIES.name)
    if (body instanceof Error) return body
    return messageBody(await rename(ctx, { lease: params.lease, name: body.name }))
  },
  'POST /v1/leases/{lease}/task': async ({ ctx, request, params }) => {
    const body = await parseBody(request, BODIES.task)
    if (body instanceof Error) return body
    const turn = await startTask(ctx, { lease: params.lease, prompt: body.prompt, task: body.task })
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
  },
  'POST /v1/leases/{lease}/recording/start': { unsupported: 'cloud iPhones cannot record video yet; take screenshots instead' },
  'POST /v1/leases/{lease}/recording/stop': { unsupported: 'cloud iPhones cannot record video yet' },
  'GET /v1/leases/{lease}/assistive-touch': { unsupported: 'cloud iPhones take touches directly; there is no AssistiveTouch pointer' },
  'PUT /v1/leases/{lease}/assistive-touch': { unsupported: 'cloud iPhones take touches directly; there is no AssistiveTouch pointer' },
  'GET /v1/leases/{lease}/control': { unsupported: 'cloud iPhones have one control mode' },
  'PUT /v1/leases/{lease}/control': { unsupported: 'cloud iPhones have one control mode' },
  'DELETE /v1/leases/{lease}/bluetooth': { unsupported: 'cloud iPhones have no Bluetooth bond' },
  'GET /v1/leases/{lease}/files': { unsupported: NO_FILES },
  'DELETE /v1/leases/{lease}/files': { unsupported: NO_FILES },
  'GET /v1/leases/{lease}/files/content': { unsupported: NO_FILES },
  'PUT /v1/leases/{lease}/files/content': { unsupported: NO_FILES },
  'GET /v1/leases/{lease}/photos': { unsupported: NO_PHOTOS },
  'POST /v1/leases/{lease}/photos/delete': { unsupported: NO_PHOTOS },
  'GET /v1/leases/{lease}/logs': { unsupported: 'the system log is not available on cloud iPhones' },
  'POST /v1/leases/{lease}/power': { unsupported: 'cloud iPhones restart and stop by themselves; release the lease instead' },
  'POST /v1/leases/{lease}/random': { unsupported: 'random values are saved on a Mac; cloud iPhones have none' },
  'GET /v1/random': { unsupported: 'random values are saved on a Mac; cloud iPhones have none' },
  'POST /v1/uploads': { unsupported: 'upload runs on a Mac; cloud iPhones have none' },
  'GET /v1/phones': { unsupported: NO_MAC },
  'GET /v1/phones/{phone}/preview': { unsupported: NO_MAC },
  'PUT /v1/phones/{phone}/control': { unsupported: NO_MAC },
  'POST /v1/phones/{phone}/key': { unsupported: NO_MAC },
  'POST /v1/phones/{phone}/type': { unsupported: NO_MAC },
  'POST /v1/phones/{phone}/tap': { unsupported: NO_MAC },
  'POST /v1/phones/{phone}/swipe': { unsupported: NO_MAC },
  'POST /v1/phones/{phone}/release': { unsupported: NO_MAC },
  'GET /v1/setup/status': { unsupported: 'cloud iPhones need no setup: list them, then acquire one' },
  'POST /v1/setup/pairing': { unsupported: 'cloud iPhones need no setup: list them, then acquire one' },
  'POST /v1/setup/permissions': { unsupported: 'cloud iPhones need no setup: list them, then acquire one' },
  'GET /v1/account': { unsupported: NO_MAC },
  'DELETE /v1/account': { unsupported: NO_MAC },
  'POST /v1/account/login': { unsupported: NO_MAC },
  'POST /v1/tunnel/tokens': { unsupported: NO_MAC },
  'DELETE /v1/tunnel/tokens/{id}': { unsupported: NO_MAC },
  'GET /v1/daemon': { unsupported: NO_MAC },
  'POST /v1/daemon/stop': { unsupported: NO_MAC },
  'POST /v1/daemon/restart': { unsupported: NO_MAC },
  'POST /v1/daemon/update': { unsupported: NO_MAC },
  'GET /v1/openapi.yaml': { unsupported: NO_MAC },
}

/** The routes as matchers; paths with fewer parameters first, so `/apps/catalog` wins over `/apps/{bundle}`. */
const MATCHERS = (Object.keys(ROUTES) as DaemonRoute[]).map((key) => {
  const [method = '', template = ''] = key.split(' ')
  const names = [...template.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!)
  const pattern = new RegExp(`^${template.replace(/\{[^}]+\}/g, '([^/]+)')}$`)
  return { key, method, template, names, pattern }
}).sort((a, b) => a.names.length - b.names.length)

/** One daemon API request for the org's cloud iPhones. `path` is `/v1/...` with its query. */
export async function cloudApi({ orgId, request, path }: { orgId: string; request: Request; path: string }): Promise<Response> {
  const url = new URL(path, 'https://cloud')
  const ctx: Ctx = { orgId, signal: request.signal }
  const answer = await route({ ctx, request, url })
  if (answer instanceof Response) return answer
  if (answer instanceof CloudProblem) return problemResponse(answer)
  return Response.json(answer)
}

async function route({ ctx, request, url }: { ctx: Ctx; request: Request; url: URL }): Promise<Response | CloudProblem | object> {
  const { pathname, searchParams: query } = url
  let found: { key: DaemonRoute; template: string; params: Record<string, string> } | undefined
  for (const m of MATCHERS) {
    const match = m.method === request.method ? pathname.match(m.pattern) : null
    if (!match) continue
    found = { key: m.key, template: m.template, params: Object.fromEntries(m.names.map((name, i) => [name, decodeURIComponent(match[i + 1]!)])) }
    break
  }
  if (!found) return new CloudProblem('unsupported-in-mode', `${request.method} ${pathname} is not available for cloud iPhones`)
  if (found.template.startsWith('/v1/leases/{lease}/') && query.has('scale')) return new CloudProblem('unsupported-in-mode', 'cloud iPhones use screen points only: omit scale')
  const after: After = {
    waitText: query.get('waitText') ?? undefined,
    timeoutMs: numberParam(query.get('timeoutMs')),
    screenshot: query.get('screenshot') === 'png' || query.get('screenshot') === 'jpeg' ? query.get('screenshot') as 'png' | 'jpeg' : undefined,
    screentext: boolParam(query.get('screentext')),
    language: query.get('language') || undefined,
  }
  return runRoute(found.key, { ctx, request, query, params: found.params, after })
}

function runRoute<R extends DaemonRoute>(key: R, input: Omit<RouteInput<R>, 'params'> & { params: Record<string, string> }): Promise<Response | CloudProblem | object> | CloudProblem {
  const handler: Route<R> = ROUTES[key]
  if ('unsupported' in handler) return new CloudProblem('unsupported-in-mode', `${key} is not available for cloud iPhones: ${handler.unsupported}`)
  // The matcher read exactly the parameters the route's template names.
  return handler({ ...input, params: input.params as PathParams<R> })
}

/** An input route: the body, then the input, as a stream when the client asks for one. */
async function inputRoute<T extends z.ZodType>({ request, schema, run }: { request: Request; schema: T; run: (body: z.infer<T>) => Promise<ActionResult | CloudProblem> }) {
  const body = await parseBody(request, schema)
  if (body instanceof Error) return body
  return wantsStream(request) ? eventStream(run(body)) : run(body)
}

function messageBody(message: string | CloudProblem): Schemas['Message'] | CloudProblem {
  return message instanceof Error ? message : { message }
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
