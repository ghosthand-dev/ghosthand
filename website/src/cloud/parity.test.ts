// The cloud side of the daemon's parity cases (daemon/Tests/ghosthandTests/fixtures/parity.json,
// copied here by pnpm generate-docs). The daemon runs the same file in parity-tests.swift.
import { expect, test } from 'vitest'
import parity from '../fixtures/daemon-parity.json'
import { checkWaitText, hasText, ocrScreen, pickText, scrollStrokes, type Direction } from './core.ts'

const SCROLL_DIGITS = 6

test('pickText answers like the daemon', () => {
  for (const c of parity.pickText) {
    const line = pickText({ lines: c.lines, text: c.text, index: c.index })
    const got = line instanceof Error ? { error: line.code, message: line.message } : { line }
    expect(got, c.name).toEqual(c.expect)
  }
})

test('waitText answers like the daemon', () => {
  for (const c of parity.waitText) {
    const wait = checkWaitText({ waitText: c.waitText, timeoutMs: c.timeoutMs })
    const lines = (c.lines ?? []).map((text) => ({ text, x: 0, y: 0, width: 0, height: 0, confidence: 1 }))
    const got = wait instanceof Error ? { error: wait.code } : wait ? { found: hasText({ lines, text: wait.text }) } : { noWait: true }
    expect(got, c.name).toEqual(c.expect)
  }
})

test('scrollStrokes answers like the daemon in XCTest mode', () => {
  for (const c of parity.scrollStrokes) {
    const center = c.at ?? { x: c.screen.width / 2, y: c.screen.height / 2 }
    const strokes = scrollStrokes({ direction: c.direction as Direction, ticks: c.ticks, center, screen: c.screen })
    expect(strokes.length, c.name).toBe(c.expect.length)
    strokes.forEach((s, i) => {
      const e = c.expect[i]!
      expect(s.durationMs, c.name).toBe(e.durationMs)
      for (const [got, want] of [[s.from.x, e.from[0]], [s.from.y, e.from[1]], [s.to.x, e.to[0]], [s.to.y, e.to[1]]] as const) {
        expect(got, c.name).toBeCloseTo(want!, SCROLL_DIGITS)
      }
    })
  }
})

test('ocrScreen shapes vphoned OCR like the daemon shapes Vision boxes', () => {
  for (const c of parity.ocrScreen) {
    // vphoned's blocks (icli recognizeScreen): box centers and sizes in screen points.
    const blocks = c.observations.map(({ text, confidence, box }) => ({
      text, confidence,
      x: (box.x + box.width / 2) * c.screen.width, y: (1 - (box.y + box.height / 2)) * c.screen.height,
      width: box.width * c.screen.width, height: box.height * c.screen.height,
    }))
    expect(ocrScreen({ result: { blocks }, screen: c.screen }), c.name).toEqual(c.expect)
  }
})
