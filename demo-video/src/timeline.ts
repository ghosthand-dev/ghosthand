// Data shared by scripts/prepare.ts (writes it) and the compositions (read it).
//
//   recording.mp4 + log.jsonl ──prepare.ts──> phone.mp4 (sped up) + timeline.json
//                                                   │                    │
//                                                   └──> <AgentDemo> <───┘
//
// All times in a Timeline are seconds of the sped-up phone video, not of the raw recording.

/** One line of log.jsonl written by the agent while it recorded the phone. Unix seconds. */
export type LogStep = {
  t: number
  tEnd: number
  thought: string
  cmd: string
  result: string
}

export type TimelineStep = {
  /** The tool call is shown, and the command starts on the phone. */
  at: number
  /** The command finished: the result is shown. */
  done: number
  thought: string
  cmd: string
  result: string
  /** The command failed: shown with a red dot. */
  error?: boolean
  /** Where and when a tap landed: 0..1 fractions of the screen, seconds of the phone video. */
  tap?: { x: number; y: number; at: number }
}

/** A piece of the raw recording played at a constant speed. */
export type Segment = { srcStart: number; srcEnd: number; outStart: number; speed: number }

export type Timeline = {
  /** Path inside public/, for staticFile(). */
  phoneVideo: string
  phoneWidth: number
  phoneHeight: number
  /** Duration of the sped-up phone video. */
  duration: number
  prompt: string
  final: string
  steps: TimelineStep[]
  segments: Segment[]
}

export type SpeedRules = {
  /** Output seconds for the time before the first command. */
  head: number
  /** A command runs on the phone: output = clamp(src / execSpeed, execMin, execMax). */
  execSpeed: number
  execMin: number
  execMax: number
  /** The agent thinks between commands: output = clamp(src / gapSpeed, gapMin, gapMax). */
  gapSpeed: number
  gapMin: number
  gapMax: number
  /** Output seconds kept after the last command, played at 1x if the recording has them. */
  tail: number
}

export const defaultSpeedRules: SpeedRules = {
  head: 0.4,
  execSpeed: 2.5,
  execMin: 0.35,
  execMax: 1.1,
  gapSpeed: 10,
  gapMin: 0.45,
  gapMax: 0.8,
  tail: 2,
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/**
 * Splits the raw recording into segments: each command and each pause between
 * commands gets its own speed, so pauses shrink more than visible actions.
 * Times are seconds from the recording start.
 */
export function buildSegments(
  steps: { start: number; end: number }[],
  recordingDuration: number,
  rules: SpeedRules = defaultSpeedRules,
): Segment[] {
  const pieces: { srcStart: number; srcEnd: number; out: number }[] = []
  const push = (srcStart: number, srcEnd: number, out: (src: number) => number) => {
    srcStart = clamp(srcStart, 0, recordingDuration)
    srcEnd = clamp(srcEnd, 0, recordingDuration)
    if (srcEnd - srcStart < 0.01) return
    pieces.push({ srcStart, srcEnd, out: out(srcEnd - srcStart) })
  }

  const first = steps[0]?.start ?? 0
  push(0, first, (src) => Math.min(src, rules.head))
  steps.forEach((step, i) => {
    const next = steps[i + 1]?.start ?? recordingDuration
    push(step.start, step.end, (src) => clamp(src / rules.execSpeed, rules.execMin, rules.execMax))
    if (i < steps.length - 1) {
      push(step.end, next, (src) => clamp(src / rules.gapSpeed, rules.gapMin, rules.gapMax))
    } else {
      push(step.end, next, (src) => Math.min(src, rules.tail))
    }
  })

  let outStart = 0
  return pieces.map((p) => {
    // Never slower than 1x: a piece shorter than its min clamp keeps its real length.
    const out = Math.min(p.out, p.srcEnd - p.srcStart)
    const segment = { srcStart: p.srcStart, srcEnd: p.srcEnd, outStart, speed: (p.srcEnd - p.srcStart) / out }
    outStart += out
    return segment
  })
}

/** Removes raw time ranges (popups, a dull ending) from the segments and closes the gaps. */
export function applyCuts(segments: Segment[], cuts: { start: number; end: number }[]): Segment[] {
  const kept: Omit<Segment, 'outStart'>[] = []
  for (const s of segments) {
    let pieces = [{ srcStart: s.srcStart, srcEnd: s.srcEnd }]
    for (const cut of cuts) {
      pieces = pieces.flatMap((p) =>
        [
          { srcStart: p.srcStart, srcEnd: Math.min(p.srcEnd, cut.start) },
          { srcStart: Math.max(p.srcStart, cut.end), srcEnd: p.srcEnd },
        ].filter((q) => q.srcEnd - q.srcStart > 0.01),
      )
    }
    kept.push(...pieces.map((p) => ({ ...p, speed: s.speed })))
  }
  let outStart = 0
  return kept.map((s) => {
    const segment = { ...s, outStart }
    outStart += (s.srcEnd - s.srcStart) / s.speed
    return segment
  })
}

export function segmentsDuration(segments: Segment[]): number {
  const last = segments.at(-1)
  return last ? last.outStart + (last.srcEnd - last.srcStart) / last.speed : 0
}

/** Maps a raw recording time to the sped-up video time. */
export function mapTime(segments: Segment[], src: number): number {
  for (const s of segments) {
    if (src <= s.srcEnd) return s.outStart + Math.max(0, src - s.srcStart) / s.speed
  }
  return segmentsDuration(segments)
}

/** Playback speed of the sped-up video at an output time. */
export function speedAt(segments: Segment[], out: number): number {
  let speed = 1
  for (const s of segments) {
    if (s.outStart > out) break
    speed = s.speed
  }
  return speed
}
