// Code-made shots for the ghosthand promo (replace the presenter shots of the TapKit original).
// Rendered by scripts/render-promo-shots.ts into ../promo-assets/shots.
import React, { type ReactNode } from 'react'
import { Video } from '@remotion/media'
import { AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { monoFont, sansFont } from './terminal.tsx'

const ACCENT = '#7c6cff'
const INK = '#0b0b10'
const ease = Easing.bezier(0.22, 1, 0.36, 1)

function useT() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return { frame, fps, t: frame / fps }
}

/** 0..1 progress between two seconds, eased. */
function prog(t: number, from: number, to: number) {
  return interpolate(t, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: ease })
}

function pop(frame: number, fps: number, delaySec: number) {
  return spring({ frame: frame - delaySec * fps, fps, config: { damping: 15, stiffness: 150, mass: 0.8 } })
}

// ---------------------------------------------------------------- app tiles (placeholder glyphs, not real logos)

type App = { name: string; bg: string; glyph: ReactNode }
const stroke = { fill: 'none', stroke: '#fff', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
const letter = (s: string, size = 15) => (
  <text x="12" y="12" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={size}>{s}</text>
)

export const APPS: Record<string, App> = {
  WhatsApp: { name: 'WhatsApp', bg: 'linear-gradient(160deg,#4be26b,#12a150)', glyph: <path d="M4.5 19.5l1.2-4A8 8 0 1 1 9 18.6z" {...stroke} /> },
  Instagram: { name: 'Instagram', bg: 'linear-gradient(40deg,#fdb750,#f0306a 45%,#7a3bd1)', glyph: <g {...stroke}><rect x="4" y="4" width="16" height="16" rx="5" /><circle cx="12" cy="12" r="3.6" /><circle cx="17" cy="7" r="0.6" /></g> },
  TikTok: { name: 'TikTok', bg: 'linear-gradient(160deg,#25252b,#000)', glyph: <path d="M14 4v10.2a3.2 3.2 0 1 1-3.2-3.2M14 4c.3 2.3 1.9 3.8 4.2 4" {...stroke} /> },
  Reddit: { name: 'Reddit', bg: 'linear-gradient(160deg,#ff7a3d,#ff4500)', glyph: <g {...stroke}><ellipse cx="12" cy="14" rx="7" ry="5" /><circle cx="9.3" cy="13.4" r="0.7" /><circle cx="14.7" cy="13.4" r="0.7" /><path d="M9.5 16.2c1.4 1 3.6 1 5 0M12 9V5l3.6 1" /></g> },
  Spotify: { name: 'Spotify', bg: 'linear-gradient(160deg,#2fe07a,#0f9e49)', glyph: <path d="M5 9c4.5-1.4 9.5-1 14 1.4M6 12.8c3.6-1 7.2-.7 11 1.2M7 16.4c2.8-.7 5.4-.5 8.2.8" {...stroke} /> },
  Gmail: { name: 'Gmail', bg: 'linear-gradient(160deg,#fff,#ececf2)', glyph: <path d="M4 18V7l8 6 8-6v11M4 7l8 6 8-6" fill="none" stroke="#e8453c" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" /> },
  Messages: { name: 'Messages', bg: 'linear-gradient(160deg,#5bec78,#1fb53e)', glyph: <path d="M12 5c4.4 0 8 2.7 8 6.2S16.4 17.4 12 17.4c-.8 0-1.6-.1-2.3-.3L6 19l.8-3.1C5.1 14.7 4 13.1 4 11.2 4 7.7 7.6 5 12 5z" fill="#fff" /> },
  Maps: { name: 'Maps', bg: 'linear-gradient(160deg,#6fd1ff,#2f7bff)', glyph: <path d="M12 20s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10z M12 11.5a1.8 1.8 0 1 0 0-3.6 1.8 1.8 0 0 0 0 3.6z" {...stroke} /> },
  Slack: { name: 'Slack', bg: 'linear-gradient(160deg,#6b2a6f,#3b0f3f)', glyph: <path d="M9 4v16M15 4v16M4 9h16M4 15h16" {...stroke} /> },
  LinkedIn: { name: 'LinkedIn', bg: 'linear-gradient(160deg,#1d8bd8,#0a5aa8)', glyph: letter('in', 14) },
  Airbnb: { name: 'Airbnb', bg: 'linear-gradient(160deg,#ff7a85,#ff385c)', glyph: <path d="M12 5c1.4 0 2.2 1 2.8 2.4l3.6 7.4c.8 1.8-.2 3.7-2.2 3.7-1.2 0-2.2-.8-4.2-3-2 2.200-3 3-4.200 3-2 0-3-1.900-2.200-3.700l3.600-7.400C9.800 6 10.600 5 12 5z" {...stroke} /> },
  Waymo: { name: 'Waymo', bg: 'linear-gradient(160deg,#1fd7d0,#0a8f8b)', glyph: <path d="M4 12l4 6 4-8 4 8 4-6" {...stroke} /> },
  JetBlue: { name: 'JetBlue', bg: 'linear-gradient(160deg,#1e5fd6,#0a2f8a)', glyph: <path d="M4 14l16-8-5 12-3-5z" {...stroke} /> },
  OpenTable: { name: 'OpenTable', bg: 'linear-gradient(160deg,#ee4d5a,#c01f35)', glyph: <g {...stroke}><circle cx="12" cy="12" r="5.5" /><circle cx="12" cy="12" r="1.4" /></g> },
  Uber: { name: 'Uber', bg: 'linear-gradient(160deg,#2b2b30,#000)', glyph: letter('U', 15) },
  Notes: { name: 'Notes', bg: 'linear-gradient(160deg,#ffe46b,#ffb800)', glyph: <path d="M7 6h10M7 10h10M7 14h6" {...stroke} /> },
}

export function AppTile({ app, size }: { app: keyof typeof APPS; size: number }) {
  const a = APPS[app]
  return (
    <div style={{ width: size, height: size, borderRadius: size * 0.225, background: a.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 ${size * 0.14}px ${size * 0.32}px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -2px 6px rgba(0,0,0,0.18)` }}>
      <svg viewBox="0 0 24 24" width={size * 0.58} height={size * 0.58}>{a.glyph}</svg>
    </div>
  )
}

const Backdrop = ({ children, glow = ACCENT }: { children?: ReactNode; glow?: string }) => (
  <AbsoluteFill style={{ background: `radial-gradient(1200px 700px at 50% 38%, ${glow}33, transparent 70%), linear-gradient(180deg,#14141c,${INK})` }}>
    <AbsoluteFill style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.06) 1.2px, transparent 1.4px)', backgroundSize: '44px 44px', opacity: 0.55 }} />
    {children}
  </AbsoluteFill>
)

// ---------------------------------------------------------------- shot 1: desk hook + icons floating above phones

export function Shot1Hook({ src }: { src: string }) {
  const { frame, fps, t } = useT()
  const names = ['WhatsApp', 'Instagram', 'Reddit', 'TikTok', 'Spotify', 'Messages'] as const
  const push = interpolate(frame, [0, 130], [1, 1.04])
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${push})` }}>
        <Video src={staticFile(src)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </AbsoluteFill>
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,0.35), transparent 38%)' }} />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 96 }}>
        <div style={{ display: 'flex', gap: 62 }}>
          {names.map((n, i) => {
            const p = pop(frame, fps, 0.5 + i * 0.12)
            const bob = Math.sin((t * 1.8 + i * 1.1)) * 7
            return (
              <div key={n} style={{ transform: `translateY(${(1 - p) * 70 + bob}px) scale(${0.6 + 0.4 * p})`, opacity: Math.min(1, p * 1.4) }}>
                <AppTile app={n} size={128} />
              </div>
            )
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- shot 2: intro (replaces presenter)

const AGENTS = [
  { name: 'Claude Code', color: '#d97757', glyph: '✳' },
  { name: 'Codex', color: '#10a37f', glyph: '◎' },
  { name: 'OpenCode', color: '#ececec', glyph: '▢' },
  { name: 'Cursor', color: '#8b8bff', glyph: '◭' },
]

export function Shot2Intro() {
  const { frame, fps, t } = useT()
  const logo = pop(frame, fps, 0.15)
  const ring = prog(t, 0.2, 1.6)
  const word = prog(t, 0.55, 1.15)
  const sub = prog(t, 1.5, 2.2)
  const chips = [
    { x: -640, y: -250 }, { x: 640, y: -250 }, { x: -640, y: 250 }, { x: 640, y: 250 },
  ]
  return (
    <Backdrop>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: 300, height: 300, borderRadius: 80, border: '2px solid rgba(255,255,255,0.7)', transform: `scale(${0.8 + ring * 2.6})`, opacity: (1 - ring) * 0.5 }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30, marginTop: -40 }}>
          <Img src={staticFile('ghosthand-icon.png')} style={{ width: 230, height: 230, borderRadius: 54, transform: `scale(${logo})`, boxShadow: `0 40px 90px ${ACCENT}66` }} />
          <div style={{ fontFamily: sansFont, fontWeight: 700, fontSize: 124, color: '#fff', letterSpacing: -4, opacity: word, transform: `translateY(${(1 - word) * 26}px)`, filter: `blur(${(1 - word) * 8}px)` }}>ghosthand</div>
          <div style={{ fontFamily: sansFont, fontWeight: 500, fontSize: 44, color: 'rgba(255,255,255,0.72)', opacity: sub, transform: `translateY(${(1 - sub) * 16}px)` }}>Let agents use your iPhone</div>
        </div>
        {AGENTS.map((a, i) => {
          const p = pop(frame, fps, 2.0 + i * 0.14)
          const c = chips[i]
          return (
            <div key={a.name} style={{ position: 'absolute', left: 960 + c.x - 190, top: 540 + c.y - 40, width: 380, display: 'flex', justifyContent: 'center', transform: `translateY(${(1 - p) * 40 + Math.sin(t * 1.5 + i) * 5}px) scale(${0.7 + 0.3 * p})`, opacity: Math.min(1, p * 1.5) }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 28px 14px 16px', borderRadius: 999, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.16)', backdropFilter: 'blur(12px)', color: '#fff', fontFamily: sansFont, fontSize: 36, fontWeight: 600 }}>
                <div style={{ width: 54, height: 54, borderRadius: 27, background: a.color, color: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30 }}>{a.glyph}</div>
                {a.name}
              </div>
            </div>
          )
        })}
      </AbsoluteFill>
    </Backdrop>
  )
}

// ---------------------------------------------------------------- shot 3: split-screen demo

const STEPS = [
  { at: 1.4, tool: 'ghosthand screenshot', arg: 'Messages --text' },
  { at: 2.6, tool: 'ghosthand tap', arg: 'Hog Island Oyster Co.' },
  { at: 3.8, tool: 'ghosthand open', arg: 'Waymo' },
  { at: 5.0, tool: 'ghosthand tap', arg: 'Request Waymo' },
]
const PROMPT = 'order me a Waymo to the restaurant Tom sent in the group chat'

export function Shot3Demo({ phones, total = 38, speed = 4 }: { phones: string[]; total?: number; speed?: number }) {
  const { frame, fps, t } = useT()
  const typed = Math.min(PROMPT.length, Math.max(0, Math.floor((t - 0.4) * 30)))
  const enter = prog(t, 0, 0.7)
  const elapsed = Math.min(total, t * speed)
    const mm = Math.floor(elapsed / 60)
  const ss = String(Math.floor(elapsed % 60)).padStart(2, '0')
  const panel = { position: 'absolute' as const, top: 170, height: 760, borderRadius: 36, overflow: 'hidden' as const, boxShadow: '0 40px 90px rgba(20,20,40,0.22), 0 0 0 1px rgba(0,0,0,0.06)', transform: `translateY(${(1 - enter) * 50}px)`, opacity: enter }
  const label = { position: 'absolute' as const, top: 96, fontFamily: sansFont, fontSize: 40, fontWeight: 700, color: '#15151c', opacity: enter }
  return (
    <AbsoluteFill style={{ background: 'linear-gradient(180deg,#fbfbfe,#eceef4)' }}>
      <div style={{ ...label, left: 96 }}>ghosthand on your Mac</div>
      <div style={{ ...label, left: 1040 }}>Your iPhone</div>
      <div style={{ ...panel, left: 80, width: 880, background: '#17171d' }}>
        <div style={{ height: 60, display: 'flex', alignItems: 'center', gap: 10, padding: '0 24px', background: '#212129' }}>
          {['#ff5f57', '#febc2e', '#28c840'].map((c) => <div key={c} style={{ width: 16, height: 16, borderRadius: 8, background: c }} />)}
          <div style={{ marginLeft: 16, fontFamily: sansFont, fontSize: 22, color: '#8b8b99' }}>claude: ~/ghosthand</div>
        </div>
        <div style={{ padding: '34px 40px', fontFamily: monoFont, fontSize: 31, color: '#ece9e4', lineHeight: 1.5 }}>
          <div style={{ display: 'flex' }}>
            <span style={{ color: '#d97757', marginRight: 14 }}>{'>'}</span>
            <span>{PROMPT.slice(0, typed)}{t < 3 && Math.floor(t * 2) % 2 === 0 ? '▍' : ''}</span>
          </div>
          <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {STEPS.map((s) => {
              const p = prog(t, s.at, s.at + 0.35)
              return (
                <div key={s.arg} style={{ opacity: p, transform: `translateX(${(1 - p) * -18}px)`, display: 'flex', gap: 14, fontSize: 28 }}>
                  <span style={{ color: '#5fc27a' }}>●</span>
                  <span style={{ color: '#ece9e4' }}>{s.tool}</span>
                  <span style={{ color: '#8f8a83' }}>{s.arg}</span>
                </div>
              )
            })}
            <div style={{ opacity: prog(t, 6.6, 6.95), display: 'flex', gap: 14, marginTop: 10, fontFamily: sansFont, fontSize: 34, fontWeight: 600, color: '#5fc27a' }}>
              <span>✓</span><span>Waymo is on its way</span>
            </div>
          </div>
        </div>
      </div>
      <div style={{ ...panel, left: 1040, width: 800, background: 'radial-gradient(600px 500px at 50% 50%, #2a2a38, #101016)' }}>
        <div style={{ position: 'absolute', left: 200, top: 18, width: 400, height: 724, borderRadius: 56, background: '#000', boxShadow: '0 0 0 3px #3a3a44, 0 30px 60px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
          {phones.map((src, i) => (
            <Sequence key={src} from={Math.round(i * 3.2 * fps)} durationInFrames={Math.round(3.2 * fps)} layout="none">
              <Video src={staticFile(src)} muted style={{ position: 'absolute', left: -2, top: -2, width: 404, height: 728, objectFit: 'cover' }} />
            </Sequence>
          ))}
        </div>
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 52, display: 'flex', justifyContent: 'center', opacity: enter }}>
        <div style={{ fontFamily: monoFont, fontSize: 30, color: '#15151c', background: '#fff', border: '1px solid rgba(0,0,0,0.08)', borderRadius: 999, padding: '12px 34px', boxShadow: '0 10px 28px rgba(0,0,0,0.08)' }}>
          Elapsed time {mm}:{ss} / 0:{total} ({speed}x speed)
        </div>
      </div>
    </AbsoluteFill>
  )
}

// ---------------------------------------------------------------- shot 4: many iPhones

export function Shot4Multi() {
  const { frame, fps, t } = useT()
  const n = Math.min(4, 1 + Math.floor(t / 0.9))
  const phones: (keyof typeof APPS)[] = ['Messages', 'Reddit', 'WhatsApp', 'Maps']
  const label = prog(t, 3.2, 3.8)
  return (
    <Backdrop glow="#4f8bff">
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', gap: 70, marginTop: -60 }}>
          {phones.map((app, i) => {
            const p = pop(frame, fps, i * 0.9 + 0.1)
            const live = prog(t, i * 0.9 + 0.5, i * 0.9 + 1.0)
            return (
              <div key={app} style={{ width: 240, height: 500, borderRadius: 44, background: '#050507', boxShadow: `0 0 0 3px #34343e, 0 40px 80px rgba(0,0,0,0.6), 0 0 ${80 * live}px ${ACCENT}${live > 0.5 ? '77' : '00'}`, transform: `translateY(${(1 - p) * 90}px) scale(${0.75 + 0.25 * p})`, opacity: Math.min(1, p * 1.5), position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', inset: 8, borderRadius: 36, background: `linear-gradient(170deg, #1c1c26, #0c0c12)` }} />
                <div style={{ position: 'absolute', left: 82, top: 22, width: 76, height: 22, borderRadius: 11, background: '#000' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 26, opacity: live }}>
                  <AppTile app={app} size={110} />
                  {[150, 110, 130].map((w, k) => <div key={k} style={{ width: w, height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.14)' }} />)}
                </div>
              </div>
            )
          })}
        </div>
        <div style={{ position: 'absolute', bottom: 150, fontFamily: sansFont, fontSize: 64, fontWeight: 700, color: '#fff', letterSpacing: -1.5, opacity: label, transform: `translateY(${(1 - label) * 20}px)` }}>
          {n} iPhone{n > 1 ? 's' : ''}. One agent.
        </div>
      </AbsoluteFill>
    </Backdrop>
  )
}

// ---------------------------------------------------------------- shot 6: anything on your phone

const ORBIT: (keyof typeof APPS)[] = ['Instagram', 'Spotify', 'Gmail', 'Uber', 'TikTok', 'LinkedIn', 'Airbnb', 'Slack', 'Maps', 'Notes', 'WhatsApp', 'Waymo']

export function Shot6Anything() {
  const { frame, fps, t } = useT()
  const logo = pop(frame, fps, 0.2)
  const words = 'Anything you do on your phone, your agent can do.'.split(' ')
  return (
    <Backdrop glow="#ff6aa0">
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        {ORBIT.map((app, i) => {
          const ring = i % 2 === 0 ? 0 : 1
          const radius = ring === 0 ? 470 : 640
          const base = (i / ORBIT.length) * Math.PI * 2
          const spin = t * (ring === 0 ? 0.18 : -0.12)
          const a = base + spin
          const p = pop(frame, fps, 0.3 + i * 0.1)
          const x = Math.cos(a) * radius * 1.25
          const y = Math.sin(a) * radius * 0.5 - 120
          const depth = (Math.sin(a) + 1) / 2
          return (
            <div key={app} style={{ position: 'absolute', left: 960 + x - 70, top: 540 + y - 70, transform: `scale(${(0.6 + 0.5 * depth) * p})`, opacity: Math.min(1, p) * (0.55 + 0.45 * depth), filter: `blur(${(1 - depth) * 2}px)` }}>
              <AppTile app={app} size={140} />
            </div>
          )
        })}
        <div style={{ transform: `scale(${logo})`, marginTop: -170 }}>
          <Img src={staticFile('ghosthand-icon.png')} style={{ width: 210, height: 210, borderRadius: 50, boxShadow: `0 30px 80px ${ACCENT}88` }} />
        </div>
        <div style={{ position: 'absolute', bottom: 90, display: 'flex', gap: 18, fontFamily: sansFont, fontSize: 58, fontWeight: 700, color: '#fff', letterSpacing: -1.5 }}>
          {words.map((w, i) => {
            const p = prog(t, 2.2 + i * 0.22, 2.7 + i * 0.22)
            return <span key={i} style={{ opacity: p, transform: `translateY(${(1 - p) * 18}px)`, filter: `blur(${(1 - p) * 6}px)` }}>{w}</span>
          })}
        </div>
      </AbsoluteFill>
    </Backdrop>
  )
}

// ---------------------------------------------------------------- shot 7: end card

export function Shot7End() {
  const { frame, fps, t } = useT()
  const p = pop(frame, fps, 0.1)
  const w = prog(t, 0.45, 1.0)
  return (
    <AbsoluteFill style={{ background: '#000', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 34 }}>
      <Img src={staticFile('ghosthand-icon.png')} style={{ width: 200, height: 200, borderRadius: 46, transform: `scale(${p})`, boxShadow: `0 30px 80px ${ACCENT}55` }} />
      <div style={{ fontFamily: sansFont, fontSize: 110, fontWeight: 700, color: '#fff', letterSpacing: -3.5, opacity: w, transform: `translateY(${(1 - w) * 22}px)` }}>ghosthand</div>
      <div style={{ fontFamily: monoFont, fontSize: 40, color: '#8f8a83', opacity: prog(t, 0.8, 1.4) }}>npx ghosthand · ghosthand.dev</div>
    </AbsoluteFill>
  )
}
