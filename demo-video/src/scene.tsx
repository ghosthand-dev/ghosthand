// AgentDemo: the sped-up phone recording on the left, the agent terminal on the right.
//
//   0s ── prompt typed and sent ── INTRO ── phone video + tool calls ── final message ── end card
//
// Every time in a Timeline is relative to the phone video, so this scene shifts them by `intro`.
import { Audio, Video } from '@remotion/media'
import { AbsoluteFill, Freeze, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { AgentTerminal, colors, monoFont, sansFont, type ChatItem } from './terminal.tsx'
import { PhoneMockup, TapRipple, phoneBodySize } from './phone.tsx'
import { speedAt, type Timeline } from './timeline.ts'

export type AgentDemoProps = {
  timeline: Timeline
  title: string
  cwd: string
  /** Tool name shown in tool calls, e.g. Bash. */
  toolName: string
  /** Image in public/, shown full bleed behind everything. */
  background: string
  /** Dynamic Island on the phone. Off for iPhone SE recordings: it would cover the clock. */
  island: boolean
  tagline: string
  url: string
}

const TYPE_START = 0.9
const TYPE_CHARS_PER_SECOND = 19
const END_CARD = 4.6

/** Scene times, in seconds, derived from the timeline. */
export function demoSchedule(timeline: Timeline) {
  const typeEnd = TYPE_START + timeline.prompt.length / TYPE_CHARS_PER_SECOND
  const sent = typeEnd + 0.25
  const intro = sent + 1.1
  const lastDone = Math.max(0, ...timeline.steps.map((s) => s.done))
  const final = intro + Math.min(lastDone + 0.7, timeline.duration)
  const phoneEnd = intro + timeline.duration
  const endCard = Math.max(phoneEnd, final + 2.2)
  return { typeEnd, sent, intro, final, phoneEnd, endCard, total: endCard + END_CARD }
}

/** Chat items, spinner ranges and tap ripples, in scene seconds. */
function demoEvents(timeline: Timeline, toolName: string) {
  const s = demoSchedule(timeline)
  const items: ChatItem[] = [{ kind: 'user', at: s.sent, text: timeline.prompt }]
  const thinking: { from: number; to: number }[] = []
  const taps: { x: number; y: number; at: number }[] = []
  let busyUntil = s.sent + 0.15
  let lastThought = ''
  for (const step of timeline.steps) {
    const at = s.intro + step.at
    const thoughtAt = Math.max(busyUntil + 0.1, at - 0.5)
    if (thoughtAt - busyUntil > 0.35) thinking.push({ from: busyUntil, to: thoughtAt })
    if (step.thought && step.thought !== lastThought) items.push({ kind: 'text', at: thoughtAt, text: step.thought })
    lastThought = step.thought
    const done = s.intro + step.done
    items.push({ kind: 'tool', at, done, name: toolName, input: step.cmd, result: step.result, error: step.error })
    if (step.tap) taps.push({ ...step.tap, at: s.intro + step.tap.at })
    busyUntil = done + 0.12
  }
  if (s.final - busyUntil > 0.35) thinking.push({ from: busyUntil, to: s.final })
  items.push({ kind: 'text', at: s.final, text: timeline.final })
  return { items, thinking, taps }
}

function Sfx({ at, name, volume = 1 }: { at: number; name: string; volume?: number }) {
  const { fps } = useVideoConfig()
  return (
    <Sequence from={Math.round(at * fps)} durationInFrames={Math.round(2 * fps)} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  )
}

function soundCues(timeline: Timeline, { items, taps }: ReturnType<typeof demoEvents>) {
  const s = demoSchedule(timeline)
  const cues: { at: number; name: string; volume: number }[] = []
  for (let i = 0; i < timeline.prompt.length; i++) {
    if (timeline.prompt[i] === ' ' && i % 2 === 0) continue
    // Deterministic jitter, so typing does not sound like a metronome.
    const jitter = ((i * 37) % 7) / 7 - 0.5
    cues.push({ at: TYPE_START + (i + 0.5 + jitter * 0.35) / TYPE_CHARS_PER_SECOND, name: `key-${(i * 3) % 4 + 1}`, volume: 0.55 + 0.25 * Math.abs(jitter) })
  }
  cues.push({ at: s.sent, name: 'send', volume: 0.7 })
  for (const item of items) {
    if (item.kind !== 'tool') continue
    cues.push({ at: item.at, name: 'tool', volume: 0.4 })
  }
  // A tap step already has the tap pop; a result blip on top of it sounds busy.
  for (const tap of taps) cues.push({ at: tap.at, name: 'tap', volume: 0.75 })
  timeline.steps.forEach((step) => {
    if (!step.tap) cues.push({ at: s.intro + step.done, name: 'result', volume: 0.3 })
  })
  cues.push({ at: s.final, name: 'success', volume: 0.6 })
  return cues
}

function Background({ src }: { src: string }) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // Very slow push in, so the still image feels alive.
  const scale = interpolate(frame, [0, durationInFrames], [1.02, 1.1])
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})` }} />
    </AbsoluteFill>
  )
}

function EndCard({ start, tagline, url }: { start: number; tagline: string; url: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const f = frame - Math.round(start * fps)
  if (f < 0) return null
  const fade = interpolate(f, [0, 14], [0, 1], { extrapolateRight: 'clamp' })
  const pop = spring({ frame: f - 4, fps, config: { damping: 16, stiffness: 120 } })
  return (
    <AbsoluteFill style={{ background: `rgba(8, 24, 60, ${0.45 * fade})`, backdropFilter: `blur(${28 * fade}px)`, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 22, opacity: fade, transform: `scale(${0.94 + 0.06 * pop})` }}>
        <Img src={staticFile('ghosthand-icon.png')} style={{ width: 150, height: 150, filter: 'drop-shadow(0 16px 40px rgba(0, 20, 60, 0.45))' }} />
        <div style={{ fontFamily: sansFont, fontSize: 92, fontWeight: 700, color: '#fff', letterSpacing: -2.5 }}>ghosthand</div>
        <div style={{ fontFamily: sansFont, fontSize: 38, fontWeight: 500, color: 'rgba(255,255,255,0.85)' }}>{tagline}</div>
        <div style={{ fontFamily: monoFont, fontSize: 30, color: '#fff', marginTop: 14, padding: '10px 26px', borderRadius: 999, background: 'rgba(255,255,255,0.16)', border: '1px solid rgba(255,255,255,0.3)' }}>
          {url}
        </div>
      </div>
    </AbsoluteFill>
  )
}

// Layout: equal outer margins, phone and terminal share the same top and height.
const MARGIN_X = 96
const GAP = 72
const PHONE_HEIGHT = 940

export function AgentDemo({ timeline, title, cwd, toolName, background, island, tagline, url }: AgentDemoProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const t = frame / fps
  const s = demoSchedule(timeline)
  const events = demoEvents(timeline, toolName)
  const { items, thinking, taps } = events

  const bodyChrome = phoneBodySize(0, 0)
  const screenHeight = PHONE_HEIGHT - bodyChrome.height
  const screenWidth = (screenHeight * timeline.phoneWidth) / timeline.phoneHeight
  const body = phoneBodySize(screenWidth, screenHeight)
  const top = (height - body.height) / 2
  const termLeft = MARGIN_X + body.width + GAP
  const termWidth = width - termLeft - MARGIN_X

  const enter = (delay: number) => spring({ frame: frame - Math.round(delay * fps), fps, config: { damping: 22, stiffness: 90 } })
  const phoneIn = enter(0)
  const termIn = enter(0.12)

  const phoneT = t - s.intro
  // Average over 6 seconds, so the label does not flicker between segments.
  const window = [-3, -2.5, -2, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2, 2.5, 3]
  const speed = phoneT < 0 || phoneT > timeline.duration ? 1 : window.reduce((sum, d) => sum + speedAt(timeline.segments, phoneT + d), 0) / window.length
  const speedLabel = speed > 1.4 ? (
    <span>
      <span style={{ color: colors.claude }}>▶▶</span> phone {Math.round(speed)}× speed
    </span>
  ) : (
    <span>▶ phone real time</span>
  )
  const video = <Video src={staticFile(timeline.phoneVideo)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

  return (
    <AbsoluteFill>
      <Background src={background} />
      <div style={{ position: 'absolute', left: MARGIN_X, top, opacity: phoneIn, transform: `translateY(${(1 - phoneIn) * 60}px)` }}>
        <PhoneMockup screenWidth={screenWidth} screenHeight={screenHeight} island={island}>
          {/* Before the phone video starts, hold its first frame; after it ends, hold the last. */}
          {t < s.intro ? <Freeze frame={0}>{video}</Freeze> : null}
          <Sequence from={Math.round(s.intro * fps)} durationInFrames={Math.round(timeline.duration * fps)}>
            {video}
          </Sequence>
          {t >= s.phoneEnd ? <Freeze frame={Math.round(timeline.duration * fps) - 1}>{video}</Freeze> : null}
          {taps.map((tap, i) => (
            <TapRipple key={i} x={tap.x} y={tap.y} at={tap.at} t={t} />
          ))}
        </PhoneMockup>
      </div>
      <div style={{ position: 'absolute', left: termLeft, top, opacity: termIn, transform: `translateY(${(1 - termIn) * 60}px)` }}>
        <AgentTerminal
          items={items}
          thinking={thinking}
          draft={{ text: timeline.prompt, start: TYPE_START, end: s.typeEnd }}
          cwd={cwd}
          title={title}
          width={termWidth}
          height={body.height}
          footerRight={speedLabel}
        />
      </div>
      {soundCues(timeline, events).map((cue, i) => (
        <Sfx key={i} {...cue} />
      ))}
      <EndCard start={s.endCard} tagline={tagline} url={url} />
    </AbsoluteFill>
  )
}
