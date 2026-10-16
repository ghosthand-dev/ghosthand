// Motion graphics for the ghosthand promo (non-recorded assets). Rendered as stills and clips
// into ../promo-assets/motion-graphics by scripts/render-promo-graphics.ts.
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { colors, monoFont, sansFont } from './terminal.tsx'

const ICON_COLORS: Record<string, string> = {
  WhatsApp: '#25d366', TikTok: '#111', Instagram: '#e1306c', Reddit: '#ff4500', Spotify: '#1db954', Gmail: '#ea4335',
  Messages: '#34c759', Maps: '#4285f4', Uber: '#000', Slack: '#4a154b', LinkedIn: '#0a66c2', Airbnb: '#ff5a5f',
  Waymo: '#00a6a6', JetBlue: '#0033a0', OpenTable: '#da3743', Settings: '#8e8e93',
}

function pop(frame: number, fps: number, delay: number) {
  return spring({ frame: frame - delay, fps, config: { damping: 11, stiffness: 160, mass: 0.7 } })
}

function AppTile({ name, size }: { name: string; size: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: size * 0.225, background: ICON_COLORS[name] ?? '#333',
        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: sansFont,
        fontWeight: 700, fontSize: size * 0.2, letterSpacing: -0.5,
        boxShadow: '0 18px 40px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.25)',
      }}
    >
      {name}
    </div>
  )
}

/** App tiles popping in around a hole in the middle, for the closing presenter shot. Transparent. */
export function IconOrbit({ names }: { names: string[] }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const slots = [
    [150, 130], [1620, 150], [90, 520], [1700, 560], [230, 860], [1560, 880], [520, 80], [1340, 70],
  ]
  return (
    <AbsoluteFill>
      {names.slice(0, slots.length).map((name, i) => {
        const p = pop(frame, fps, 6 + i * 5)
        const bob = Math.sin((frame + i * 17) / 22) * 8
        return (
          <div key={name} style={{ position: 'absolute', left: slots[i][0], top: slots[i][1] + bob, transform: `scale(${p}) rotate(${(1 - p) * -14}deg)`, opacity: Math.min(1, p) }}>
            <AppTile name={name} size={150} />
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

/** Floating icons row above the phones in the opening shot. Transparent. */
export function IconRow({ names }: { names: string[] }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'flex-start', paddingTop: 110 }}>
      <div style={{ display: 'flex', gap: 70 }}>
        {names.map((name, i) => {
          const p = pop(frame, fps, 4 + i * 6)
          return (
            <div key={name} style={{ transform: `translateY(${(1 - p) * 60 + Math.sin((frame + i * 20) / 20) * 6}px) scale(${p})`, opacity: Math.min(1, p) }}>
              <AppTile name={name} size={130} />
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

/** Logo pop with a soft ring, top-right in the presenter shot. Transparent. */
export function LogoPop() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = pop(frame, fps, 4)
  const ring = interpolate(frame, [4, 40], [0.6, 2.2], { extrapolateRight: 'clamp' })
  const ringOpacity = interpolate(frame, [4, 40], [0.5, 0], { extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', right: 180, top: 120, width: 220, height: 220 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 50, border: '3px solid #fff', transform: `scale(${ring})`, opacity: ringOpacity }} />
        <Img src={staticFile('ghosthand-icon.png')} style={{ width: 220, height: 220, borderRadius: 50, transform: `scale(${p})`, boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }} />
      </div>
    </AbsoluteFill>
  )
}

const AGENTS = [
  { name: 'Claude Code', color: '#d97757', glyph: '✳' },
  { name: 'Codex', color: '#10a37f', glyph: '◎' },
  { name: 'OpenCode', color: '#e8e8e8', glyph: '▢' },
  { name: 'Cursor', color: '#7c7cff', glyph: '◭' },
]

/** Four agent chips popping top-left. Transparent. */
export function AgentChips() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return (
    <AbsoluteFill>
      <div style={{ position: 'absolute', left: 140, top: 110, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {AGENTS.map((a, i) => {
          const p = pop(frame, fps, 6 + i * 7)
          return (
            <div key={a.name} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 26px 14px 16px', borderRadius: 999, background: 'rgba(20,20,22,0.82)', border: '1px solid rgba(255,255,255,0.14)', color: '#fff', fontFamily: sansFont, fontSize: 34, fontWeight: 600, transform: `translateX(${(1 - p) * -120}px) scale(${0.8 + 0.2 * p})`, opacity: Math.min(1, p), boxShadow: '0 12px 30px rgba(0,0,0,0.35)' }}>
              <div style={{ width: 52, height: 52, borderRadius: 26, background: a.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111', fontSize: 30 }}>{a.glyph}</div>
              {a.name}
            </div>
          )
        })}
      </div>
    </AbsoluteFill>
  )
}

/** White split-screen frame with two labels and an elapsed-time pill. Slots for two videos are left empty. */
export function SplitFrame({ left, right, total, speed }: { left: string; right: string; total: number; speed: number }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const elapsed = Math.min(total, (frame / fps) * speed)
  const mm = Math.floor(elapsed / 60)
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0')
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const panel = { position: 'absolute' as const, top: 190, width: 880, height: 700, borderRadius: 40, background: '#0f0f10', boxShadow: '0 30px 80px rgba(0,0,0,0.18)' }
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg,#fbfbfd,#eef0f4)', fontFamily: sansFont }}>
      <div style={{ position: 'absolute', left: 70, top: 90, fontSize: 44, fontWeight: 700, color: '#111' }}>{left}</div>
      <div style={{ position: 'absolute', left: 1010, top: 90, fontSize: 44, fontWeight: 700, color: '#111' }}>{right}</div>
      <div style={{ ...panel, left: 60 }} />
      <div style={{ ...panel, left: 980 }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 70, display: 'flex', justifyContent: 'center' }}>
        <div style={{ fontFamily: monoFont, fontSize: 32, color: '#111', background: '#fff', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 999, padding: '12px 34px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
          Elapsed time {mm}:{ss} / {fmt(total)} ({speed}x speed)
        </div>
      </div>
    </AbsoluteFill>
  )
}

/** Black end card with logo, wordmark and install command. */
export function EndCard({ url }: { url: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = pop(frame, fps, 4)
  const t = interpolate(frame, [18, 34], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34 }}>
      <Img src={staticFile('ghosthand-icon.png')} style={{ width: 200, height: 200, borderRadius: 46, transform: `scale(${p})` }} />
      <div style={{ fontFamily: sansFont, fontSize: 104, fontWeight: 700, color: '#fff', letterSpacing: -3, opacity: t, transform: `translateY(${(1 - t) * 20}px)` }}>ghosthand</div>
      <div style={{ fontFamily: monoFont, fontSize: 38, color: colors.dim, opacity: t }}>{url}</div>
    </AbsoluteFill>
  )
}

/** Terminal card with a typed prompt, to composite over a dark shot or use alone. */
export function PromptCard({ prompt }: { prompt: string }) {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const shown = Math.min(prompt.length, Math.max(0, Math.floor((frame - 8) / (fps / 28))))
  const cursor = Math.floor(frame / 15) % 2 === 0
  return (
    <AbsoluteFill style={{ background: colors.window, alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 1500, border: `2px solid ${colors.faint}`, borderRadius: 24, padding: '48px 56px', fontFamily: monoFont, fontSize: 56, color: colors.text, lineHeight: 1.3 }}>
        <span style={{ color: colors.claude }}>{'> '}</span>
        {prompt.slice(0, shown)}
        <span style={{ display: 'inline-block', width: 30, height: 60, verticalAlign: 'text-bottom', background: cursor ? colors.text : 'transparent' }} />
      </div>
    </AbsoluteFill>
  )
}

/** Translucent grey tap dot with a ripple, for compositing over a phone. Transparent. */
export function TapDot() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const press = pop(frame, fps, 10)
  const ring = interpolate(frame, [10, 36], [0.5, 2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const ringO = interpolate(frame, [10, 36], [0.6, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: 180, height: 180, borderRadius: 90, border: '5px solid rgba(255,255,255,0.8)', transform: `scale(${ring})`, opacity: ringO }} />
      <div style={{ width: 110, height: 110, borderRadius: 55, background: 'rgba(140,140,146,0.6)', border: '3px solid rgba(255,255,255,0.7)', transform: `scale(${0.6 + 0.4 * press})`, backdropFilter: 'blur(4px)' }} />
    </AbsoluteFill>
  )
}
