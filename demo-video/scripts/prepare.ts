// Turns a raw ghosthand recording plus the agent's log into a sped-up phone video and a timeline.
//
//   pnpm tsx scripts/prepare.ts --input ../tmp/demo-tiktok --out public/tiktok \
//     --prompt 'upload this video to tiktok' --final 'Done. The video is posted on TikTok.'
//
// Input folder: recording.mp4 (ghosthand record), start.txt (unix seconds at record start),
// log.jsonl (one LogStep per line). Each segment is encoded with an exact frame count, then
// concatenated, so step times in timeline.json never drift from the video.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { applyCuts, buildSegments, defaultSpeedRules, mapTime, segmentsDuration, type LogStep, type Timeline } from '../src/timeline.ts'

const FPS = 30

const { values: args } = parseArgs({
  options: {
    input: { type: 'string' },
    out: { type: 'string' },
    prompt: { type: 'string' },
    final: { type: 'string' },
    // Seconds to add to every log time, if start.txt was taken late or early.
    offset: { type: 'string', default: '0' },
    // Raw recording seconds to remove, e.g. a popup: --cut 39.5-48 --cut 168-172. Steps starting inside are dropped.
    cut: { type: 'string', multiple: true, default: [] },
  },
})
if (!args.input || !args.out || !args.prompt || !args.final) {
  throw new Error('usage: prepare.ts --input <dir> --out <public/dir> --prompt <text> --final <text> [--offset s]')
}

const input = path.resolve(args.input)
const outDir = path.resolve(args.out)
const recording = ['recording.mp4', 'recording.mov'].map((f) => path.join(input, f)).find((f) => fs.existsSync(f))
if (!recording) throw new Error(`no recording.mp4 or recording.mov in ${input}`)

const probe = JSON.parse(
  execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', recording], {
    encoding: 'utf8',
  }),
)
const { width, height } = probe.streams[0]
const recordingDuration = Number(probe.format.duration)
console.log(`recording ${path.basename(recording)}: ${width}x${height}, ${recordingDuration.toFixed(1)}s`)

const start = Number(fs.readFileSync(path.join(input, 'start.txt'), 'utf8').trim()) - Number(args.offset)
const log: (LogStep & { error?: boolean })[] = fs
  .readFileSync(path.join(input, 'log.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim())
  .map((line) => JSON.parse(line))
  // Starting and stopping the recording is not part of the task.
  .filter((step) => !/\bghosthand record (start|stop)\b/.test(step.cmd))
  .sort((a, b) => a.t - b.t)
console.log(`log: ${log.length} steps`)

// Long paths make tool calls unreadable: `.build/debug/ghosthand` -> `ghosthand`, `tmp/x/step.png` -> `step.png`.
const shortenPaths = (text: string) => text.replace(/\S*\/(ghosthand)\b/g, '$1').replace(/(?:[\w.~-]*\/)+([\w.-]+\.(?:png|jpe?g|mp4|mov))/g, '$1')
// The agent's shell quoting, `'Don'\''t Allow'`, reads better as "Don't Allow".
const prettyQuotes = (cmd: string) => cmd.replace(/'([^']*)'\\''([^']*)'/g, `"$1'$2"`)
const sentence = (text: string) => (text && !/[.!?:…]$/.test(text) ? `${text}.` : text)
// Agents write results as `action; screenshot info; ocr line; ocr line...`: one line per part, OCR joined.
function displayResult(result: string): string {
  const [first, ...rest] = shortenPaths(result).split('; ').map((part) => part.trim()).filter(Boolean)
  // The screenshot file line (`step.png 375x667`) adds nothing next to the command's --screenshot flag.
  // OCR noise like `•ll`, `< G` or the 09:41 clock has fewer than 3 letters: drop it.
  const ocr = rest.filter((part) => !part.startsWith('[ghosthand]') && !/\.(png|jpe?g)\s+\d+x\d+$/.test(part) && (part.match(/[a-z]/gi)?.length ?? 0) >= 3)
  return [first.replace(/\s+/g, ' '), ...(ocr.length ? [ocr.join(' · ')] : [])].join('\n')
}

// `tapped 114,437` in screenshot points. The screen is 1/2 of the recording on 2x iPhones.
const tapSpace = { width: width / 2, height: height / 2 }
function tapPoint(result: string) {
  const match = /\btapped (\d+(?:\.\d+)?),\s*(\d+(?:\.\d+)?)/.exec(result)
  return match ? { x: Number(match[1]) / tapSpace.width, y: Number(match[2]) / tapSpace.height } : undefined
}

const cuts = args.cut.map((range) => {
  const [from, to] = range.split('-').map(Number)
  if (!(to > from)) throw new Error(`bad --cut ${range}, expected start-end in seconds`)
  return { start: from, end: to }
})
const inCut = (time: number) => cuts.some((c) => time >= c.start && time < c.end)
const kept = log.filter((step) => !inCut(step.t - start))
if (kept.length < log.length) console.log(`cuts drop ${log.length - kept.length} steps`)
log.splice(0, log.length, ...kept)

const raw = log.map((step) => ({ start: step.t - start, end: step.tEnd - start }))
const outside = raw.filter((s) => s.start < 0 || s.start > recordingDuration)
if (outside.length) console.warn(`warning: ${outside.length} steps start outside the recording; check start.txt or --offset`)

const segments = applyCuts(buildSegments(raw, recordingDuration, defaultSpeedRules), cuts)
const duration = segmentsDuration(segments)
console.log(`segments: ${segments.length}, sped-up duration ${duration.toFixed(1)}s (${(recordingDuration / duration).toFixed(1)}x overall)`)

const workDir = path.join(outDir, '.segments')
fs.rmSync(workDir, { recursive: true, force: true })
fs.mkdirSync(workDir, { recursive: true })

const parts: string[] = []
segments.forEach((s, i) => {
  const outEnd = s.outStart + (s.srcEnd - s.srcStart) / s.speed
  const frames = Math.round(outEnd * FPS) - Math.round(s.outStart * FPS)
  if (frames <= 0) return
  const file = path.join(workDir, `${String(i).padStart(4, '0')}.mp4`)
  // tpad clones the last frame, so a short or sparse (variable frame rate) segment still fills its frames.
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    '-ss', s.srcStart.toFixed(3), '-i', recording, '-t', (s.srcEnd - s.srcStart).toFixed(3),
    '-an',
    '-vf', `setpts=(PTS-STARTPTS)/${s.speed.toFixed(4)},fps=${FPS},tpad=stop_mode=clone:stop=${FPS}`,
    '-frames:v', String(frames),
    '-c:v', 'libx264', '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p',
    file,
  ])
  parts.push(file)
  console.log(`segment ${i + 1}/${segments.length}: src ${s.srcStart.toFixed(1)}-${s.srcEnd.toFixed(1)}s at ${s.speed.toFixed(1)}x -> ${frames} frames`)
})

const listFile = path.join(workDir, 'list.txt')
fs.writeFileSync(listFile, parts.map((p) => `file '${p}'`).join('\n'))
const phoneFile = path.join(outDir, 'phone.mp4')
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', phoneFile])
fs.rmSync(workDir, { recursive: true, force: true })
console.log(`wrote ${phoneFile}`)

const publicDir = path.join(import.meta.dirname, '..', 'public')
const timeline: Timeline = {
  phoneVideo: path.relative(publicDir, phoneFile),
  phoneWidth: width,
  phoneHeight: height,
  duration,
  prompt: args.prompt,
  final: args.final,
  steps: log.map((step, i) => {
    const point = tapPoint(step.result)
    // The pointer travels before it presses: about 1.2 s after the command starts (measured in recordings).
    const tap = point && { ...point, at: mapTime(segments, raw[i].start + Math.min(1.2, (raw[i].end - raw[i].start) / 2)) }
    return {
      at: mapTime(segments, raw[i].start),
      done: mapTime(segments, raw[i].end),
      thought: sentence(step.thought),
      cmd: prettyQuotes(shortenPaths(step.cmd)),
      result: displayResult(step.result),
      ...(tap ? { tap } : {}),
      ...(step.error ? { error: true } : {}),
    }
  }),
  segments,
}
const timelineFile = path.join(outDir, 'timeline.json')
fs.writeFileSync(timelineFile, JSON.stringify(timeline, null, 2) + '\n')
console.log(`wrote ${timelineFile}`)
