// Promo video as a pure function of time. seek(t) sets every style from t, so any
// frame renders the same way in a browser preview or in headless Chrome.
//
//   0.0  title + square icon cluster        19.8  network: one bot, six iPhones
//   3.8  Grok chat + iPhone posting a clip  23.7  zoom out: two teammates
//  11.9  dot chat + iPhone warming up       26.6  zoom out: whole team mesh
//                                           29.2  tiles -> squares -> cluster -> logo

import logoSvg from '../../website/public/logo-ink.svg'
import uploadTimeline from '../../demo-video/public/tiktok/timeline.json'
import warmupTimeline from '../../demo-video/public/tiktok-warmup/timeline.json'
import { CLIP_FPS, type ClipName } from './clips.ts'

export const W = 1920
export const H = 1080

const INK = '#16120c'
const CORAL = '#d16d59'
const PURPLE = '#5b54ee'
const BLUE = '#2f8ff0'
const MUTED = '#8d877b'

// scene starts, every other time is relative to one of these
const CHAT_AT = 3.8
const SWAP_AT = 11.9
const NET_AT = 19.8
const ZOOM1_AT = NET_AT + 3.9
const ZOOM2_AT = NET_AT + 6.75
const SHAPES_AT = NET_AT + 9.35
const LOGO_AT = SHAPES_AT + 2.7
export const DURATION = LOGO_AT + 4.15

// ---------------------------------------------------------------- math

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur)
const outCubic = (p: number) => 1 - (1 - p) ** 3
const inOutCubic = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
const outBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2
/** Opacity of something shown from tIn to tOut. */
const shown = (t: number, tIn: number, tOut: number, fadeIn = 0.3, fadeOut = 0.25) =>
  Math.min(prog(t, tIn, fadeIn), 1 - prog(t, tOut - fadeOut, fadeOut))
/** 0 -> 1 -> 0 hump that lasts `dur` seconds after `at`. */
const bump = (t: number, at: number, dur: number) => {
  const x = (t - at) / dur
  return x > 0 && x < 1 ? Math.sin(Math.PI * x) : 0
}
const SPINNER = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const spinner = (t: number) => SPINNER[Math.floor(t * 12) % SPINNER.length]

function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), a | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

/** Rounded square centered on 0,0. */
const square = (half: number, rx: number, attrs = '') =>
  `<rect x="${-half}" y="${-half}" width="${half * 2}" height="${half * 2}" rx="${rx}" ${attrs}/>`

// ---------------------------------------------------------------- dom

type Update = (t: number) => void

function add<T extends Element = HTMLElement>(parent: Element, html: string): T {
  const tpl = document.createElement('template')
  tpl.innerHTML = html.trim()
  const el = tpl.content.firstElementChild as T
  parent.appendChild(el)
  return el
}

function svgEl(parent: Element, tag: string, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  parent.appendChild(el)
  return el
}

function setVisible(el: HTMLElement | SVGElement, opacity: number) {
  el.style.display = opacity <= 0.001 ? 'none' : ''
  el.style.opacity = String(opacity)
}

/** Image decodes started by the current seek(); seek() waits for them. */
let pendingDecodes: Array<Promise<void>> = []

function setImage(img: HTMLImageElement, src: string) {
  if (img.getAttribute('src') === src) return
  img.setAttribute('src', src)
  pendingDecodes.push(img.decode().catch(() => {}))
}

// ---------------------------------------------------------------- art
// Everything is drawn in unit coordinates (radius 1) and scaled by icon().

const GHOST_PATH = logoSvg.match(/fill="url\(#ghost\)" d="([^"]+)"/)![1]

const art = {
  tap: (c = CORAL) =>
    `<circle r="0.34" fill="${c}"/><circle r="0.66" fill="none" stroke="${c}" stroke-width="0.12" opacity="0.55"/><circle r="0.96" fill="none" stroke="${c}" stroke-width="0.1" opacity="0.25"/>`,
  phone: (c = '#fff') =>
    `<rect x="-0.5" y="-0.92" width="1" height="1.84" rx="0.2" fill="none" stroke="${c}" stroke-width="0.12"/><rect x="-0.14" y="-0.76" width="0.28" height="0.07" rx="0.035" fill="${c}"/><circle cy="0.7" r="0.1" fill="none" stroke="${c}" stroke-width="0.07"/>`,
  orb: () =>
    `<circle r="1" fill="${INK}"/><g class="eyes"><ellipse cx="0.16" cy="-0.28" rx="0.1" ry="0.19" fill="#fff"/><ellipse cx="0.47" cy="-0.2" rx="0.09" ry="0.17" fill="#fff"/></g>`,
  dot: () =>
    // flat fills: a gradient defined in a hidden <svg> does not render in Chrome
    `<circle r="0.92" fill="#4f46e5"/><circle cx="-0.12" cy="-0.14" r="0.68" fill="#6b7cff"/><circle cx="-0.24" cy="-0.28" r="0.4" fill="#a9c8ff"/><circle cx="-0.32" cy="-0.38" r="0.12" fill="#fff" opacity="0.8"/>`,
  ghost: () =>
    `<g transform="scale(0.0034) translate(-512 -531)"><path fill="#fff" d="${GHOST_PATH}"/><ellipse cx="452" cy="478" rx="30" ry="40" fill="#26244f"/><ellipse cx="584" cy="478" rx="30" ry="40" fill="#26244f"/><ellipse cx="418" cy="548" rx="26" ry="14" fill="#c9c6f7"/><ellipse cx="618" cy="548" rx="26" ry="14" fill="#c9c6f7"/></g>`,
  ghostTile: () =>
    `<rect x="-1" y="-1" width="2" height="2" rx="0.45" fill="${PURPLE}"/><g transform="scale(0.62)">${art.ghost()}</g>`,
  blob: () =>
    `<line x1="0.1" y1="-0.8" x2="0.28" y2="-1.06" stroke="${BLUE}" stroke-width="0.09" stroke-linecap="round"/><circle cx="0.3" cy="-1.08" r="0.1" fill="${BLUE}"/><rect x="-0.95" y="-0.82" width="1.9" height="1.72" rx="0.72" fill="${BLUE}"/><ellipse cx="-0.28" cy="-0.02" rx="0.09" ry="0.13" fill="${INK}"/><ellipse cx="0.28" cy="-0.02" rx="0.09" ry="0.13" fill="${INK}"/>`,
  bean: () =>
    `<rect x="-0.72" y="-1" width="1.44" height="2" rx="0.72" fill="#eadcc4"/><circle cx="-0.22" cy="-0.15" r="0.08" fill="#3a2f25"/><circle cx="0.22" cy="-0.15" r="0.08" fill="#3a2f25"/><ellipse cx="-0.4" cy="0.08" rx="0.13" ry="0.07" fill="#f0b6a4"/><ellipse cx="0.4" cy="0.08" rx="0.13" ry="0.07" fill="#f0b6a4"/>`,
}
type Mascot = 'orb' | 'dot' | 'ghostTile' | 'blob' | 'bean'

const icon = (inner: string, size: number) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="-1.15 -1.15 2.3 2.3" overflow="visible">${inner}</svg>`

/** iPhone tiles alternate between two accents. */
type Accent = 'coral' | 'white'
const phoneArt = (accent: Accent) => art.phone(accent === 'coral' ? CORAL : '#f3efe6')

// ---------------------------------------------------------------- styles

const CSS = /* css */ `
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #f8f9f4 }
#stage { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #f8f9f4;
  font-family: 'Inter Variable', Inter, sans-serif; color: ${INK}; -webkit-font-smoothing: antialiased;
  font-feature-settings: 'ss01', 'cv11' }
.layer { position: absolute; inset: 0 }
.icon { display: block; flex: none }
.mono { font-family: 'JetBrains Mono Variable', Menlo, monospace }
.header { position: absolute; top: 38px; left: 0; right: 0; text-align: center; font-size: 54px;
  letter-spacing: -0.02em; font-weight: 420 }

.shapegrid { position: absolute; inset: 0; fill: none; stroke: #e2e2d9; stroke-width: 2; stroke-linejoin: round;
  -webkit-mask-image: linear-gradient(90deg, transparent 28%, #000 72%) }
.cell { position: absolute; width: 240px; height: 240px }
.cell.lift { filter: drop-shadow(0 10px 22px rgba(22, 18, 12, 0.08)) }
.title { position: absolute; left: 124px; top: 452px; font-size: 64px; line-height: 1.32; letter-spacing: -0.025em; font-weight: 420 }
.title .w { display: inline-block }

.panel { position: absolute; border-radius: 16px; overflow: hidden;
  box-shadow: 0 2px 6px rgba(22, 18, 12, 0.04), 0 22px 60px rgba(22, 18, 12, 0.09) }
.chat { background: #fff }
.chat-head { height: 82px; display: flex; align-items: center; gap: 16px; padding: 0 28px; border-bottom: 1.5px solid #efede7 }
.chat-name { font-size: 30px; font-weight: 460 }
.chat-role { margin-left: auto; font-size: 21px; color: ${MUTED} }
.chat-body { position: absolute; left: 0; right: 0; top: 84px; bottom: 112px; display: flex; flex-direction: column;
  justify-content: flex-end; padding: 0 30px 6px; overflow: hidden }
.msg { overflow: hidden; flex: none }
.msg-inner { padding-top: 18px; transform-origin: 50% 100% }
.row { display: flex; align-items: flex-start; gap: 16px }
.row.right { justify-content: flex-end }
.bubble { font-size: 26px; line-height: 1.42; padding: 15px 24px; border-radius: 24px; max-width: 610px }
.bubble.dark { background: #1b1712; color: #fff }
.bubble.light { background: #f1f0eb }
.status { display: flex; align-items: center; gap: 10px; font-size: 22px; color: ${MUTED}; padding-left: 40px }
.chat-input { position: absolute; left: 28px; right: 28px; bottom: 28px; height: 66px; border-radius: 33px; background: #fbfaf6;
  border: 1.5px solid #ebe9e2; display: flex; align-items: center; padding: 0 10px 0 30px; font-size: 26px; white-space: nowrap }
.chat-text.ph { color: #a29e95 }
.chat-send { margin-left: auto; width: 46px; height: 46px; border-radius: 50%; background: ${INK}; display: grid; place-items: center }

.phone { position: absolute; width: 404px; height: 840px; border-radius: 60px; background: #0e0e0f;
  box-shadow: inset 0 0 0 3px #3a3a3d, inset 0 0 0 5px #1a1a1c, 0 2px 6px rgba(22, 18, 12, 0.08), 0 30px 70px rgba(22, 18, 12, 0.18) }
.phone-screen { position: absolute; left: 22px; top: 100px; width: 360px; height: 640px; overflow: hidden; background: #000 }
.phone-screen img { position: absolute; inset: 0; width: 100%; height: 100% }
.phone-speaker { position: absolute; left: 170px; top: 47px; width: 64px; height: 7px; border-radius: 4px; background: #2b2b2e }
.phone-cam { position: absolute; left: 132px; top: 44px; width: 13px; height: 13px; border-radius: 50%; background: #16161c;
  box-shadow: inset 0 0 0 3px #2b2b30 }
.phone-home { position: absolute; left: 171px; bottom: 19px; width: 62px; height: 62px; border-radius: 50%; border: 2.5px solid #3a3a3d }
.phone-side { position: absolute; width: 4px; border-radius: 2px; background: #2c2c2e }
.tap { position: absolute; border-radius: 50%; border: 3px solid #fff; background: rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 0 1.5px rgba(0, 0, 0, 0.25) }
.step { position: absolute; left: 1010px; width: 800px; top: 1004px; text-align: center; font-size: 21px; color: ${MUTED} }
.step b { font-weight: 500; color: ${INK} }

.world { position: absolute; left: 0; top: 0; transform-origin: 0 0 }
.links { position: absolute; inset: 0; overflow: visible }
.links line { stroke: #c9c9c0; stroke-width: 1.6; stroke-dasharray: 6 7 }
.links line.far { stroke-width: 1; stroke-dasharray: none; stroke: #d6d6ce }
.node { position: absolute; border-radius: 14px; box-shadow: 0 2px 6px rgba(22, 18, 12, 0.05), 0 16px 40px rgba(22, 18, 12, 0.1) }
.node.device { width: 300px; height: 176px; background: ${INK}; color: #e9e4da }
.node.hub { width: 316px; height: 196px; background: #fff }
.node .tile-art { position: absolute; inset: 0; display: grid; place-items: center }
.node .detail { position: absolute; inset: 0 }
.card-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px 10px; font-size: 24px; color: #f3efe6 }
.card-body { padding: 0 18px; font-size: 16.5px; line-height: 1.55; white-space: pre-wrap }
.hub-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px 10px; font-size: 24px; font-weight: 460 }
.hub-bubble { margin: 0 16px; background: #1b1712; color: #fff; border-radius: 14px; padding: 10px 14px; font-size: 17px; line-height: 1.35 }
.hub-foot { padding: 12px 18px; font-size: 15px; color: ${MUTED} }
.label { position: absolute; left: -100px; right: -100px; top: -60px; text-align: center; font-size: 40px; letter-spacing: -0.02em }

.shapes { position: absolute; inset: 0 }
.shapes rect { fill: ${INK} }
.logo-icon { position: absolute; width: 96px; height: 96px }
.logo-word { position: absolute }
.tagline { position: absolute; left: 0; right: 0; top: 606px; text-align: center; font-size: 28px; color: ${MUTED}; letter-spacing: -0.01em }
`

// ---------------------------------------------------------------- headers

function header(stage: HTMLElement, text: string, tIn: number, tOut: number): Update {
  const el = add(stage, `<div class="header">${text}</div>`)
  return (t) => {
    setVisible(el, shown(t, tIn, tOut, 0.35, 0.2))
    el.style.transform = `translateY(${(1 - outCubic(prog(t, tIn, 0.4))) * 10}px)`
  }
}

// ---------------------------------------------------------------- scene 1: title + square cluster

function sceneTitle(stage: HTMLElement): Update {
  const layer = add(stage, `<div class="layer"></div>`)
  const R = 124
  const colStep = 1.5 * R
  const rowStep = Math.sqrt(3) * R
  const cell = (c: number, r: number) => ({
    x: 1234 + colStep * c,
    y: 320 + rowStep * r + (((c % 2) + 2) % 2 ? rowStep / 2 : 0),
  })

  let grid = ''
  for (let c = -5; c <= 6; c++) {
    for (let r = -2; r <= 5; r++) {
      const p = cell(c, r)
      if (p.x < 400 || p.x > 2150 || p.y < -150 || p.y > 1250) continue
      grid += `<g transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})">${square(84, 30)}</g>`
    }
  }
  add(layer, `<svg class="shapegrid" width="${W}" height="${H}">${grid}</svg>`)

  const cells = [
    { c: 0, r: 0, bg: '#fff', inner: art.tap(), scale: 44 },
    { c: 2, r: 0, bg: PURPLE, inner: art.ghost(), scale: 60 },
    { c: 1, r: 1, bg: '#fff', inner: art.orb(), scale: 42 },
    { c: 0, r: 2, bg: '#fff', inner: art.dot(), scale: 46 },
    { c: 2, r: 2, bg: INK, inner: art.phone(), scale: 48 },
    { c: 3, r: 1, bg: '', inner: art.blob(), scale: 82 },
  ].map((d) => {
    const p = cell(d.c, d.r)
    const bg = d.bg
      ? square(84, 34, `fill="${d.bg}"`)
      : ''
    const el = add(
      layer,
      `<div class="cell ${d.bg === '#fff' ? 'lift' : ''}" style="left:${p.x - 120}px;top:${p.y - 120}px">
        <svg width="240" height="240" viewBox="-120 -120 240 240" overflow="visible">${bg}<g transform="scale(${d.scale})">${d.inner}</g></svg>
      </div>`,
    )
    return { ...p, el, eyes: el.querySelector('.eyes') }
  })

  // [from, to, start]: small dots hop between icons like messages
  const hops: Array<[number, number, number]> = [
    [2, 0, 0.9], [2, 1, 1.25], [4, 5, 1.55], [3, 2, 1.85], [0, 2, 2.2],
    [1, 5, 2.45], [2, 4, 2.75], [5, 1, 3.05], [2, 3, 3.3],
  ]
  const HOP = 0.5
  const dotsSvg = add<SVGSVGElement>(layer, `<svg class="layer" width="${W}" height="${H}"></svg>`)
  const dots = hops.map(() => svgEl(dotsSvg, 'circle', { r: 7, fill: INK }))

  const words = 'Let your bots use|real iPhones.'
    .split('|')
    .map((line) => line.split(' ').map((w) => `<span class="w">${w}</span>`).join(' '))
    .join('<br>')
  const title = add(layer, `<div class="title">${words}</div>`)
  const wordEls = [...title.querySelectorAll<HTMLElement>('.w')]

  return (t) => {
    setVisible(layer, 1 - prog(t, CHAT_AT - 0.08, 0.3))
    if (t > CHAT_AT + 0.3) return
    wordEls.forEach((w, i) => {
      const p = outCubic(prog(t, 0.12 + i * 0.12, 0.45))
      w.style.opacity = String(p)
      w.style.transform = `translateY(${(1 - p) * 8}px)`
    })
    hops.forEach(([from, to, start], i) => {
      const a = cells[from]
      const b = cells[to]
      const p = prog(t, start, HOP)
      const f = 96 / Math.hypot(b.x - a.x, b.y - a.y)
      const k = lerp(f, 1 - f, inOutCubic(p))
      dots[i].setAttribute('cx', String(lerp(a.x, b.x, k)))
      dots[i].setAttribute('cy', String(lerp(a.y, b.y, k)))
      dots[i].style.display = p > 0 && p < 1 ? '' : 'none'
    })
    cells.forEach((c, ci) => {
      let s = 0
      for (const [from, to, start] of hops) {
        if (to === ci) s += bump(t, start + HOP, 0.35)
        if (from === ci) s += 0.4 * bump(t, start - 0.1, 0.25)
      }
      c.el.style.transform = `scale(${1 + 0.06 * s})`
      if (c.eyes) {
        const sy = 1 - 0.9 * (bump(t, 1.6, 0.16) + bump(t, 3.0, 0.16))
        c.eyes.setAttribute('transform', `translate(0.3 -0.25) scale(1 ${sy}) translate(-0.3 0.25)`)
      }
    })
  }
}

// ---------------------------------------------------------------- scene 2-3: chats + iPhone

interface ChatOptions {
  name: string
  role: string
  avatar: string
  typing: { from: number; to: number; send: number; text: string }
  status: { at: number; doneAt: number; asking: string; done: string }
  reply: { at: number; text: string }
}

function chatPanel(parent: HTMLElement, o: ChatOptions): { el: HTMLElement; update: Update } {
  const sendIcon = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  const el = add(
    parent,
    `<div class="panel chat" style="left:112px;top:162px;width:856px;height:758px">
      <div class="chat-head">${icon(o.avatar, 42)}<span class="chat-name">${o.name}</span><span class="chat-role">${o.role}</span></div>
      <div class="chat-body"></div>
      <div class="chat-input"><span class="chat-text"></span><span class="chat-send">${sendIcon}</span></div>
    </div>`,
  )
  const body = el.querySelector('.chat-body')!
  const inputText = el.querySelector<HTMLElement>('.chat-text')!
  const sendBtn = el.querySelector<HTMLElement>('.chat-send')!

  const msgs = [
    { at: o.typing.send, html: `<div class="row right"><div class="bubble dark">${o.typing.text}</div></div>` },
    {
      at: o.status.at,
      html: `<div class="status">${icon(art.phone(INK), 22)}<span class="spin"></span><span class="st"></span></div>`,
      status: o.status,
    },
    { at: o.reply.at, html: `<div class="row">${icon(o.avatar, 34)}<div class="bubble light">${o.reply.text}</div></div>` },
  ].map((m) => {
    const msg = add(body, `<div class="msg"><div class="msg-inner">${m.html}</div></div>`)
    return { ...m, el: msg, inner: msg.firstElementChild as HTMLElement, height: msg.scrollHeight }
  })

  return {
    el,
    update: (t) => {
      const ty = o.typing
      const typing = t >= ty.from && t < ty.send
      const typed = typing ? ty.text.slice(0, Math.round(ty.text.length * prog(t, ty.from, ty.to - ty.from))) : ''
      inputText.textContent = typed || `Message ${o.name}`
      inputText.className = typed ? 'chat-text' : 'chat-text ph'
      sendBtn.style.transform = `scale(${1 - 0.14 * bump(t, ty.send - 0.12, 0.24)})`

      for (const m of msgs) {
        const p = outCubic(prog(t, m.at, 0.38))
        m.el.style.height = `${m.height * p}px`
        m.el.style.display = p > 0 ? '' : 'none'
        m.inner.style.opacity = String(prog(t, m.at + 0.04, 0.28))
        m.inner.style.transform = `translateY(${(1 - p) * 14}px) scale(${0.97 + 0.03 * p})`
        if (m.status) {
          const done = t >= m.status.doneAt
          m.el.querySelector('.spin')!.textContent = done ? '✓' : spinner(t)
          m.el.querySelector('.st')!.textContent = done ? m.status.done : m.status.asking
        }
      }
    },
  }
}

interface ClipPlay {
  name: ClipName
  timeline: { steps: Array<{ at: number; thought: string; tap?: { x: number; y: number; at: number } }> }
  /** Video time when playback starts. */
  start: number
  /** Clip seconds to play. */
  from: number
  to: number
  speed: number
}

const clipEnd = (c: ClipPlay) => c.start + (c.to - c.from) / c.speed
const clipTime = (c: ClipPlay, t: number) => clamp(c.from + (t - c.start) * c.speed, c.from, c.to)

// iPhone SE (2nd/3rd gen) proportions: 16:9 screen, camera and speaker above, home button below
const SCREEN_W = 360
const SCREEN_H = 640
const PHONE_W = 404
const PHONE_H = 840

function phone(parent: HTMLElement, plays: ClipPlay[], swapAt: number): Update {
  const left = 1410 - PHONE_W / 2
  const top = 148
  const sides: Array<[number, number, number]> = [
    [left - 3, top + 118, 30],
    [left - 3, top + 176, 56],
    [left - 3, top + 244, 56],
    [left + PHONE_W - 1, top + 176, 56],
  ]
  for (const [x, y, h] of sides) add(parent, `<div class="phone-side" style="left:${x}px;top:${y}px;height:${h}px"></div>`)
  const el = add(
    parent,
    `<div class="phone" style="left:${left}px;top:${top}px">
      <div class="phone-cam"></div><div class="phone-speaker"></div>
      <div class="phone-screen"></div>
      <div class="phone-home"></div>
    </div>`,
  )
  const screen = el.querySelector('.phone-screen')!
  const imgs = plays.map(() => add<HTMLImageElement>(screen, `<img alt="">`))
  const taps = Array.from({ length: 3 }, () => add(screen, `<div class="tap"></div>`))
  const step = add(parent, `<div class="step"></div>`)

  return (t) => {
    const active = t < swapAt ? 0 : 1
    plays.forEach((c, i) => {
      // the second clip fades in over the first one at the swap
      const opacity = i === 0 ? 1 : prog(t, swapAt, 0.3)
      setVisible(imgs[i], opacity)
      if (opacity <= 0 || (i === 0 && prog(t, swapAt, 0.3) >= 1)) return
      const frame = clamp(Math.round(clipTime(c, t) * CLIP_FPS), 0, window.clipFrames[c.name] - 1)
      setImage(imgs[i], `clips/${c.name}/${String(frame + 1).padStart(5, '0')}.jpg`)
    })

    const c = plays[active]
    const ct = clipTime(c, t)
    let used = 0
    for (const s of c.timeline.steps) {
      if (!s.tap || used >= taps.length) continue
      const p = (ct - s.tap.at) / (0.5 * c.speed)
      if (p < 0 || p > 1 || t < c.start) continue
      const tap = taps[used++]
      const r = lerp(18, 46, outCubic(p))
      tap.style.display = ''
      tap.style.opacity = String(1 - p)
      tap.style.left = `${s.tap.x * SCREEN_W - r}px`
      tap.style.top = `${s.tap.y * SCREEN_H - r}px`
      tap.style.width = tap.style.height = `${r * 2}px`
    }
    for (let i = used; i < taps.length; i++) taps[i].style.display = 'none'

    const current = [...c.timeline.steps].reverse().find((s) => s.at <= ct)
    const playing = t >= c.start && t < clipEnd(c) + 0.3
    setVisible(step, playing && current ? 1 : 0)
    if (current) step.innerHTML = `<b>ghosthand</b> · ${current.thought}`
  }
}

function sceneChat(stage: HTMLElement): Update {
  const layer = add(stage, `<div class="layer"></div>`)
  const upload: ClipPlay = { name: 'upload', timeline: uploadTimeline, start: 5.3, from: 4.0, to: 26.0, speed: 4 }
  const warmup: ClipPlay = { name: 'warmup', timeline: warmupTimeline, start: 13.4, from: 3.5, to: 27.8, speed: 4.5 }

  const grok = chatPanel(layer, {
    name: 'Grok',
    role: 'Social',
    avatar: art.orb(),
    typing: { from: 4.2, to: 4.9, send: 5.0, text: 'Post today’s clip to TikTok, with a caption.' },
    status: { at: 5.2, doneAt: clipEnd(upload), asking: 'Using your iPhone with ghosthand', done: 'Done on your iPhone · 11 taps' },
    reply: { at: clipEnd(upload) + 0.2, text: 'Posted. The clip is live on TikTok with the caption.' },
  })
  const dot = chatPanel(layer, {
    name: 'Dot',
    role: 'Always on',
    avatar: art.dot(),
    typing: { from: SWAP_AT + 0.5, to: SWAP_AT + 1.1, send: SWAP_AT + 1.2, text: 'Warm up the account. Like the funny ones.' },
    status: { at: SWAP_AT + 1.4, doneAt: clipEnd(warmup), asking: 'Using your iPhone with ghosthand', done: 'Done on your iPhone · 12 taps' },
    reply: { at: clipEnd(warmup) + 0.2, text: 'Liked the 2 funny videos and left a comment on each.' },
  })
  const updatePhone = phone(layer, [upload, warmup], SWAP_AT)

  return (t) => {
    const pIn = outCubic(prog(t, CHAT_AT - 0.02, 0.4))
    setVisible(layer, Math.min(pIn, 1 - prog(t, NET_AT - 0.05, 0.3)))
    if (t < CHAT_AT - 0.1 || t > NET_AT + 0.3) return
    layer.style.transform = `translateY(${(1 - pIn) * 12}px) scale(${0.985 + 0.015 * pIn})`
    grok.update(t)
    dot.update(t)
    setVisible(grok.el, 1 - prog(t, SWAP_AT, 0.3))
    setVisible(dot.el, prog(t, SWAP_AT, 0.3))
    updatePhone(t)
  }
}

// ---------------------------------------------------------------- scene 4-6: network of bots and iPhones

interface WNode {
  x: number
  y: number
  kind: 'hub' | 'device'
  accent: Accent
  appear: number
  el: HTMLElement
  /** Detailed card that morphs into a tile when the camera zooms out. */
  detail?: HTMLElement
  tileArt?: HTMLElement
  update?: Update
}
interface Link {
  a: WNode
  b: WNode
  appear: number
  far: boolean
  el: SVGElement
}
interface Particle {
  link: Link
  start: number
  dur: number
  reverse: boolean
  color: string
}
interface Camera {
  s: number
  x: number
  y: number
}

const COL = 1700
const ROW = 1166
const SIDE = 600
const TROW = 300
const CAM_START: Camera = { s: 1, x: 960, y: 574 }
const CAM_KEYS = [
  { t: ZOOM1_AT, d: 0.85, cam: { s: 0.55, x: 492, y: 576 } },
  { t: ZOOM2_AT, d: 0.9, cam: { s: 0.278, x: 720, y: 574 } },
]
const CAM_END = CAM_KEYS[CAM_KEYS.length - 1].cam
const MORPH_AT = ZOOM1_AT + 0.05

function camera(t: number): Camera {
  let cur = CAM_START
  for (const k of CAM_KEYS) {
    const p = inOutCubic(prog(t, k.t, k.d))
    if (p <= 0) break
    // interpolate the world point under the screen center and the log of the scale
    const c0 = { x: (W / 2 - cur.x) / cur.s, y: (H / 2 - cur.y) / cur.s }
    const c1 = { x: (W / 2 - k.cam.x) / k.cam.s, y: (H / 2 - k.cam.y) / k.cam.s }
    const s = Math.exp(lerp(Math.log(cur.s), Math.log(k.cam.s), p))
    cur = { s, x: W / 2 - lerp(c0.x, c1.x, p) * s, y: H / 2 - lerp(c0.y, c1.y, p) * s }
  }
  return cur
}

const toScreen = (cam: Camera, x: number, y: number) => ({ x: x * cam.s + cam.x, y: y * cam.s + cam.y })
const halfSize = (n: WNode) => (n.kind === 'hub' ? { w: 158, h: 98 } : { w: 150, h: 88 })
/** Fraction along a->b where the segment leaves a's card. */
function exitFraction(n: WNode, dx: number, dy: number) {
  const { w, h } = halfSize(n)
  return Math.min(dx ? w / Math.abs(dx) : Infinity, dy ? h / Math.abs(dy) : Infinity)
}

interface Task {
  side: number
  row: number
  accent: Accent
  prompt: string
  result: string
  /** Seconds after NET_AT. */
  at: number
  doneAt: number
}
const TASKS = ([
  { side: -1, row: -1, accent: 'coral', prompt: 'post the clip to TikTok', result: 'Posted, 1 video live', at: 0.6, doneAt: 2.0 },
  { side: 1, row: -1, accent: 'white', prompt: 'reply to Instagram DMs', result: 'Replied to 4 DMs', at: 0.78, doneAt: 1.7 },
  { side: -1, row: 0, accent: 'white', prompt: 'check App Store reviews', result: '2 new, both 5 stars', at: 0.96, doneAt: 2.6 },
  { side: 1, row: 0, accent: 'coral', prompt: 'warm up the new account', result: 'Liked 12, commented 3', at: 1.14, doneAt: 2.9 },
  { side: -1, row: 1, accent: 'coral', prompt: 'test the signup flow', result: 'Passed, screenshots saved', at: 1.32, doneAt: 3.2 },
  { side: 1, row: 1, accent: 'white', prompt: 'find the code in Messages', result: 'Code sent to Grok', at: 1.5, doneAt: 2.3 },
] satisfies Task[]).map((k): Task => ({ ...k, at: NET_AT + k.at, doneAt: NET_AT + k.doneAt }))
const RETURN = 0.45

const HUB_NAMES: Record<string, string> = {
  '-1,-1': 'Ana', '0,-1': 'Omar', '1,-1': 'Kai', '2,-1': 'Ines',
  '-1,0': 'Priya', '0,0': 'You', '1,0': 'Sam', '2,0': 'Leo',
  '-1,1': 'Theo', '0,1': 'June', '1,1': 'Ravi', '2,1': 'Noor',
}
const HUB_MASCOTS: Record<string, Mascot> = { '0,0': 'orb', '1,0': 'dot' }
const MASCOT_CYCLE: Mascot[] = ['blob', 'dot', 'bean', 'orb', 'ghostTile', 'dot']

function sceneWorld(stage: HTMLElement): { update: Update; nodes: WNode[] } {
  const layer = add(stage, `<div class="layer"></div>`)
  const linksSvg = add<SVGSVGElement>(layer, `<svg class="links" width="${W}" height="${H}"></svg>`)
  const world = add(layer, `<div class="world"></div>`)
  const particlesSvg = add<SVGSVGElement>(layer, `<svg class="layer" width="${W}" height="${H}"></svg>`)
  const rnd = random(7)

  const k1 = CAM_KEYS[0].cam
  const onScreen = (cam: Camera, x: number, y: number) => {
    const p = toScreen(cam, x, y)
    return p.x > -170 * cam.s && p.x < W + 170 * cam.s && p.y > -100 * cam.s && p.y < H + 100 * cam.s
  }
  const appearAt = (x: number, y: number) => {
    if (Math.abs(x) <= SIDE && Math.abs(y) <= TROW) return 0
    // the teammate scene only adds the middle row, the mesh scene adds the rest
    if (Math.abs(y) <= TROW && onScreen(k1, x, y)) return ZOOM1_AT + 0.1 + Math.hypot(x, y) / 9000
    const p = toScreen(CAM_END, x, y)
    return ZOOM2_AT + 0.1 + (Math.hypot(p.x - W / 2, p.y - H / 2) / 1100) * 0.45
  }

  const nodes: WNode[] = []
  const hubs = new Map<string, { hub: WNode; left: WNode[]; right: WNode[] }>()
  let deviceCount = 0

  const addDevice = (x: number, y: number, accent: Accent, task?: Task): WNode => {
    const n: WNode = { x, y, kind: 'device', accent, appear: appearAt(x, y), el: null! }
    n.el = add(
      world,
      `<div class="node device" style="left:${x - 150}px;top:${y - 88}px"><div class="tile-art">${icon(phoneArt(accent), 104)}</div></div>`,
    )
    if (task) {
      n.tileArt = n.el.querySelector<HTMLElement>('.tile-art')!
      n.detail = add(
        n.el,
        `<div class="detail"><div class="card-head">${icon(phoneArt(accent), 28)}iPhone ${++deviceCount}</div><div class="card-body mono"><div class="prompt"></div><div class="state"></div></div></div>`,
      )
      const prompt = n.detail.querySelector('.prompt')!
      const state = n.detail.querySelector<HTMLElement>('.state')!
      n.update = (t) => {
        const typed = Math.round(task.prompt.length * prog(t, task.at, 0.35))
        prompt.textContent = typed > 0 ? `> ${task.prompt.slice(0, typed)}` : ''
        if (t >= task.doneAt) {
          state.textContent = `● ${task.result}`
          state.style.color = '#f3efe6'
        } else if (t >= task.at + 0.45) {
          state.textContent = `${spinner(t)} Tapping…`
          state.style.color = task.accent === 'coral' ? CORAL : MUTED
        } else state.textContent = ''
      }
    }
    nodes.push(n)
    return n
  }

  for (let r = -1; r <= 1; r++) {
    for (let c = -2; c <= 3; c++) {
      const hx = c * COL
      const hy = r * ROW
      const left: WNode[] = []
      const right: WNode[] = []
      for (let i = -1; i <= 1; i++) {
        for (const side of [-1, 1]) {
          const x = hx + side * SIDE
          const y = hy + i * TROW
          if (!onScreen(CAM_END, x, y)) continue
          const task = TASKS.find((k) => k.side * SIDE === x && k.row * TROW === y)
          const accent: Accent = task?.accent ?? (Math.abs(c + r + i + (side > 0 ? 1 : 0)) % 2 === 0 ? 'coral' : 'white')
          ;(side < 0 ? left : right).push(addDevice(x, y, accent, task))
        }
      }
      if (!onScreen(CAM_END, hx, hy)) continue
      const key = `${c},${r}`
      const mascot = HUB_MASCOTS[key] ?? MASCOT_CYCLE[(c + 2 + (r + 1) * 4) % MASCOT_CYCLE.length]
      const hub: WNode = { x: hx, y: hy, kind: 'hub', accent: 'white', appear: appearAt(hx, hy), el: null! }
      hub.el = add(
        world,
        `<div class="node hub" style="left:${hx - 158}px;top:${hy - 98}px"><div class="label">${HUB_NAMES[key] ?? ''}</div><div class="tile-art">${icon(art[mascot](), 104)}</div></div>`,
      )
      if (key === '0,0') {
        hub.tileArt = hub.el.querySelector<HTMLElement>('.tile-art')!
        hub.detail = add(
          hub.el,
          `<div class="detail"><div class="hub-head">${icon(art.orb(), 28)}Grok</div><div class="hub-bubble">post the clip, reply to DMs, check reviews…</div><div class="hub-foot"></div></div>`,
        )
        const foot = hub.detail.querySelector('.hub-foot')!
        hub.update = (t) => {
          const done = TASKS.filter((k) => t >= k.doneAt + RETURN).length
          foot.textContent = t < NET_AT + 0.95 ? `${spinner(t)} Asking 6 iPhones…` : `✓ Asked 6 iPhones · ${done} done`
        }
      }
      nodes.push(hub)
      hubs.set(key, { hub, left, right })
    }
  }

  const links: Link[] = []
  const link = (a: WNode, b: WNode, far = false, appear = Math.max(a.appear, b.appear)) => {
    const el = svgEl(linksSvg, 'line', far ? { class: 'far' } : {})
    const l = { a, b, appear, far, el }
    links.push(l)
    return l
  }
  for (const [key, { hub, left, right }] of hubs) {
    for (const n of [...left, ...right]) link(hub, n)
    const [c, r] = key.split(',').map(Number)
    const next = hubs.get(`${c + 1},${r}`)
    if (next) {
      right.forEach((n, i) => {
        if (next.left[i]) link(n, next.left[i])
        const j = i + (rnd() < 0.5 ? -1 : 1)
        if (next.left[j] && rnd() < 0.6) link(n, next.left[j])
      })
    }
  }
  const farCandidates = nodes.filter((n) => n.appear >= ZOOM1_AT)
  for (let i = 0; i < 40; i++) {
    const a = farCandidates[Math.floor(rnd() * farCandidates.length)]
    const b = farCandidates[Math.floor(rnd() * farCandidates.length)]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (a === b || d < 1200 || d > 3600) continue
    link(a, b, true, ZOOM2_AT + 0.35 + rnd() * 0.9)
  }

  // particles: scripted dispatch/return for the first scene, then ambient traffic
  const particles: Particle[] = []
  const you = hubs.get('0,0')!.hub
  for (const task of TASKS) {
    const l = links.find((k) => k.a === you && k.b.x === task.side * SIDE && k.b.y === task.row * TROW)!
    const color = task.accent === 'coral' ? CORAL : INK
    particles.push({ link: l, start: task.at - 0.42, dur: 0.42, reverse: false, color })
    particles.push({ link: l, start: task.doneAt, dur: RETURN, reverse: true, color })
  }
  for (const l of links) {
    const len = Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y)
    const dur = 0.55 + len / 2600
    let start = Math.max(l.appear + 0.25, ZOOM1_AT + 0.3) + rnd() * 1.6
    while (start < SHAPES_AT) {
      const coral = (l.a.accent === 'coral' || l.b.accent === 'coral') && rnd() < 0.45
      particles.push({ link: l, start, dur, reverse: rnd() < 0.5, color: coral ? CORAL : INK })
      start += dur + 0.8 + rnd() * 1.8
    }
  }
  const pool = Array.from({ length: 160 }, () => svgEl(particlesSvg, 'circle', { r: 6 }))

  const update: Update = (t) => {
    const layerOpacity = Math.min(prog(t, NET_AT, 0.3), 1 - prog(t, SHAPES_AT, 0.3))
    setVisible(layer, layerOpacity)
    if (layerOpacity <= 0) return
    const cam = camera(t)
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`

    const morph = inOutCubic(prog(t, MORPH_AT, 0.5))
    for (const n of nodes) {
      const p = n.appear === 0 ? 1 : prog(t, n.appear, 0.4)
      setVisible(n.el, p)
      if (p <= 0) continue
      if (n.appear > 0) n.el.style.transform = `scale(${0.9 + 0.1 * outCubic(p)})`
      if (n.detail && n.tileArt) {
        setVisible(n.detail, 1 - morph)
        n.tileArt.style.opacity = String(morph)
        n.tileArt.style.transform = `scale(${0.6 + 0.4 * morph})`
        if (morph < 1) n.update?.(t)
      }
    }

    for (const l of links) {
      const p = shown(t, l.appear, Infinity, 0.4) * (l.far ? 0.7 : 1)
      if (p <= 0) {
        l.el.style.display = 'none'
        continue
      }
      const a = toScreen(cam, l.a.x, l.a.y)
      const b = toScreen(cam, l.b.x, l.b.y)
      l.el.style.display = ''
      l.el.setAttribute('x1', a.x.toFixed(1))
      l.el.setAttribute('y1', a.y.toFixed(1))
      l.el.setAttribute('x2', b.x.toFixed(1))
      l.el.setAttribute('y2', b.y.toFixed(1))
      l.el.style.opacity = String(p)
    }

    const radius = 4 + 8 * cam.s * cam.s
    let used = 0
    for (const pt of particles) {
      const p = (t - pt.start) / pt.dur
      if (p <= 0 || p >= 1 || used >= pool.length) continue
      const [from, to] = pt.reverse ? [pt.link.b, pt.link.a] : [pt.link.a, pt.link.b]
      const dx = to.x - from.x
      const dy = to.y - from.y
      const k = lerp(exitFraction(from, dx, dy), 1 - exitFraction(to, -dx, -dy), inOutCubic(p))
      const s = toScreen(cam, from.x + dx * k, from.y + dy * k)
      const c = pool[used++]
      c.style.display = ''
      c.setAttribute('cx', s.x.toFixed(1))
      c.setAttribute('cy', s.y.toFixed(1))
      c.setAttribute('r', radius.toFixed(2))
      c.setAttribute('fill', pt.color)
    }
    for (let i = used; i < pool.length; i++) pool[i].style.display = 'none'
  }
  return { update, nodes }
}

// ---------------------------------------------------------------- scene 7: squares -> cluster -> logo (the last square has the logo tile's size and corners)

const CENTER = { x: 960, y: 520 }
const SCATTER_AT = SHAPES_AT + 0.8
const CONVERGE_AT = SHAPES_AT + 1.2
const COLLAPSE_AT = SHAPES_AT + 2.0

function sceneOutro(stage: HTMLElement, nodes: WNode[]): Update {
  const layer = add(stage, `<div class="layer"></div>`)
  const svg = add<SVGSVGElement>(layer, `<svg class="shapes" width="${W}" height="${H}"></svg>`)
  const rnd = random(11)

  const starts = nodes
    .filter((n) => n.appear < SHAPES_AT)
    .map((n) => {
      const p = toScreen(CAM_END, n.x, n.y)
      return { x: p.x, y: p.y, r: n.kind === 'hub' ? 26 : 23 }
    })
    .filter((p) => p.x > -40 && p.x < W + 40 && p.y > -40 && p.y < H + 40)
    .sort((a, b) => Math.hypot(a.x - CENTER.x, a.y - CENTER.y) - Math.hypot(b.x - CENTER.x, b.y - CENTER.y))

  // Cluster slots on a square grid, nearest to the center first.
  const cluster = (step: number, count: number) => {
    const slots: Array<{ x: number; y: number }> = []
    for (let q = -10; q <= 10; q++) {
      for (let r = -10; r <= 10; r++) slots.push({ x: step * q, y: step * r })
    }
    return slots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)).slice(0, count)
  }
  // The cluster collapses in steps: 5x5, 3x3, then one square the size of the logo tile.
  // Squares that land on the same slot merge.
  const levels = [
    { step: 52, r: 21, slots: cluster(52, starts.length), at: 0 },
    { step: 74, r: 31, slots: cluster(74, 25), at: COLLAPSE_AT },
    { step: 102, r: 43, slots: cluster(102, 9), at: COLLAPSE_AT + 0.24 },
    { step: 0, r: 48, slots: [{ x: 0, y: 0 }], at: COLLAPSE_AT + 0.46 },
  ]
  const LEVEL_DUR = 0.22

  const shapes = starts.map((s, i) => {
    const angle = rnd() * Math.PI * 2
    const dist = 50 + rnd() * 170
    // slot at each level: nearest slot to where the shape sits at the previous level
    const path = [levels[0].slots[i]]
    for (let l = 1; l < levels.length; l++) {
      const prev = path[l - 1]
      const k = levels[l].step / levels[l - 1].step
      const nearest = levels[l].slots.reduce((best, slot) =>
        Math.hypot(slot.x - prev.x * k, slot.y - prev.y * k) < Math.hypot(best.x - prev.x * k, best.y - prev.y * k) ? slot : best,
      )
      path.push(nearest)
    }
    return {
      ...s,
      path,
      off: { x: Math.cos(angle) * dist, y: Math.sin(angle) * dist },
      rot: (rnd() - 0.5) * 160,
      delay: rnd() * 0.22,
      // same corner radius as the logo tile (rx 185 on 824)
      el: svgEl(svg, 'rect', { x: -1, y: -1, width: 2, height: 2, rx: 0.45 }),
    }
  })

  const logoIcon = add(layer, `<div class="logo-icon">${logoSvg}</div>`)
  const iconSvg = logoIcon.querySelector('svg')!
  iconSvg.setAttribute('viewBox', '0 4 36 36')
  iconSvg.setAttribute('width', '96')
  iconSvg.setAttribute('height', '96')
  const eyes = [...iconSvg.querySelectorAll('ellipse')].slice(0, 2)

  const K = 96 / 36
  const left = W / 2 - (212 * K) / 2
  const finalIconX = left + 48
  const word = add(layer, `<div class="logo-word">${logoSvg}</div>`)
  const wordSvg = word.querySelector('svg')!
  wordSvg.setAttribute('viewBox', '46 0 166 44')
  wordSvg.setAttribute('width', String(166 * K))
  wordSvg.setAttribute('height', String(44 * K))
  word.style.left = `${left + 46 * K}px`
  word.style.top = `${CENTER.y - 48 - 4 * K}px`
  const tagline = add(layer, `<div class="tagline">Agents use your iPhones.</div>`)

  return (t) => {
    setVisible(layer, prog(t, SHAPES_AT, 0.3))
    if (t < SHAPES_AT) return

    const shapesOut = prog(t, LOGO_AT, 0.25)
    setVisible(svg, 1 - shapesOut)
    const appear = 0.6 + 0.4 * outCubic(prog(t, SHAPES_AT, 0.35))
    for (const h of shapes) {
      const scatter = outCubic(prog(t, SCATTER_AT, 0.5))
      const conv = inOutCubic(prog(t, CONVERGE_AT + h.delay, 0.6))
      let x = lerp(h.x + h.off.x * scatter, CENTER.x + h.path[0].x, conv)
      let y = lerp(h.y + h.off.y * scatter, CENTER.y + h.path[0].y, conv)
      let r = lerp(h.r, levels[0].r, conv)
      for (let l = 1; l < levels.length; l++) {
        const p = inOutCubic(prog(t, levels[l].at, LEVEL_DUR))
        if (p <= 0) break
        x = CENTER.x + lerp(h.path[l - 1].x, h.path[l].x, p)
        y = CENTER.y + lerp(h.path[l - 1].y, h.path[l].y, p)
        r = lerp(levels[l - 1].r, levels[l].r, p)
      }
      const rot = h.rot * scatter * (1 - conv)
      h.el.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${(r * appear).toFixed(3)})`)
    }

    const logoIn = prog(t, LOGO_AT + 0.03, 0.42)
    const slide = inOutCubic(prog(t, LOGO_AT + 0.7, 0.6))
    setVisible(logoIcon, prog(t, LOGO_AT, 0.2))
    logoIcon.style.left = `${lerp(CENTER.x, finalIconX, slide) - 48}px`
    logoIcon.style.top = `${CENTER.y - 48}px`
    logoIcon.style.transform = `scale(${lerp(0.85, 1, outBack(logoIn))})`
    const blink = 1 - 0.9 * (bump(t, LOGO_AT + 1.85, 0.18) + bump(t, LOGO_AT + 3.25, 0.18))
    for (const e of eyes) {
      const cx = Number(e.getAttribute('cx'))
      const cy = Number(e.getAttribute('cy'))
      e.setAttribute('transform', `translate(${cx} ${cy}) scale(1 ${blink}) translate(${-cx} ${-cy})`)
    }

    const reveal = outCubic(prog(t, LOGO_AT + 0.83, 0.6))
    setVisible(word, reveal)
    word.style.clipPath = `inset(0 ${(1 - reveal) * 100}% 0 0)`
    word.style.transform = `translateX(${(1 - reveal) * -24}px)`

    const tag = outCubic(prog(t, LOGO_AT + 1.4, 0.5))
    setVisible(tagline, tag)
    tagline.style.transform = `translateY(${(1 - tag) * 10}px)`
  }
}

// ---------------------------------------------------------------- main

let updates: Update[] = []

async function init() {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  await document.fonts.ready
  await Promise.all(['420 54px "Inter Variable"', '400 18px "JetBrains Mono Variable"'].map((f) => document.fonts.load(f)))
  const stage = document.getElementById('stage')!
  const world = sceneWorld(stage)
  updates = [
    sceneTitle(stage),
    sceneChat(stage),
    world.update,
    sceneOutro(stage, world.nodes),
    header(stage, 'Grok asks. Your iPhone does it.', CHAT_AT + 0.15, SWAP_AT + 0.02),
    header(stage, 'Or ask your dot.', SWAP_AT + 0.05, NET_AT - 0.03),
    header(stage, 'One bot, all your iPhones.', NET_AT + 0.2, ZOOM1_AT - 0.02),
    header(stage, 'Your teammates’ dots, too.', ZOOM1_AT + 0.08, ZOOM2_AT + 0.03),
    header(stage, 'Every bot and every iPhone, working together.', ZOOM2_AT + 0.13, SHAPES_AT + 0.05),
  ]
  await seek(0)
}

export async function seek(t: number) {
  pendingDecodes = []
  for (const u of updates) u(t)
  await Promise.all(pendingDecodes)
}

declare global {
  interface Window {
    video: { ready: Promise<void>; seek: (t: number) => Promise<void>; duration: number }
    /** Frame count per clip, set by scripts/render.ts. */
    clipFrames: Record<ClipName, number>
  }
}
window.video = { ready: init(), seek, duration: DURATION }
