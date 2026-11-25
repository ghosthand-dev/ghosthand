// The pure core of the cloud daemon API (api.ts, mcp.ts): problems, and the daemon's Controller
// logic that cloud iPhones redo without a daemon: tap-by-text matching, waitText, scroll strokes
// and OCR shaping. src/fixtures/daemon-parity.json (copied from the daemon by pnpm generate-docs)
// holds cases both must answer the same: parity.test.ts here, parity-tests.swift in the daemon.

import { z } from 'zod'
import type { components } from '../generated/daemon-api.ts'

type Schemas = components['schemas']
type ScreenText = Schemas['ScreenText']
export type ProblemCode = Schemas['Problem']['code']
export type Point = { x: number; y: number }
export type Direction = 'up' | 'down' | 'left' | 'right'

const DEFAULT_WAIT_TEXT_MS = 5_000
const MAX_WAIT_TEXT_MS = 60_000
/** Screen points one wheel tick scrolls on a USB iPhone (`ghosthand scroll --help`). */
const POINTS_PER_TICK = 100
/** A scroll drag covers at most this much of the screen side; longer scrolls repeat it. */
const SCROLL_STROKE_FRACTION = 0.7
/** Scroll drags stay between these fractions of the screen side. */
const SCROLL_LOW_FRACTION = 0.15
const SCROLL_HIGH_FRACTION = 0.85
const SCROLL_MS_PER_POINT = 1.5

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

const ocrBlocks = z.array(z.object({ text: z.string(), confidence: z.number(), x: z.number(), y: z.number(), width: z.number(), height: z.number() }).loose())

/** vphoned OCR blocks (box centers in points) as daemon lines (top-left corners, rounded), top to
 *  bottom, then left to right. Daemon: `OCR.textLines`; daemon-parity.json checks both. */
export function ocrScreen({ result, screen }: { result: Record<string, unknown>; screen: { width: number; height: number } }): ScreenText | CloudProblem {
  const parsed = ocrBlocks.safeParse(result.blocks)
  if (!parsed.success) return new CloudProblem('internal-error', `the cloud iPhone sent OCR blocks of an unknown shape: ${parsed.error.message}`)
  const lines = parsed.data.map((b) => ({
    text: b.text, x: Math.round(b.x - b.width / 2), y: Math.round(b.y - b.height / 2),
    width: Math.round(b.width), height: Math.round(b.height), confidence: b.confidence,
  })).sort((a, b) => a.y - b.y || a.x - b.x)
  return { width: screen.width, height: screen.height, lines }
}

export type WaitText = { text: string; timeoutMs: number }

/** `waitText` and `timeoutMs` checked before any input, like the daemon's `AfterInput.verification`.
 *  Undefined: no wait. daemon-parity.json checks both. */
export function checkWaitText({ waitText, timeoutMs }: { waitText?: string; timeoutMs?: number }): WaitText | undefined | CloudProblem {
  if (waitText === undefined) {
    return timeoutMs === undefined ? undefined : new CloudProblem('invalid-request', 'timeoutMs needs waitText; no input was sent')
  }
  if (!waitText.trim()) return new CloudProblem('invalid-request', 'waitText needs nonempty text; no input was sent')
  const timeout = timeoutMs ?? DEFAULT_WAIT_TEXT_MS
  if (!Number.isFinite(timeout) || timeout < 1 || timeout > MAX_WAIT_TEXT_MS) {
    return new CloudProblem('invalid-request', `timeoutMs must be 1...${MAX_WAIT_TEXT_MS} (default: ${DEFAULT_WAIT_TEXT_MS}); no input was sent`)
  }
  return { text: waitText, timeoutMs: timeout }
}

/** A line contains the text, case-insensitive (the daemon's `TextVerification.observe`). */
export function hasText({ lines, text }: { lines: ScreenText['lines']; text: string }): boolean {
  const needle = text.toLowerCase()
  return lines.some((line) => line.text.toLowerCase().includes(needle))
}

/** The daemon's rule (`TextMatch.pick`): lines equal to the text win over lines that contain it;
 *  several need `index`. daemon-parity.json checks both. */
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

/** Wheel ticks as slow drags of 100 points per tick, at most 70% of the screen each, kept between
 *  15% and 85% of it: `down` shows content further down, so the finger moves up. The daemon's XCTest
 *  mode does the same (`XCTestDriver.scrollStrokes`, plus an 80 ms pause before lifting the finger
 *  that input.swipe cannot do); daemon-parity.json checks both. Points in, points out. */
export function scrollStrokes({ direction, ticks, center, screen }: { direction: Direction; ticks: number; center: Point; screen: { width: number; height: number } }): { from: Point; to: Point; durationMs: number }[] {
  const vertical = direction === 'up' || direction === 'down'
  const side = vertical ? screen.height : screen.width
  const sign = direction === 'down' || direction === 'right' ? -1 : 1
  const strokes: { from: Point; to: Point; durationMs: number }[] = []
  for (let left = ticks * POINTS_PER_TICK; left > 0;) {
    const d = Math.min(left, side * SCROLL_STROKE_FRACTION)
    const c = vertical ? center.y : center.x
    const lo = side * SCROLL_LOW_FRACTION
    const hi = side * SCROLL_HIGH_FRACTION
    const [minStart, maxStart] = sign < 0 ? [lo + d, hi] : [lo, hi - d]
    const start = Math.min(Math.max(c - sign * d / 2, minStart), maxStart)
    const end = start + sign * d
    const durationMs = Math.trunc(d * SCROLL_MS_PER_POINT)
    strokes.push(vertical
      ? { from: { x: center.x, y: start }, to: { x: center.x, y: end }, durationMs }
      : { from: { x: start, y: center.y }, to: { x: end, y: center.y }, durationMs })
    left -= d
  }
  return strokes
}
