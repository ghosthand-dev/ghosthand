// AgentDemo: a full screen prompt, then the sped-up phone recording next to the agent terminal.
//
//   prompt typed full screen ─ enter ─ window morphs to the right ─ plan ─ phone video + tool calls ─ end card
//
// Every time in a Timeline is relative to the phone video, so this scene shifts them by `intro`.
import { Audio, Video } from '@remotion/media'
import { AbsoluteFill, Easing, Freeze, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { AgentTerminal, WindowChrome, colors, monoFont, sansFont, todoGlyph, windowStyle, type ChatItem, type Todo } from './terminal.tsx'
import { PhoneMockup, TapRipple, phoneBodySize, phoneScreenHeight } from './phone.tsx'
import { speedAt, type Timeline } from './timeline.ts'

export type PlanItem = {
  text: string
  /** The item starts at the first step whose thought contains this text. */
  from: string
}

export type AgentDemoProps = {
  timeline: Timeline
  /** The agent's todo list, shown as a TodoWrite call and a pinned panel. */
  plan: PlanItem[]
  title: string
  cwd: string
  /** Tool name shown in tool calls, e.g. Bash. */
  toolName: string
  /** Image in public/, shown full bleed behind everything. */
  background: string
  tagline: string
  url: string
}

const TYPE_START = 1.0
const TYPE_CHARS_PER_SECOND = 15
const MORPH = 1.2
const END_CARD = 4.6

const easeOut = Easing.bezier(0.16, 1, 0.3, 1)
// Starts gently, then glides into place: the move does not bunch up in the middle.
const easeInOut = Easing.bezier(0.45, 0, 0.15, 1)
const progress = (t: number, from: number, duration: number, easing = easeOut) =>
  interpolate(t, [from, from + duration], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing })

/** Scene times, in seconds, derived from the timeline. */
export function demoSchedule(timeline: Timeline) {
  const typeEnd = TYPE_START + timeline.prompt.length / TYPE_CHARS_PER_SECOND
  const enter = typeEnd + 0.5
  const morphEnd = enter + MORPH
  const sent = morphEnd - 0.3
  const plan = sent + 0.8
  const intro = plan + 1.4
  const lastDone = Math.max(0, ...timeline.steps.map((s) => s.done))
  const final = intro + Math.min(lastDone + 0.7, timeline.duration)
  const phoneEnd = intro + timeline.duration
  const endCard = Math.max(phoneEnd, final + 2.4)
  return { typeEnd, enter, morphEnd, sent, plan, intro, final, phoneEnd, endCard, total: endCard + END_CARD }
}

function planTodos(timeline: Timeline, plan: PlanItem[]): Todo[] {
  const s = demoSchedule(timeline)
  const starts = plan.map((item) => {
    const step = timeline.steps.find((st) => st.thought.includes(item.from))
    if (!step) throw new Error(`plan item "${item.text}": no step thought contains "${item.from}"`)
    return s.intro + step.at - 0.3
  })
  return plan.map((item, i) => ({ text: item.text, start: starts[i], done: starts[i + 1] ?? s.final }))
}

/** Chat items, spinner ranges, todos and tap ripples, in scene seconds. */
function demoEvents(timeline: Timeline, plan: PlanItem[], toolName: string) {
  const s = demoSchedule(timeline)
  const todos = planTodos(timeline, plan)
  const planDone = s.plan + 0.45
  const items: ChatItem[] = [
    { kind: 'user', at: s.sent, text: timeline.prompt },
    { kind: 'tool', at: s.plan, done: planDone, name: 'Update Todos', result: todos.map((todo) => `${todoGlyph.pending} ${todo.text}`).join('\n'), fullResult: true },
  ]
  const thinking: { from: number; to: number }[] = [{ from: s.sent + 0.15, to: s.plan }]
  const taps: { x: number; y: number; at: number }[] = []
  let busyUntil = planDone + 0.12
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
  return { items, thinking, taps, todos, todosFrom: planDone }
}

function Sfx({ at, name, volume = 1 }: { at: number; name: string; volume?: number }) {
  const { fps } = useVideoConfig()
  return (
    <Sequence from={Math.round(at * fps)} durationInFrames={Math.round(2 * fps)} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  )
}

function soundCues(timeline: Timeline, { items, taps, todos }: ReturnType<typeof demoEvents>) {
  const s = demoSchedule(timeline)
  const cues: { at: number; name: string; volume: number }[] = []
  for (let i = 0; i < timeline.prompt.length; i++) {
    if (timeline.prompt[i] === ' ' && i % 2 === 0) continue
    // Deterministic jitter, so typing does not sound like a metronome.
    const jitter = ((i * 37) % 7) / 7 - 0.5
    cues.push({ at: TYPE_START + (i + 0.5 + jitter * 0.35) / TYPE_CHARS_PER_SECOND, name: `key-${(i * 3) % 4 + 1}`, volume: 0.55 + 0.25 * Math.abs(jitter) })
  }
  cues.push({ at: s.enter, name: 'key-1', volume: 0.9 })
  cues.push({ at: s.enter + 0.05, name: 'send', volume: 0.8 })
  for (const item of items) {
    if (item.kind === 'tool') cues.push({ at: item.at, name: 'tool', volume: 0.4 })
  }
  // A tap step already has the tap pop; a result blip on top of it sounds busy.
  for (const tap of taps) cues.push({ at: tap.at, name: 'tap', volume: 0.75 })
  timeline.steps.forEach((step) => {
    if (!step.tap) cues.push({ at: s.intro + step.done, name: 'result', volume: 0.3 })
  })
  for (const todo of todos.slice(0, -1)) cues.push({ at: todo.done, name: 'result', volume: 0.45 })
  cues.push({ at: s.final, name: 'success', volume: 0.6 })
  return cues
}

type Rect = { left: number; top: number; width: number; height: number }

const lerpRect = (a: Rect, b: Rect, p: number): Rect => ({
  left: a.left + (b.left - a.left) * p,
  top: a.top + (b.top - a.top) * p,
  width: a.width + (b.width - a.width) * p,
  height: a.height + (b.height - a.height) * p,
})

/** Full screen Claude Code window where the prompt is typed. On enter it morphs into the terminal rect. */
function IntroPrompt({ prompt, cwd, title, from, to, t, s }: { prompt: string; cwd: string; title: string; from: Rect; to: Rect; t: number; s: ReturnType<typeof demoSchedule> }) {
  if (t >= s.morphEnd) return null
  const appear = progress(t, 0, 0.9)
  const morph = progress(t, s.enter, MORPH, easeInOut)
  // A short press on enter, before the window moves.
  const press = interpolate(t, [s.enter, s.enter + 0.08, s.enter + 0.3], [1, 0.985, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const rect = lerpRect(from, to, morph)
  // The content shrinks with the window, then fades before the real terminal fades in.
  const contentOpacity = 1 - progress(t, s.morphEnd - 0.3, 0.3, Easing.linear)
  const contentScale = rect.width / from.width
  const typed = prompt.slice(0, Math.round(interpolate(t, [TYPE_START, s.typeEnd], [0, prompt.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })))
  const typing = t > TYPE_START && t < s.typeEnd
  const cursorOn = typing || Math.floor(t * 2.2) % 2 === 0
  const fontSize = 66
  return (
    <div
      style={{
        ...windowStyle,
        position: 'absolute',
        ...rect,
        borderRadius: 18 + 6 * (1 - morph),
        opacity: appear,
        transform: `translateY(${(1 - appear) * 40}px) scale(${(0.96 + 0.04 * appear) * press})`,
        filter: `blur(${(1 - appear) * 10}px)`,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <WindowChrome title={title} />
      <div
        style={{
          opacity: contentOpacity,
          width: from.width,
          height: from.height - 58,
          transform: `scale(${contentScale})`,
          transformOrigin: 'top left',
          padding: '0 72px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: 44,
          fontFamily: monoFont,
          color: colors.text,
        }}
      >
        <div style={{ fontSize: 32, lineHeight: 1.5, border: `2px solid ${colors.claude}`, borderRadius: 14, padding: '16px 30px', width: 'fit-content' }}>
          <div>
            <span style={{ color: colors.claude }}>✻ </span>Welcome to <span style={{ fontWeight: 700 }}>Claude Code</span>!
          </div>
          <div style={{ color: colors.dim }}>  cwd: {cwd}</div>
        </div>
        <div style={{ border: `2px solid ${colors.faint}`, borderRadius: 18, padding: '30px 36px', fontSize, lineHeight: 1.3, whiteSpace: 'pre', display: 'flex', alignItems: 'center' }}>
          <span style={{ color: colors.dim }}>{'> '}</span>
          <span>{typed}</span>
          <span style={{ display: 'inline-block', width: fontSize * 0.55, height: fontSize * 1.05, marginLeft: 2, background: cursorOn ? colors.text : 'transparent' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, color: colors.faint, padding: '0 10px' }}>
          <span>? for shortcuts</span>
          <span style={{ color: t >= s.typeEnd ? colors.dim : colors.faint }}>↵ send</span>
        </div>
      </div>
    </div>
  )
}

/** `focus` 0..1: 0 blurs and dims the image behind the intro prompt. */
function Background({ src, focus }: { src: string; focus: number }) {
  const frame = useCurrentFrame()
  const { durationInFrames } = useVideoConfig()
  // Very slow push in, so the still image feels alive.
  const scale = interpolate(frame, [0, durationInFrames], [1.06, 1.12])
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <Img src={staticFile(src)} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${scale})`, filter: `blur(${(1 - focus) * 22}px)` }} />
      <AbsoluteFill style={{ background: `rgba(4, 14, 38, ${(1 - focus) * 0.35})` }} />
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

export function AgentDemo({ timeline, plan, title, cwd, toolName, background, tagline, url }: AgentDemoProps) {
  const frame = useCurrentFrame()
  const { fps, width, height } = useVideoConfig()
  const t = frame / fps
  const s = demoSchedule(timeline)
  const events = demoEvents(timeline, plan, toolName)
  const { items, thinking, taps, todos, todosFrom } = events

  const screenHeight = phoneScreenHeight(PHONE_HEIGHT)
  const screenWidth = (screenHeight * timeline.phoneWidth) / timeline.phoneHeight
  const body = phoneBodySize(screenWidth, screenHeight)
  const top = (height - body.height) / 2
  const termRect: Rect = { left: MARGIN_X + body.width + GAP, top, width: width - (MARGIN_X + body.width + GAP) - MARGIN_X, height: body.height }
  const introRect: Rect = { left: (width - 1600) / 2, top: (height - 720) / 2, width: 1600, height: 720 }

  const focus = progress(t, s.enter + 0.1, MORPH, easeInOut)
  // Crossfades with the shrinking intro content, so the window is never empty.
  const termOpacity = progress(t, s.morphEnd - 0.5, 0.3, Easing.linear)
  const phoneIn = progress(t, s.enter + 0.45, 1.0)

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
      <Background src={background} focus={focus} />
      <div
        style={{
          position: 'absolute',
          left: MARGIN_X,
          top,
          opacity: phoneIn,
          transform: `translateX(${(1 - phoneIn) * -120}px) scale(${0.94 + 0.06 * phoneIn})`,
          transformOrigin: 'left center',
        }}
      >
        <PhoneMockup screenWidth={screenWidth} screenHeight={screenHeight}>
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
      {termOpacity > 0 && (
        <div style={{ position: 'absolute', left: termRect.left, top: termRect.top, opacity: termOpacity }}>
          <AgentTerminal
            items={items}
            todos={todos}
            todosFrom={todosFrom}
            thinking={thinking}
            cwd={cwd}
            title={title}
            width={termRect.width}
            height={termRect.height}
            footerRight={speedLabel}
          />
        </div>
      )}
      <IntroPrompt prompt={timeline.prompt} cwd={cwd} title={title} from={introRect} to={termRect} t={t} s={s} />
      {soundCues(timeline, events).map((cue, i) => (
        <Sfx key={i} {...cue} />
      ))}
      <EndCard start={s.endCard} tagline={tagline} url={url} />
    </AbsoluteFill>
  )
}
