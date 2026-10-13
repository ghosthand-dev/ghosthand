// Claude Code style terminal: a transcript of chat items that grows and scrolls smoothly.
//
// Remotion renders every frame on its own, so nothing is measured in the DOM. The font is
// monospace, so text wraps at a known column count and every row has a known height:
// the scroll offset is pure math on the current time.
import type { CSSProperties, ReactNode } from 'react'
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion'
import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono'
import { loadFont as loadSans } from '@remotion/google-fonts/Inter'

export const monoFont = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] }).fontFamily
export const sansFont = loadSans('normal', { weights: ['400', '500', '600', '700'], subsets: ['latin'] }).fontFamily

export const colors = {
  window: '#1b1a19',
  chrome: '#252321',
  border: 'rgba(255, 255, 255, 0.09)',
  text: '#ece9e4',
  dim: '#8f8a83',
  faint: '#5c5853',
  claude: '#d97757',
  green: '#5fc27a',
  red: '#f06b6b',
  userBg: 'rgba(255, 255, 255, 0.06)',
}

export type ChatItem =
  | { kind: 'user'; at: number; text: string }
  | { kind: 'text'; at: number; text: string }
  | { kind: 'tool'; at: number; done?: number; name: string; input: string; result?: string; error?: boolean }

export type TerminalMetrics = { fontSize: number; lineHeight: number; charWidth: number }

/** JetBrains Mono advance width is 0.6em. */
export function terminalMetrics(fontSize: number): TerminalMetrics {
  return { fontSize, lineHeight: Math.round(fontSize * 1.55), charWidth: fontSize * 0.6 }
}

/** Word wrap for a monospace column count. Long words are hard-split. */
export function wrapText(text: string, cols: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const word of paragraph.split(' ')) {
      let rest = word
      while (rest.length > cols) {
        if (line) lines.push(line)
        lines.push(rest.slice(0, cols))
        rest = rest.slice(cols)
        line = ''
      }
      if (!line) line = rest
      else if (line.length + 1 + rest.length <= cols) line += ' ' + rest
      else {
        lines.push(line)
        line = rest
      }
    }
    lines.push(line)
  }
  return lines
}

type Span = { text: string; style?: CSSProperties }

/** One rendered row. It grows from 0 to full height at `at`, so the transcript scrolls smoothly. */
type Row = { key: string; at: number; gapBefore: number; render: (t: number) => ReactNode }

const STREAM_CHARS_PER_SECOND = 140

function Dot({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return <span style={{ color, opacity }}>⏺</span>
}

function buildRows(items: ChatItem[], cols: number, m: TerminalMetrics, maxResultRows: number): Row[] {
  const rows: Row[] = []
  const gap = m.lineHeight * 0.55
  items.forEach((item, i) => {
    const key = `${i}`
    if (item.kind === 'user') {
      wrapText(item.text, cols - 4).forEach((line, j) => {
        rows.push({
          key: `${key}-${j}`,
          at: item.at,
          gapBefore: j === 0 ? gap : 0,
          render: () => (
            <div style={{ background: colors.userBg, color: colors.dim, paddingLeft: m.charWidth }}>
              <span>{j === 0 ? '> ' : '  '}</span>
              <span style={{ color: colors.text }}>{line}</span>
            </div>
          ),
        })
      })
      return
    }
    if (item.kind === 'text') {
      const lines = wrapText(item.text, cols - 2)
      let charsBefore = 0
      lines.forEach((line, j) => {
        const lineStart = item.at + charsBefore / STREAM_CHARS_PER_SECOND
        charsBefore += line.length + 1
        rows.push({
          key: `${key}-${j}`,
          at: lineStart,
          gapBefore: j === 0 ? gap : 0,
          render: (t) => {
            const shown = Math.max(0, Math.floor((t - lineStart) * STREAM_CHARS_PER_SECOND))
            return (
              <div style={{ color: colors.text }}>
                {j === 0 ? <Dot color={colors.text} /> : ' '} {line.slice(0, shown)}
              </div>
            )
          },
        })
      })
      return
    }
    // Tool call: `⏺ Name(input)` then `  ⎿  result` once done.
    const head = wrapText(`${item.name}(${item.input})`, cols - 2)
    head.forEach((line, j) => {
      const nameEnd = j === 0 ? item.name.length : 0
      rows.push({
        key: `${key}-h${j}`,
        at: item.at,
        gapBefore: j === 0 ? gap : 0,
        render: (t) => {
          const running = item.done === undefined || t < item.done
          const blink = running ? 0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * 2.2)) : 1
          const dotColor = running ? colors.dim : item.error ? colors.red : colors.green
          return (
            <div style={{ color: colors.text }}>
              {j === 0 ? <Dot color={dotColor} opacity={blink} /> : ' '}{' '}
              <span style={{ fontWeight: 700 }}>{line.slice(0, nameEnd)}</span>
              <span style={{ color: colors.text }}>{line.slice(nameEnd)}</span>
            </div>
          )
        },
      })
    })
    if (item.result === undefined || item.done === undefined) return
    // One row per result line, cut with an ellipsis, like a collapsed Claude Code tool result.
    let result = item.result.split('\n').map((line) => (line.length > cols - 5 ? `${line.slice(0, cols - 6)}…` : line))
    if (result.length > maxResultRows) {
      const hidden = result.length - (maxResultRows - 1)
      result = [...result.slice(0, maxResultRows - 1), `… +${hidden} lines (ctrl+r to expand)`]
    }
    result.forEach((line, j) => {
      rows.push({
        key: `${key}-r${j}`,
        at: item.done!,
        gapBefore: 0,
        render: () => (
          <div style={{ color: item.error ? colors.red : colors.dim }}>
            {j === 0 ? '  ⎿  ' : '     '}
            {line}
          </div>
        ),
      })
    })
  })
  return rows
}

const SPINNER_GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const SPINNER_VERBS = ['Thinking', 'Looking', 'Tapping', 'Pondering', 'Noodling', 'Scrolling', 'Percolating', 'Reading', 'Clauding', 'Considering']

function Spinner({ t, from, index, m }: { t: number; from: number; index: number; m: TerminalMetrics }) {
  const glyph = SPINNER_GLYPHS[Math.floor(t * 9) % SPINNER_GLYPHS.length]
  const verb = SPINNER_VERBS[index % SPINNER_VERBS.length]
  // A light band sweeps across the verb, like the shimmer in Claude Code.
  const sweep = ((t - from) * 1.6) % 1.6
  const letters = `${verb}…`.split('').map((ch, i, all) => {
    const dist = Math.abs(i / all.length - sweep + 0.3)
    const light = interpolate(dist, [0, 0.25], [1, 0], { extrapolateRight: 'clamp' })
    return (
      <span key={i} style={{ color: light > 0.05 ? `color-mix(in srgb, #ffd2bf ${light * 100}%, ${colors.claude})` : colors.claude }}>
        {ch}
      </span>
    )
  })
  return (
    <div style={{ height: m.lineHeight, color: colors.claude }}>
      <span style={{ display: 'inline-block', width: m.charWidth * 2 }}>{glyph}</span>
      {letters}
      <span style={{ color: colors.dim }}> ({Math.max(1, Math.floor(t - from))}s · esc to interrupt)</span>
    </div>
  )
}

export type AgentTerminalProps = {
  items: ChatItem[]
  /** Time ranges where the agent is working: a spinner shows below the last item. */
  thinking: { from: number; to: number }[]
  /** Text typed into the input box between `start` and `end`, then sent. */
  draft?: { text: string; start: number; end: number }
  cwd: string
  title: string
  width: number
  height: number
  fontSize?: number
  /** Tool results with more lines end with `… +N lines`, like Claude Code. */
  maxResultRows?: number
  /** Shown at the right of the footer line, under the input box. */
  footerRight?: ReactNode
  style?: CSSProperties
}

export function AgentTerminal({ items, thinking, draft, cwd, title, width, height, fontSize = 24, maxResultRows = 3, footerRight, style }: AgentTerminalProps) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const t = frame / fps
  const m = terminalMetrics(fontSize)
  const padX = 36
  const chromeH = 58
  const inputH = m.lineHeight * 3.3
  const cols = Math.floor((width - padX * 2) / m.charWidth)
  const viewportH = height - chromeH - inputH - 28

  const rows = buildRows(items, cols, m, maxResultRows)
  const grow = (at: number) =>
    at > t ? 0 : spring({ frame: frame - Math.round(at * fps), fps, config: { damping: 22, stiffness: 220, mass: 0.6 } })

  const welcomeH = m.lineHeight * 3.4
  const spinnerIndex = thinking.findIndex((r) => t >= r.from && t < r.to)
  const spinner = spinnerIndex === -1 ? undefined : thinking[spinnerIndex]
  const spinnerH = spinner ? (m.lineHeight + m.lineHeight * 0.55) * grow(spinner.from) : 0
  const contentH =
    welcomeH + rows.reduce((sum, row) => sum + (row.gapBefore + m.lineHeight) * grow(row.at), 0) + spinnerH + m.lineHeight * 0.5
  const scroll = Math.max(0, contentH - viewportH)

  const typed = draft ? draft.text.slice(0, Math.round(interpolate(t, [draft.start, draft.end], [0, draft.text.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }))) : ''
  const inputText = draft && t < draft.end + 0.15 ? typed : ''
  const cursorOn = Math.floor(t * 2) % 2 === 0 || (draft && t > draft.start && t < draft.end)

  return (
    <div
      style={{
        width,
        height,
        borderRadius: 18,
        background: colors.window,
        border: `1px solid ${colors.border}`,
        boxShadow: '0 30px 80px rgba(0, 20, 60, 0.45), 0 8px 24px rgba(0, 0, 0, 0.3)',
        overflow: 'hidden',
        fontFamily: monoFont,
        fontSize: m.fontSize,
        lineHeight: `${m.lineHeight}px`,
        color: colors.text,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <div
        style={{
          height: chromeH,
          flexShrink: 0,
          background: colors.chrome,
          borderBottom: `1px solid ${colors.border}`,
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          paddingLeft: 22,
          gap: 11,
        }}
      >
        {['#ff5f57', '#febc2e', '#28c840'].map((c) => (
          <div key={c} style={{ width: 18, height: 18, borderRadius: 9, background: c, boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.25)' }} />
        ))}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: sansFont, fontSize: 20, fontWeight: 600, color: colors.dim }}>
          {title}
        </div>
      </div>

      <div
        style={{
          height: viewportH,
          overflow: 'hidden',
          padding: `0 ${padX}px`,
          marginTop: 16,
          flexShrink: 0,
          // Rows scrolled past the top fade out instead of being cut.
          maskImage: `linear-gradient(to bottom, transparent 0, black ${Math.min(scroll, m.lineHeight * 2)}px, black calc(100% - 14px), transparent 100%)`,
        }}
      >
        <div style={{ transform: `translateY(${-scroll}px)`, whiteSpace: 'pre' }}>
          <div style={{ height: welcomeH, paddingTop: 2 }}>
            <div style={{ border: `1.5px solid ${colors.claude}`, borderRadius: 10, padding: `${m.lineHeight * 0.3}px ${m.charWidth * 1.5}px`, width: 'fit-content', minWidth: m.charWidth * 46 }}>
              <div>
                <span style={{ color: colors.claude }}>✻ </span>Welcome to <span style={{ fontWeight: 700 }}>Claude Code</span>!
              </div>
              <div style={{ color: colors.dim }}>  cwd: {cwd}</div>
            </div>
          </div>
          {rows.map((row) => {
            const g = grow(row.at)
            if (g <= 0) return null
            return (
              <div key={row.key} style={{ height: (row.gapBefore + m.lineHeight) * g, overflow: 'hidden', opacity: Math.min(1, g * 1.4) }}>
                <div style={{ height: row.gapBefore }} />
                {row.render(t)}
              </div>
            )
          })}
          {spinner && (
            <div style={{ height: spinnerH, overflow: 'hidden', paddingTop: m.lineHeight * 0.55 }}>
              <Spinner t={t} from={spinner.from} index={spinnerIndex} m={m} />
            </div>
          )}
        </div>
      </div>

      <div style={{ padding: `0 ${padX - 8}px`, flexShrink: 0 }}>
        <div style={{ border: `1px solid ${colors.faint}`, borderRadius: 10, padding: `${m.lineHeight * 0.3}px ${m.charWidth}px`, whiteSpace: 'pre', color: colors.text }}>
          <span style={{ color: colors.dim }}>{'> '}</span>
          {inputText}
          <span style={{ display: 'inline-block', width: m.charWidth, height: m.lineHeight * 0.85, verticalAlign: 'text-bottom', background: cursorOn ? colors.text : 'transparent' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: colors.faint, fontSize: m.fontSize * 0.8, padding: `0 ${m.charWidth}px`, marginTop: 6 }}>
          <span>? for shortcuts</span>
          {footerRight}
        </div>
      </div>
    </div>
  )
}
