// Promo video as a pure function of time. seek(t) sets every style from t, so any
// frame renders the same way in a browser preview or in headless Chrome.
//
//   0.0  title + hex icon cluster          12.0  network: one bot, six agents
//   3.8  chat panel + Claude Code terminal 15.9  zoom out: two teammates
//   8.0  terminal swaps to Codex           18.8  zoom out: whole team mesh
//                                          21.4  tiles -> hexes -> honeycomb -> logo

import logoSvg from '../../website/public/logo-ink.svg'

export const W = 1920
export const H = 1080
export const DURATION = 28.2

const INK = '#16120c'
const CORAL = '#d16d59'
const PURPLE = '#5b54ee'
const BLUE = '#2f8ff0'
const MUTED = '#8d877b'

// ---------------------------------------------------------------- math

const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
const lerp = (a: number, b: number, p: number) => a + (b - a) * p
const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur)
const outCubic = (p: number) => 1 - (1 - p) ** 3
const inCubic = (p: number) => p ** 3
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

// ---------------------------------------------------------------- art
// Everything is drawn in unit coordinates (radius 1) and scaled by icon().

const GHOST_PATH = logoSvg.match(/fill="url\(#ghost\)" d="([^"]+)"/)![1]

const art = {
  sparkle: (c = CORAL) =>
    `<path fill="${c}" d="M0 -1 C0.1 -0.25 0.25 -0.1 1 0 C0.25 0.1 0.1 0.25 0 1 C-0.1 0.25 -0.25 0.1 -1 0 C-0.25 -0.1 -0.1 -0.25 0 -1Z"/>`,
  ring: (c = INK) =>
    `<circle r="0.78" fill="none" stroke="${c}" stroke-width="0.16"/><path fill="${c}" d="M0 -0.4 L0.4 0 L0 0.4 L-0.4 0Z"/>`,
  phone: (c = '#fff') =>
    `<rect x="-0.5" y="-0.9" width="1" height="1.8" rx="0.22" fill="none" stroke="${c}" stroke-width="0.13"/><rect x="-0.17" y="-0.74" width="0.34" height="0.1" rx="0.05" fill="${c}"/>`,
  orb: () =>
    `<circle r="1" fill="${INK}"/><g class="eyes"><ellipse cx="0.16" cy="-0.28" rx="0.1" ry="0.19" fill="#fff"/><ellipse cx="0.47" cy="-0.2" rx="0.09" ry="0.17" fill="#fff"/></g>`,
  ghost: () =>
    `<g transform="scale(0.0034) translate(-512 -531)"><path fill="#fff" d="${GHOST_PATH}"/><ellipse cx="452" cy="478" rx="30" ry="40" fill="#26244f"/><ellipse cx="584" cy="478" rx="30" ry="40" fill="#26244f"/><ellipse cx="418" cy="548" rx="26" ry="14" fill="#c9c6f7"/><ellipse cx="618" cy="548" rx="26" ry="14" fill="#c9c6f7"/></g>`,
  ghostTile: () =>
    `<rect x="-1" y="-1" width="2" height="2" rx="0.45" fill="${PURPLE}"/><g transform="scale(0.62)">${art.ghost()}</g>`,
  blob: () =>
    `<line x1="0.1" y1="-0.8" x2="0.28" y2="-1.06" stroke="${BLUE}" stroke-width="0.09" stroke-linecap="round"/><circle cx="0.3" cy="-1.08" r="0.1" fill="${BLUE}"/><rect x="-0.95" y="-0.82" width="1.9" height="1.72" rx="0.72" fill="${BLUE}"/><ellipse cx="-0.28" cy="-0.02" rx="0.09" ry="0.13" fill="${INK}"/><ellipse cx="0.28" cy="-0.02" rx="0.09" ry="0.13" fill="${INK}"/>`,
  bean: () =>
    `<rect x="-0.72" y="-1" width="1.44" height="2" rx="0.72" fill="#eadcc4"/><circle cx="-0.22" cy="-0.15" r="0.08" fill="#3a2f25"/><circle cx="0.22" cy="-0.15" r="0.08" fill="#3a2f25"/><ellipse cx="-0.4" cy="0.08" rx="0.13" ry="0.07" fill="#f0b6a4"/><ellipse cx="0.4" cy="0.08" rx="0.13" ry="0.07" fill="#f0b6a4"/>`,
}
type Mascot = 'orb' | 'ghostTile' | 'blob' | 'bean'

const icon = (inner: string, size: number) =>
  `<svg class="icon" width="${size}" height="${size}" viewBox="-1.15 -1.15 2.3 2.3" overflow="visible">${inner}</svg>`

const AGENTS = {
  A: { name: 'Claude Code', onLight: art.sparkle(), onDark: art.sparkle() },
  B: { name: 'Codex', onLight: art.ring(INK), onDark: art.ring('#f3efe6') },
}
type AgentId = keyof typeof AGENTS

const hexPoints = (r: number) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = (Math.PI / 3) * k
    return `${(r * Math.cos(a)).toFixed(3)},${(r * Math.sin(a)).toFixed(3)}`
  }).join(' ')

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

.hexgrid { position: absolute; inset: 0; fill: none; stroke: #e2e2d9; stroke-width: 2; stroke-linejoin: round;
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

.term { background: ${INK}; color: #e9e4da }
.term-head { height: 80px; display: flex; align-items: center; gap: 14px; padding: 0 28px }
.dots { display: flex; gap: 9px; margin-right: 16px }
.dots i { width: 11px; height: 11px; border-radius: 50%; background: #4a453d }
.term-name { font-size: 30px; color: #f3efe6 }
.term-cwd { margin-left: auto; font-size: 19px; color: ${MUTED} }
.term-body { position: absolute; left: 28px; right: 28px; top: 100px; bottom: 124px; font-size: 18.5px; line-height: 1.62;
  white-space: pre-wrap; overflow: hidden }
.welcome { border: 1.5px solid #4a453d; border-radius: 8px; padding: 14px 20px; margin-bottom: 20px }
.welcome.accent { border-color: ${CORAL} }
.dim { color: ${MUTED} }
.coral { color: ${CORAL} }
.ok { color: #6fcf7f }
.from { color: ${CORAL}; font-size: 14px; margin-left: 14px }
.diff { background: #1f3a22; color: #d7f0d9; margin: 0 -28px; padding: 0 28px }
.hl { background: #2a2620; margin: 0 -28px; padding: 5px 28px }
.term-foot { position: absolute; left: 28px; right: 28px; bottom: 24px; font-size: 16px; color: ${MUTED}; white-space: pre }
.tbox { border: 1.5px solid #3b3630; border-radius: 8px; height: 54px; display: flex; align-items: center; padding: 0 18px;
  font-size: 18.5px; color: #e9e4da; margin-bottom: 12px }
.prompt-line { font-size: 18.5px; color: #e9e4da; margin-bottom: 14px }
.foot-row { display: flex; justify-content: space-between }

.world { position: absolute; left: 0; top: 0; transform-origin: 0 0 }
.links { position: absolute; inset: 0; overflow: visible }
.links line { stroke: #c9c9c0; stroke-width: 1.6; stroke-dasharray: 6 7 }
.links line.far { stroke-width: 1; stroke-dasharray: none; stroke: #d6d6ce }
.node { position: absolute; border-radius: 14px; box-shadow: 0 2px 6px rgba(22, 18, 12, 0.05), 0 16px 40px rgba(22, 18, 12, 0.1) }
.node.agent { width: 300px; height: 176px; background: ${INK}; color: #e9e4da }
.node.hub { width: 316px; height: 196px; background: #fff }
.node .tile-art { position: absolute; inset: 0; display: grid; place-items: center }
.node .detail { position: absolute; inset: 0 }
.card-head { display: flex; align-items: center; gap: 12px; padding: 16px 18px 10px; font-size: 24px; color: #f3efe6 }
.card-body { padding: 0 18px; font-size: 16.5px; line-height: 1.55; white-space: pre-wrap }
.hub-head { display: flex; align-items: center; gap: 10px; padding: 16px 18px 10px; font-size: 24px; font-weight: 460 }
.hub-bubble { margin: 0 16px; background: #1b1712; color: #fff; border-radius: 14px; padding: 10px 14px; font-size: 17px; line-height: 1.35 }
.hub-foot { padding: 12px 18px; font-size: 15px; color: ${MUTED} }
.label { position: absolute; left: -100px; right: -100px; top: -60px; text-align: center; font-size: 40px; letter-spacing: -0.02em }

.hexes { position: absolute; inset: 0 }
.hexes path, .hexes polygon { fill: ${INK}; stroke: ${INK}; stroke-width: 0.32; stroke-linejoin: round }
.logo-icon { position: absolute; width: 96px; height: 96px }
.logo-word { position: absolute }
.tagline { position: absolute; left: 0; right: 0; top: 606px; text-align: center; font-size: 28px; color: ${MUTED}; letter-spacing: -0.01em }
`

// ---------------------------------------------------------------- headers

function header(stage: HTMLElement, text: string, tIn: number, tOut: number): Update {
  const el = add(stage, `<div class="header">${text}</div>`)
  return (t) => {
    const p = shown(t, tIn, tOut, 0.35, 0.2)
    setVisible(el, p)
    el.style.transform = `translateY(${(1 - outCubic(prog(t, tIn, 0.4))) * 10}px)`
  }
}

// ---------------------------------------------------------------- scene 1: title + hex cluster

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
      grid += `<polygon points="${hexPoints(R - 12)}" transform="translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})"/>`
    }
  }
  add(layer, `<svg class="hexgrid" width="${W}" height="${H}">${grid}</svg>`)

  const cells = [
    { c: 0, r: 0, bg: '#fff', inner: art.sparkle(), scale: 46 },
    { c: 2, r: 0, bg: PURPLE, inner: art.ghost(), scale: 66 },
    { c: 1, r: 1, bg: '#fff', inner: art.orb(), scale: 44 },
    { c: 0, r: 2, bg: '#fff', inner: art.ring(), scale: 46 },
    { c: 2, r: 2, bg: INK, inner: art.phone(), scale: 52 },
    { c: 3, r: 1, bg: '', inner: art.blob(), scale: 86 },
  ].map((d) => {
    const p = cell(d.c, d.r)
    const bg = d.bg
      ? `<polygon points="${hexPoints(92)}" fill="${d.bg}" stroke="${d.bg}" stroke-width="24" stroke-linejoin="round"/>`
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

  const words = 'Your chat bots, talking to|your coding agents.'
    .split('|')
    .map((line) => line.split(' ').map((w) => `<span class="w">${w}</span>`).join(' '))
    .join('<br>')
  const title = add(layer, `<div class="title">${words}</div>`)
  const wordEls = [...title.querySelectorAll<HTMLElement>('.w')]

  return (t) => {
    setVisible(layer, 1 - prog(t, 3.72, 0.3))
    if (t > 4.1) return
    wordEls.forEach((w, i) => {
      const p = outCubic(prog(t, 0.12 + i * 0.085, 0.45))
      w.style.opacity = String(p)
      w.style.transform = `translateY(${(1 - p) * 8}px)`
    })
    hops.forEach(([from, to, start], i) => {
      const a = cells[from]
      const b = cells[to]
      const p = prog(t, start, HOP)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const f = 96 / len
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

// ---------------------------------------------------------------- scene 2-3: chat + terminals

interface TerminalOptions {
  agent: AgentId
  welcome: string
  welcomeClass: string
  lines: Array<[number, string]>
  working: { from: number; to: number; text: (secs: number, t: number) => string }
  foot: string
}

function terminal(parent: HTMLElement, o: TerminalOptions): { el: HTMLElement; update: Update } {
  const el = add(
    parent,
    `<div class="panel term" style="left:1010px;top:160px;width:800px;height:760px">
      <div class="term-head"><div class="dots"><i></i><i></i><i></i></div>${icon(AGENTS[o.agent].onDark, 34)}<span class="term-name">${AGENTS[o.agent].name}</span><span class="term-cwd mono">~/code/app</span></div>
      <div class="term-body mono"><div class="welcome ${o.welcomeClass}">${o.welcome}</div></div>
      <div class="term-foot mono">${o.foot}</div>
    </div>`,
  )
  const body = el.querySelector('.term-body')!
  const lines = o.lines.map(([at, html]) => ({ at, el: add(body, `<div>${html}</div>`) }))
  const working = add(body, `<div class="coral"></div>`)
  const cursor = el.querySelector<HTMLElement>('.cursor')
  return {
    el,
    update: (t) => {
      for (const l of lines) setVisible(l.el, prog(t, l.at, 0.12))
      const w = t >= o.working.from && t < o.working.to
      working.style.display = w ? '' : 'none'
      if (w) working.textContent = o.working.text(Math.floor(t - o.working.from) + 1, t)
      if (cursor) cursor.style.opacity = Math.floor(t * 2.2) % 2 ? '0' : '1'
    },
  }
}

function sceneChat(stage: HTMLElement): Update {
  const layer = add(stage, `<div class="layer"></div>`)
  const sendIcon = `<svg width="22" height="22" viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  const chat = add(
    layer,
    `<div class="panel chat" style="left:112px;top:162px;width:856px;height:758px">
      <div class="chat-head">${icon(art.orb(), 42)}<span class="chat-name">Grok</span><span class="chat-role">Dev Lead</span></div>
      <div class="chat-body"></div>
      <div class="chat-input"><span class="chat-text"></span><span class="chat-send">${sendIcon}</span></div>
    </div>`,
  )
  const body = chat.querySelector('.chat-body')!
  const inputText = chat.querySelector<HTMLElement>('.chat-text')!
  const sendBtn = chat.querySelector<HTMLElement>('.chat-send')!

  const ASK_1 = 'Ask Claude Code to add a retry to fetchUser(), with a test.'
  const ASK_2 = 'Now have Codex review it.'
  const typing = [
    { from: 4.2, to: 5.0, send: 5.1, text: ASK_1 },
    { from: 8.35, to: 8.72, send: 8.85, text: ASK_2 },
  ]
  const user = (text: string) => `<div class="row right"><div class="bubble dark">${text}</div></div>`
  const bot = (text: string) =>
    `<div class="row">${icon(art.orb(), 34)}<div class="bubble light">${text}</div></div>`
  const status = (agent: AgentId) =>
    `<div class="status">${icon(AGENTS[agent].onLight, 22)}<span class="spin"></span><span class="st"></span></div>`

  const msgs = [
    { at: 5.1, html: user(ASK_1) },
    { at: 5.35, html: status('A'), asking: 'Asking Claude Code', done: 'Claude Code replied', doneAt: 7.4 },
    { at: 7.55, html: bot('Claude Code added a retry to fetchUser() and a test for it. All 6 tests pass.') },
    { at: 8.85, html: user(ASK_2) },
    { at: 9.05, html: status('B'), asking: 'Asking Codex', done: 'Codex replied', doneAt: 10.9 },
    { at: 11.05, html: bot('Codex reviewed it: looks good, no changes needed.') },
  ].map((m) => {
    const el = add(body, `<div class="msg"><div class="msg-inner">${m.html}</div></div>`)
    return { ...m, el, inner: el.firstElementChild as HTMLElement, height: el.scrollHeight }
  })

  const termA = terminal(layer, {
    agent: 'A',
    welcomeClass: 'accent',
    welcome: `<span class="coral">✦</span> Welcome to Claude Code\n\n  <span class="dim">/help for help, /status for your current setup</span>\n\n  <span class="dim">cwd: ~/code/app</span>`,
    lines: [
      [5.5, `<span class="dim">&gt;</span> Add a retry to fetchUser(), with a test<span class="from">from Grok</span>\n`],
      [5.85, `<span class="ok">●</span> Update(api.ts)`],
      [5.95, `<span class="dim">  └ Updated api.ts with 3 additions</span>`],
      [6.05, `<div class="diff">    41 + export const fetchUser = (id: string) =&gt;</div>`],
      [6.12, `<div class="diff">    42 +   retry(() =&gt; get(\`/users/\${id}\`), { times: 3 })</div>`],
      [6.19, `<div class="diff">    43 + </div>`],
      [6.4, `<span class="ok">●</span> Update(api.test.ts)`],
      [6.5, `<span class="dim">  └ Updated api.test.ts with 12 additions</span>`],
      [6.7, `<span class="ok">●</span> Bash(pnpm test)`],
      [6.85, `<span class="dim">  └ Tests: 6 passed, 6 total</span>\n`],
      [7.1, `<span class="ok">●</span> fetchUser() now retries 3 times. All 6 tests pass.`],
    ],
    working: { from: 5.6, to: 7.1, text: (s, t) => `${spinner(t)} Working… (${s}s · esc to interrupt)` },
    foot: `<div class="tbox">&gt; <span class="cursor">▌</span></div>? for shortcuts`,
  })

  const termB = terminal(layer, {
    agent: 'B',
    welcomeClass: '',
    welcome: `&gt;_ Codex\n\n<span class="dim">model:</span>     gpt-5.5   <span class="dim">/model to change</span>\n<span class="dim">directory:</span> ~/code/app`,
    lines: [
      [9.2, `<div class="hl">› Review the fetchUser retry in api.ts<span class="from" style="color:${MUTED}">from Grok</span></div>`],
      [9.5, `\n• Explored`],
      [9.6, `<span class="dim">  └ Read api.ts, api.test.ts</span>`],
      [9.9, `• Ran pnpm test`],
      [10.05, `<span class="dim">  └ Tests: 6 passed, 6 total</span>\n`],
      [10.7, `• Looks good. The retry backs off and the test covers a failing first call. No changes needed.`],
    ],
    working: { from: 9.3, to: 10.7, text: (s, t) => `${spinner(t)} Working (${s}s · esc to interrupt)` },
    foot: `<div class="prompt-line">› Ask Codex to do anything</div><div class="foot-row"><span>⏎ send  ^J newline  ^T transcript  ^C quit</span><span>100% context left</span></div>`,
  })

  return (t) => {
    const pIn = outCubic(prog(t, 3.78, 0.4))
    setVisible(layer, Math.min(pIn, 1 - prog(t, 11.95, 0.3)))
    if (t < 3.7 || t > 12.3) return
    layer.style.transform = `translateY(${(1 - pIn) * 12}px) scale(${0.985 + 0.015 * pIn})`

    const active = typing.find((ty) => t >= ty.from && t < ty.send)
    const typed = active ? active.text.slice(0, Math.round(active.text.length * prog(t, active.from, active.to - active.from))) : ''
    inputText.textContent = typed || 'Message Grok'
    inputText.className = typed ? 'chat-text' : 'chat-text ph'
    sendBtn.style.transform = `scale(${1 - 0.14 * typing.reduce((s, ty) => s + bump(t, ty.send - 0.12, 0.24), 0)})`

    for (const m of msgs) {
      const p = outCubic(prog(t, m.at, 0.38))
      m.el.style.height = `${m.height * p}px`
      m.el.style.display = p > 0 ? '' : 'none'
      m.inner.style.opacity = String(prog(t, m.at + 0.04, 0.28))
      m.inner.style.transform = `translateY(${(1 - p) * 14}px) scale(${0.97 + 0.03 * p})`
      if (m.asking) {
        const done = t >= m.doneAt!
        m.el.querySelector('.spin')!.textContent = done ? '✓' : spinner(t)
        m.el.querySelector('.st')!.textContent = done ? m.done! : m.asking
      }
    }

    termA.update(t)
    termB.update(t)
    setVisible(termA.el, 1 - prog(t, 8.0, 0.3))
    setVisible(termB.el, prog(t, 8.0, 0.3))
  }
}

// ---------------------------------------------------------------- scene 4-6: agent network

interface WNode {
  x: number
  y: number
  kind: 'hub' | 'agent'
  agent: AgentId
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
  { t: 15.9, d: 0.85, cam: { s: 0.55, x: 492, y: 576 } },
  { t: 18.75, d: 0.9, cam: { s: 0.278, x: 720, y: 574 } },
]
const CAM_END = CAM_KEYS[CAM_KEYS.length - 1].cam
const MORPH_AT = 15.95
const HEX_AT = 21.35

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

const TASKS: Array<{ side: number; row: number; agent: AgentId; prompt: string; result: string; at: number; doneAt: number }> = [
  { side: -1, row: -1, agent: 'A', prompt: 'fix the flaky login test', result: 'Fixed. 20 runs green', at: 12.6, doneAt: 14.0 },
  { side: 1, row: -1, agent: 'B', prompt: 'review PR #219', result: 'Approved, one nit', at: 12.78, doneAt: 13.7 },
  { side: -1, row: 0, agent: 'B', prompt: 'why is /api/feed slow?', result: 'N+1 query in feed.ts:58', at: 12.96, doneAt: 14.6 },
  { side: 1, row: 0, agent: 'A', prompt: 'write the billing migration', result: 'Added, tests pass', at: 13.14, doneAt: 14.9 },
  { side: -1, row: 1, agent: 'A', prompt: 'add dark mode to settings', result: 'Done, screenshots attached', at: 13.32, doneAt: 15.2 },
  { side: 1, row: 1, agent: 'B', prompt: 'bump deps and run CI', result: 'CI green', at: 13.5, doneAt: 14.3 },
]
const RETURN = 0.45

const HUB_NAMES: Record<string, string> = {
  '-1,-1': 'Ana', '0,-1': 'Omar', '1,-1': 'Kai', '2,-1': 'Ines',
  '-1,0': 'Priya', '0,0': 'You', '1,0': 'Sam', '2,0': 'Leo',
  '-1,1': 'Theo', '0,1': 'June', '1,1': 'Ravi', '2,1': 'Noor',
}
const HUB_MASCOTS: Record<string, Mascot> = { '0,0': 'orb', '1,0': 'ghostTile' }
const MASCOT_CYCLE: Mascot[] = ['blob', 'bean', 'orb', 'ghostTile', 'bean', 'blob']

function sceneWorld(stage: HTMLElement): { update: Update; nodes: WNode[] } {
  const layer = add(stage, `<div class="layer"></div>`)
  const linksSvg = add<SVGSVGElement>(layer, `<svg class="links" width="${W}" height="${H}"></svg>`)
  const world = add(layer, `<div class="world"></div>`)
  const particlesSvg = add<SVGSVGElement>(layer, `<svg class="layer" width="${W}" height="${H}"></svg>`)
  const rnd = random(7)

  const k1 = CAM_KEYS[0].cam
  const onScreen = (cam: Camera, x: number, y: number, m = 0) => {
    const p = toScreen(cam, x, y)
    return p.x > -170 * cam.s - m && p.x < W + 170 * cam.s + m && p.y > -100 * cam.s - m && p.y < H + 100 * cam.s + m
  }
  const appearAt = (x: number, y: number) => {
    if (Math.abs(x) <= SIDE && Math.abs(y) <= TROW) return 0
    // the teammate scene only adds the middle row, the mesh scene adds the rest
    if (Math.abs(y) <= TROW && onScreen(k1, x, y)) return 16.0 + Math.hypot(x, y) / 9000
    const p = toScreen(CAM_END, x, y)
    return 18.85 + (Math.hypot(p.x - W / 2, p.y - H / 2) / 1100) * 0.45
  }

  const nodes: WNode[] = []
  const hubs = new Map<string, { hub: WNode; left: WNode[]; right: WNode[] }>()

  const addAgent = (x: number, y: number, agent: AgentId, task?: (typeof TASKS)[number]): WNode => {
    const n: WNode = { x, y, kind: 'agent', agent, appear: appearAt(x, y), el: null! }
    n.el = add(
      world,
      `<div class="node agent" style="left:${x - 150}px;top:${y - 88}px"><div class="tile-art">${icon(AGENTS[agent].onDark, 104)}</div></div>`,
    )
    if (task) {
      n.tileArt = n.el.querySelector<HTMLElement>('.tile-art')!
      n.detail = add(
        n.el,
        `<div class="detail"><div class="card-head">${icon(AGENTS[agent].onDark, 28)}${AGENTS[agent].name}</div><div class="card-body mono"><div class="prompt"></div><div class="state"></div></div></div>`,
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
          state.textContent = agent === 'A' ? `✦ Working…` : `${spinner(t)} Working`
          state.style.color = agent === 'A' ? CORAL : MUTED
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
          const agent: AgentId = task?.agent ?? (Math.abs(c + r + i + (side > 0 ? 1 : 0)) % 2 === 0 ? 'A' : 'B')
          ;(side < 0 ? left : right).push(addAgent(x, y, agent, task))
        }
      }
      if (!onScreen(CAM_END, hx, hy)) continue
      const key = `${c},${r}`
      const mascot = HUB_MASCOTS[key] ?? MASCOT_CYCLE[(c + 2 + (r + 1) * 4) % MASCOT_CYCLE.length]
      const hub: WNode = { x: hx, y: hy, kind: 'hub', agent: 'A', appear: appearAt(hx, hy), el: null! }
      hub.el = add(
        world,
        `<div class="node hub" style="left:${hx - 158}px;top:${hy - 98}px"><div class="label">${HUB_NAMES[key] ?? ''}</div><div class="tile-art">${icon(art[mascot](), 104)}</div></div>`,
      )
      if (key === '0,0') {
        hub.tileArt = hub.el.querySelector<HTMLElement>('.tile-art')!
        hub.detail = add(
          hub.el,
          `<div class="detail"><div class="hub-head">${icon(art.orb(), 28)}Grok</div><div class="hub-bubble">fix the flaky test, dark mode, review #219…</div><div class="hub-foot"></div></div>`,
        )
        const foot = hub.detail.querySelector('.hub-foot')!
        hub.update = (t) => {
          const replied = TASKS.filter((k) => t >= k.doneAt + RETURN).length
          foot.textContent = t < 12.95 ? `${spinner(t)} Asking 6 agents…` : `✓ Asked 6 agents · ${replied} replied`
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
  const farCandidates = nodes.filter((n) => n.appear >= 16)
  for (let i = 0; i < 40; i++) {
    const a = farCandidates[Math.floor(rnd() * farCandidates.length)]
    const b = farCandidates[Math.floor(rnd() * farCandidates.length)]
    const d = Math.hypot(a.x - b.x, a.y - b.y)
    if (a === b || d < 1200 || d > 3600) continue
    link(a, b, true, 19.1 + rnd() * 0.9)
  }

  // particles: scripted dispatch/return for the first scene, then ambient traffic
  const particles: Particle[] = []
  const you = hubs.get('0,0')!.hub
  for (const task of TASKS) {
    const l = links.find((k) => k.a === you && k.b.x === task.side * SIDE && k.b.y === task.row * TROW)!
    const color = task.agent === 'A' ? CORAL : INK
    particles.push({ link: l, start: task.at - 0.42, dur: 0.42, reverse: false, color })
    particles.push({ link: l, start: task.doneAt, dur: RETURN, reverse: true, color })
  }
  for (const l of links) {
    const len = Math.hypot(l.a.x - l.b.x, l.a.y - l.b.y)
    const dur = 0.55 + len / 2600
    let start = Math.max(l.appear + 0.25, 16.2) + rnd() * 1.6
    while (start < HEX_AT) {
      const coral = (l.a.agent === 'A' || l.b.agent === 'A') && rnd() < 0.45
      particles.push({ link: l, start, dur, reverse: rnd() < 0.5, color: coral ? CORAL : INK })
      start += dur + 0.8 + rnd() * 1.8
    }
  }
  const pool = Array.from({ length: 160 }, () => svgEl(particlesSvg, 'circle', { r: 6 }))

  const update: Update = (t) => {
    const layerOpacity = Math.min(prog(t, 12.0, 0.3), 1 - prog(t, HEX_AT, 0.3))
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

// ---------------------------------------------------------------- scene 7: hexes -> honeycomb -> logo

const CENTER = { x: 960, y: 520 }
const SCATTER_AT = 22.15
const CONVERGE_AT = 22.55
const COLLAPSE_AT = 23.35
const LOGO_AT = 24.05

function sceneOutro(stage: HTMLElement, nodes: WNode[]): Update {
  const layer = add(stage, `<div class="layer"></div>`)
  const svg = add<SVGSVGElement>(layer, `<svg class="hexes" width="${W}" height="${H}"></svg>`)
  const rnd = random(11)

  const starts = nodes
    .filter((n) => n.appear < HEX_AT)
    .map((n) => {
      const p = toScreen(CAM_END, n.x, n.y)
      return { x: p.x, y: p.y, r: n.kind === 'hub' ? 30 : 26 }
    })
    .filter((p) => p.x > -40 && p.x < W + 40 && p.y > -40 && p.y < H + 40)
    .sort((a, b) => Math.hypot(a.x - CENTER.x, a.y - CENTER.y) - Math.hypot(b.x - CENTER.x, b.y - CENTER.y))

  // Honeycomb slots, nearest to the center first.
  const honeycomb = (step: number, count: number) => {
    const slots: Array<{ x: number; y: number }> = []
    for (let q = -14; q <= 14; q++) {
      for (let r = -14; r <= 14; r++) slots.push({ x: 1.5 * step * q, y: Math.sqrt(3) * step * (r + q / 2) })
    }
    return slots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y)).slice(0, count)
  }
  // The honeycomb collapses in steps: fewer, bigger hexes. Hexes that land on the same slot merge.
  const levels = [
    { step: 31, r: 25, slots: honeycomb(31, starts.length), at: 0 },
    { step: 44, r: 35, slots: honeycomb(44, 19), at: COLLAPSE_AT },
    { step: 58, r: 46, slots: honeycomb(58, 7), at: COLLAPSE_AT + 0.24 },
    { step: 0, r: 52, slots: [{ x: 0, y: 0 }], at: COLLAPSE_AT + 0.46 },
  ]
  const LEVEL_DUR = 0.22

  const hexes = starts.map((s, i) => {
    const angle = rnd() * Math.PI * 2
    const dist = 50 + rnd() * 170
    // slot at each level: nearest slot to where the hex sits at the previous level
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
      rot: (rnd() - 0.5) * 140,
      delay: rnd() * 0.22,
      el: svgEl(svg, 'polygon', { points: hexPoints(0.84) }),
    }
  })

  const logoIcon = add(layer, `<div class="logo-icon">${logoSvg}</div>`)
  const iconSvg = logoIcon.querySelector('svg')!
  iconSvg.setAttribute('viewBox', '0 4 36 36')
  iconSvg.setAttribute('width', '96')
  iconSvg.setAttribute('height', '96')
  const eyes = [...iconSvg.querySelectorAll('ellipse')].slice(0, 2)

  const K = 96 / 36
  const wordWidth = 166 * K
  const totalWidth = 212 * K
  const left = W / 2 - totalWidth / 2
  const finalIconX = left + 48
  const word = add(layer, `<div class="logo-word">${logoSvg}</div>`)
  const wordSvg = word.querySelector('svg')!
  wordSvg.setAttribute('viewBox', '46 0 166 44')
  wordSvg.setAttribute('width', String(wordWidth))
  wordSvg.setAttribute('height', String(44 * K))
  word.style.left = `${left + 46 * K}px`
  word.style.top = `${CENTER.y - 48 - 4 * K}px`
  const tagline = add(layer, `<div class="tagline">Bots and agents, working as one team.</div>`)

  return (t) => {
    setVisible(layer, prog(t, HEX_AT, 0.3))
    if (t < HEX_AT) return

    const hexOut = prog(t, LOGO_AT, 0.25)
    setVisible(svg, 1 - hexOut)
    const appear = 0.6 + 0.4 * outCubic(prog(t, HEX_AT, 0.35))
    const pop = 1 - 0.4 * inCubic(hexOut)
    for (const h of hexes) {
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
      h.el.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(2)}) scale(${(r * appear * pop).toFixed(3)})`)
    }

    const logoIn = prog(t, LOGO_AT + 0.03, 0.42)
    const slide = inOutCubic(prog(t, 24.75, 0.6))
    const iconX = lerp(CENTER.x, finalIconX, slide)
    setVisible(logoIcon, prog(t, LOGO_AT + 0.03, 0.15))
    logoIcon.style.left = `${iconX - 48}px`
    logoIcon.style.top = `${CENTER.y - 48}px`
    logoIcon.style.transform = `scale(${lerp(0.55, 1, outBack(logoIn))})`
    const blink = 1 - 0.9 * (bump(t, 25.9, 0.18) + bump(t, 27.3, 0.18))
    for (const e of eyes) {
      const cx = e.getAttribute('cx')
      const cy = e.getAttribute('cy')
      e.setAttribute('transform', `translate(${cx} ${cy}) scale(1 ${blink}) translate(${-cx!} ${-cy!})`)
    }

    const reveal = outCubic(prog(t, 24.88, 0.6))
    setVisible(word, reveal)
    word.style.clipPath = `inset(0 ${(1 - reveal) * 100}% 0 0)`
    word.style.transform = `translateX(${(1 - reveal) * -24}px)`

    const tag = outCubic(prog(t, 25.45, 0.5))
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
    header(stage, 'Grok asks. Claude Code writes the code.', 3.95, 8.02),
    header(stage, 'Then Codex reviews it.', 8.05, 11.97),
    header(stage, 'One bot, all your agents.', 12.2, 15.88),
    header(stage, 'Your teammates’ bots join in.', 15.98, 18.78),
    header(stage, 'Every bot and agent on the team, in sync.', 18.88, HEX_AT + 0.05),
  ]
  seek(0)
}

export function seek(t: number) {
  for (const u of updates) u(t)
}

declare global {
  interface Window {
    video: { ready: Promise<void>; seek: (t: number) => void; duration: number }
  }
}
window.video = { ready: init(), seek, duration: DURATION }
