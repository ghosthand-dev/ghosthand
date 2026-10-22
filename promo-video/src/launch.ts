// Launch video: "Give your agent a phone". A step-by-step setup in a toon-shaded 3D world
// (src/launch-3d.ts), with HTML text on top, then the real agent demo, then the end card.
// Pure function of time like src/video.ts: seek(t) sets the camera, meshes, screen and text from t.
//
//   0.0  hook title                       16.2  how it works: Bluetooth = mouse + keyboard, USB = screen
//   2.2  01 a Mac (drops in)              23.1  05 CLI, MCP, API cards; camera pushes into the screen
//   5.2  02 an iPhone (pops in)           27.7  real demo clip at 2.2x (demo-video/out/tiktok.mp4)
//   8.2  03 USB cable                     41.7  end card
//  11.2  04 unlock, trust, pair

import * as THREE from 'three'
import logoSvg from '../../website/public/logo-ink.svg'
import { createWorld, PALETTE, PHONE } from './launch-3d.ts'
import { appCenter, createScreen, keyCenter, PAIR_BUTTON, SCREEN_POINTS, TRUST_BUTTON, type ScreenState } from './launch-screens.ts'
import {
  add, bump, clamp, CLIP_FPS, CLIPS, inOutCubic, lerp, outBack, outCubic, prog, setImage, setVisible, shown, svgEl, waitDecodes,
  type Sound, type Update,
} from './shared.ts'

const W = 1920
const H = 1080
const { text: TEXT, accent: ACCENT, accentLight: ACCENT_LIGHT, muted: MUTED, surface: SURFACE, border: BORDER } = PALETTE

// scene starts, every other time is relative to one of these
// each step stays on screen only long enough to read its text
const MAC_AT = 2.2
const PHONE_AT = MAC_AT + 3
const USB_AT = PHONE_AT + 3
const PAIR_AT = USB_AT + 3
const HOW_AT = PAIR_AT + 5
const USB_BEAT_AT = HOW_AT + 3.7
const CONTROL_AT = USB_BEAT_AT + 3.2
const PUSH_AT = CONTROL_AT + 3.8
const DEMO_AT = PUSH_AT + 0.8
const DEMO_CLIP = CLIPS.find((c) => c.name === 'demo')!
/** The demo recording plays sped up, so the whole TikTok upload fits. */
const DEMO_SPEED = 2.2
const DEMO_LEN = DEMO_CLIP.duration / DEMO_SPEED
const END_AT = DEMO_AT + DEMO_LEN - 0.4
const DURATION = END_AT + 4

/** Left column x and the screen shift that keeps the 3D objects right of the text. */
const TEXT_X = 150
const TEXT_SHIFT = 300

// ---------------------------------------------------------------- styles

const CSS = /* css */ `
* { box-sizing: border-box; margin: 0; padding: 0 }
html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: ${PALETTE.bg} }
#stage { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: ${PALETTE.bg};
  font-family: 'DM Sans Variable', sans-serif; color: ${TEXT}; -webkit-font-smoothing: antialiased }
.layer { position: absolute; inset: 0 }
canvas { position: absolute; inset: 0; width: ${W}px; height: ${H}px }
.serif { font-family: 'Fraunces Variable', serif; font-variation-settings: 'SOFT' 100, 'WONK' 0; letter-spacing: -0.02em }
.serif em { font-style: italic; color: ${ACCENT_LIGHT}; font-variation-settings: 'SOFT' 100, 'WONK' 1 }
.hand { font-family: 'Caveat Variable', cursive; font-weight: 600; color: ${TEXT} }
.mono { font-family: 'JetBrains Mono Variable', monospace }
.kicker { font-size: 17px; font-weight: 600; letter-spacing: 0.34em; text-transform: uppercase; color: ${ACCENT_LIGHT};
  display: flex; align-items: center; gap: 16px }
.kicker::before { content: ''; width: 34px; height: 2px; background: ${ACCENT}; border-radius: 2px }
.block { position: absolute; left: ${TEXT_X}px; top: 0; width: 640px }
.block .title { font-size: 92px; line-height: 0.98; font-weight: 420; margin-top: 26px }
.block .body { font-size: 25px; line-height: 1.45; color: ${MUTED}; margin-top: 28px; max-width: 520px }
.line { display: block; overflow: hidden; padding-bottom: 0.08em }
.line > span { display: inline-block }
.checks { margin-top: 34px; display: grid; gap: 16px }
.check { display: flex; align-items: center; gap: 16px; font-size: 25px; font-weight: 500 }
.box { width: 30px; height: 30px; border-radius: 9px; border: 2px solid ${PALETTE.dim}; display: grid; place-items: center; flex: none;
  background: ${SURFACE} }
.box svg { width: 20px; height: 20px }
.nav { position: absolute; left: ${TEXT_X}px; bottom: 74px; display: flex; gap: 34px; font-size: 15px; font-weight: 600;
  letter-spacing: 0.22em; text-transform: uppercase; color: ${MUTED} }
.nav div { position: relative; padding-bottom: 12px }
.nav i { position: absolute; left: 0; bottom: 0; height: 2.5px; border-radius: 2px; background: ${ACCENT} }
.note { position: absolute; font-size: 44px; line-height: 1; white-space: nowrap }
.note small { display: block; font-family: 'DM Sans Variable'; font-size: 15px; font-weight: 600; letter-spacing: 0.24em;
  text-transform: uppercase; color: ${ACCENT_LIGHT}; margin-bottom: 8px }
.card { position: absolute; padding: 20px 24px 22px; border-radius: 18px; background: ${SURFACE};
  border: 1.5px solid ${BORDER}; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 6px 6px 0 ${ACCENT} }
.card .tag { font-size: 14px; font-weight: 700; letter-spacing: 0.24em; color: ${ACCENT_LIGHT}; display: flex; justify-content: space-between }
.card .tag span:last-child { color: ${MUTED}; letter-spacing: 0.06em; font-weight: 500; text-transform: none; font-size: 15px }
.card pre { margin-top: 12px; font-size: 18px; line-height: 1.5; color: ${TEXT}; white-space: pre }
.card pre b { color: ${ACCENT_LIGHT}; font-weight: 600 }
.ripple { position: absolute; width: 0; height: 0 }
.ripple div { position: absolute; border-radius: 50%; border: 3px solid ${ACCENT_LIGHT}; transform: translate(-50%, -50%) }
.badge { position: absolute; display: flex; align-items: center; gap: 14px }
.thumb { position: absolute; width: 36px; height: 62px; border-radius: 8px; border: 1.5px solid ${BORDER}; margin: -31px 0 0 -18px;
  background: linear-gradient(#1e1b4b, ${ACCENT} 55%, #a5b4fc); box-shadow: 3px 3px 0 ${ACCENT} }
.travel { position: absolute; width: 64px; height: 64px; margin: -32px 0 0 -32px; border-radius: 18px; background: ${SURFACE};
  border: 1.5px solid ${BORDER}; display: grid; place-items: center; box-shadow: 4px 4px 0 ${ACCENT} }
#demo { background: radial-gradient(ellipse at 50% 45%, ${PALETTE.bgGlow}, ${PALETTE.bg} 70%) }
#demo .frame { position: absolute; left: ${(W - 1488) / 2}px; top: 170px; width: 1488px; height: 837px; border-radius: 26px; overflow: hidden;
  border: 1.5px solid ${BORDER}; box-shadow: 0 40px 90px rgba(0, 0, 0, 0.6), 10px 10px 0 ${ACCENT} }
#demo img { width: 100%; height: 100%; display: block }
.end { position: absolute; left: 0; right: 0; top: 120px; text-align: center }
.pill { display: inline-flex; align-items: center; gap: 14px; padding: 16px 30px; border-radius: 999px; border: 1.5px solid ${BORDER};
  background: ${SURFACE}; font-size: 28px; box-shadow: 5px 5px 0 ${ACCENT} }
`

// ---------------------------------------------------------------- art

const GHOST_PATH = logoSvg.match(/fill="url\(#ghost\)" d="([^"]+)"/)![1]

/** Ghosthand ghost on the indigo logo tile, `size` px. */
const ghostTile = (size: number) => `
  <svg width="${size}" height="${size}" viewBox="-1.1 -1.1 2.2 2.2">
    <rect x="-1" y="-1" width="2" height="2" rx="0.46" fill="${ACCENT}"/>
    <g transform="scale(0.0021) translate(-512 -531)"><path fill="#ffffff" d="${GHOST_PATH}"/>
      <ellipse cx="452" cy="478" rx="30" ry="40" fill="#26244f"/><ellipse cx="584" cy="478" rx="30" ry="40" fill="#26244f"/></g>
  </svg>`

const CHECK = `<svg viewBox="0 0 20 20"><path d="M4 10.5 L8.5 15 L16 5.5" fill="none" stroke="#ffffff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`

const ICONS = {
  mouse: `<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="${TEXT}" stroke-width="1.8" stroke-linecap="round"><rect x="6" y="2.5" width="12" height="19" rx="6"/><path d="M12 2.5v6.5"/><path d="M6 9h12" opacity="0.4"/></svg>`,
  keyboard: `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="${TEXT}" stroke-width="1.7" stroke-linecap="round"><rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/></svg>`,
}

// ---------------------------------------------------------------- text helpers

/** Splits `html` on `|` into lines that rise out of a mask one after another. */
function lines(html: string) {
  return html.split('|').map((l) => `<span class="line"><span>${l}</span></span>`).join('')
}

/** Rising line reveal for every `.line > span` inside `el`, then a fade out. */
function revealLines(el: HTMLElement, t: number, tIn: number, tOut: number, stagger = 0.08) {
  const spans = [...el.querySelectorAll<HTMLElement>('.line > span')]
  spans.forEach((s, i) => {
    const p = outCubic(prog(t, tIn + i * stagger, 0.7))
    s.style.transform = `translateY(${(1 - p) * 110}%)`
  })
  const out = prog(t, tOut - 0.35, 0.35)
  setVisible(el, t < tIn ? 0 : 1 - out)
  el.style.transform = `translateY(${-out * 24}px)`
}

type Step = { kicker: string; title: string; body?: string; checks?: Array<{ label: string; at: number }>; tIn: number; tOut: number }

function textBlock(stage: HTMLElement, s: Step): Update {
  const el = add(stage, `
    <div class="block">
      <div class="kicker"><span class="line"><span>${s.kicker}</span></span></div>
      <div class="title serif">${lines(s.title)}</div>
      ${s.body ? `<div class="body">${lines(s.body)}</div>` : ''}
      ${s.checks ? `<div class="checks">${s.checks.map((c) => `<div class="check"><div class="box"></div><span>${c.label}</span></div>`).join('')}</div>` : ''}
    </div>`)
  // vertically centered in the space above the nav
  el.style.top = `${(H - 120 - el.offsetHeight) / 2}px`
  const boxes = [...el.querySelectorAll<HTMLElement>('.box')]
  const rows = [...el.querySelectorAll<HTMLElement>('.check')]
  boxes.forEach((b) => (b.innerHTML = CHECK))
  return (t) => {
    revealLines(el, t, s.tIn, s.tOut)
    s.checks?.forEach((c, i) => {
      const rowIn = outCubic(prog(t, s.tIn + 0.5 + i * 0.12, 0.5))
      rows[i].style.opacity = String(rowIn * (t > c.at ? 1 : 0.55))
      rows[i].style.transform = `translateX(${(1 - rowIn) * -20}px)`
      const done = outBack(prog(t, c.at, 0.35))
      const path = boxes[i].querySelector('path')!
      path.style.strokeDasharray = '24'
      path.style.strokeDashoffset = String(24 * (1 - clamp(done)))
      boxes[i].style.transform = `scale(${1 + 0.18 * bump(t, c.at, 0.35)})`
      boxes[i].style.background = t > c.at ? ACCENT : SURFACE
      boxes[i].style.borderColor = t > c.at ? ACCENT : PALETTE.dim
    })
  }
}

/** Hand-drawn arrow: quadratic curve with a small open head, as an SVG path. */
function arrowPath(from: { x: number; y: number }, to: { x: number; y: number }, bend: number) {
  const mx = (from.x + to.x) / 2
  const my = (from.y + to.y) / 2
  const dx = to.x - from.x
  const dy = to.y - from.y
  const c = { x: mx - dy * bend, y: my + dx * bend }
  const a = Math.atan2(to.y - c.y, to.x - c.x)
  const head = (da: number) => `${to.x - 18 * Math.cos(a + da)} ${to.y - 18 * Math.sin(a + da)}`
  return `M${from.x} ${from.y} Q${c.x} ${c.y} ${to.x} ${to.y} M${head(0.5)} L${to.x} ${to.y} L${head(-0.5)}`
}

// ---------------------------------------------------------------- camera

type Vec = [number, number, number]
type Shot = { t: number; pos: Vec; look: Vec; fov?: number; shift?: number }

function cameraRig(shots: Shot[]) {
  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  return (t: number) => {
    let i = shots.findIndex((s) => s.t > t)
    if (i === -1) i = shots.length
    const a = shots[Math.max(0, i - 1)]
    const b = shots[Math.min(shots.length - 1, i)]
    const p = a === b ? 0 : inOutCubic(prog(t, a.t, b.t - a.t))
    pos.set(lerp(a.pos[0], b.pos[0], p), lerp(a.pos[1], b.pos[1], p), lerp(a.pos[2], b.pos[2], p))
    look.set(lerp(a.look[0], b.look[0], p), lerp(a.look[1], b.look[1], p), lerp(a.look[2], b.look[2], p))
    return { pos, look, fov: lerp(a.fov ?? 30, b.fov ?? 30, p), shift: lerp(a.shift ?? TEXT_SHIFT, b.shift ?? TEXT_SHIFT, p) }
  }
}

// ---------------------------------------------------------------- scenes

const sounds: Sound[] = []
const sfx = (name: string, at: number, volume = 0.6) => sounds.push({ src: `../demo-video/public/sfx/${name}.wav`, at, volume })

let updates: Update[] = []

async function init() {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.appendChild(style)
  await document.fonts.ready
  await Promise.all(
    ['400 90px "Fraunces Variable"', 'italic 400 90px "Fraunces Variable"', '400 25px "DM Sans Variable"', '600 44px "Caveat Variable"', '400 18px "JetBrains Mono Variable"']
      .map((f) => document.fonts.load(f)),
  )
  const stage = document.getElementById('stage')!

  const screen = createScreen()
  const screenTexture = new THREE.CanvasTexture(screen.canvas)
  screenTexture.colorSpace = THREE.SRGBColorSpace
  screenTexture.anisotropy = 8
  const canvas = add<HTMLCanvasElement>(stage, '<canvas></canvas>')
  const world = createWorld({ canvas, width: W, height: H, screenTexture })
  const overlay = add(stage, '<div class="layer"></div>')

  // world positions the camera and the overlay follow
  world.scene.updateMatrixWorld(true)
  const screenCenter = world.phone.screen.getWorldPosition(new THREE.Vector3())
  const screenNormal = new THREE.Vector3(0, 0, 1).transformDirection(world.phone.screen.matrixWorld)
  const screenPoint = (x: number, y: number) =>
    world.phone.screen.localToWorld(new THREE.Vector3((x / SCREEN_POINTS.w - 0.5) * PHONE.screenW, (0.5 - y / SCREEN_POINTS.h) * PHONE.screenH, 0))
  /** Camera position `d` in front of `v` along the screen normal, turned around the y axis by `yaw`. */
  const at = (v: THREE.Vector3, d: number, yaw = 0): Vec => {
    const n = screenNormal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    return [v.x + n.x * d, v.y + n.y * d, v.z + n.z * d]
  }
  const look = (v: THREE.Vector3): Vec => [v.x, v.y, v.z]
  const macTop = world.mac.group.localToWorld(new THREE.Vector3(0, 5.6, 0))
  const phoneTop = world.phone.phone.localToWorld(new THREE.Vector3(0, PHONE.h / 2 + 0.8, 0))

  const rig = cameraRig([
    { t: 0, pos: [14, 30, 44], look: [-10, 2, 0], fov: 26 },
    { t: MAC_AT + 0.4, pos: [12, 20, 36], look: [-10, 2.5, 0] },
    { t: PHONE_AT - 0.2, pos: [-2, 15, 37], look: [-9, 3, 0] },
    { t: PHONE_AT + 1.2, pos: [30, 14, 27], look: [8, 8.5, 1], shift: 360 },
    { t: USB_AT - 0.1, pos: [26, 12, 30], look: [8, 8.5, 1], shift: 360 },
    { t: USB_AT + 1.2, pos: [12, 30, 52], look: [0, 3, 4], fov: 30 },
    { t: PAIR_AT - 0.2, pos: [2, 26, 54], look: [0, 3, 4] },
    { t: PAIR_AT + 0.8, pos: at(screenCenter, 34, -0.38), look: look(screenCenter), fov: 26, shift: 330 },
    { t: HOW_AT - 0.3, pos: at(screenCenter, 31, -0.3), look: look(screenCenter), fov: 26, shift: 330 },
    { t: HOW_AT + 0.9, pos: [4, 34, 56], look: [0, 6, 2], fov: 30, shift: 420 },
    { t: CONTROL_AT - 0.2, pos: [-4, 30, 58], look: [0, 6, 2], shift: 420 },
    { t: CONTROL_AT + 0.9, pos: [6, 36, 70], look: [-1, 16, 0], shift: 400 },
    { t: PUSH_AT, pos: [10, 34, 68], look: [-1, 16, 0], shift: 400 },
    { t: DEMO_AT - 0.1, pos: at(screenCenter, 6), look: look(screenCenter), fov: 30, shift: 0 },
    { t: END_AT, pos: [-24, 48, 84], look: [0, 27, 2], fov: 30, shift: 0 },
    { t: DURATION, pos: [-8, 46, 90], look: [0, 28, 2], fov: 30, shift: 0 },
  ])

  // ---- 3D state from t
  const ledOff = new THREE.Color('#6d635b')
  const ledOn = new THREE.Color('#fff4d6')
  const macMaterial = world.mac.led.material
  const update3d: Update = (t) => {
    const cam = rig(t)
    world.camera.position.copy(cam.pos)
    world.camera.lookAt(cam.look)
    world.camera.fov = cam.fov
    world.camera.setViewOffset(W, H, -cam.shift, 0, W, H)
    world.camera.updateProjectionMatrix()

    // Mac drops in and squashes on landing
    const fall = prog(t, MAC_AT + 0.25, 0.5)
    const land = MAC_AT + 0.75
    world.mac.group.visible = t > MAC_AT + 0.25
    world.mac.group.position.y = (1 - fall * fall) * 18
    const squash = t > land ? Math.exp(-(t - land) * 7) * Math.sin((t - land) * 22) : 0
    world.mac.group.scale.set(1 + squash * 0.08, 1 - squash * 0.14, 1 + squash * 0.08)
    macMaterial.color.lerpColors(ledOff, ledOn, prog(t, MAC_AT + 1.0, 0.3))

    // iPhone pops in on its stand with a half turn
    const pop = prog(t, PHONE_AT + 0.35, 0.7)
    world.phone.group.visible = pop > 0
    world.phone.group.scale.setScalar(Math.max(0.001, outBack(pop)))
    world.phone.group.rotation.y = -0.32 - (1 - outCubic(pop)) * 2.4

    world.cable.update({
      p: inOutCubic(prog(t, USB_AT + 0.6, 1.5)),
      macIn: outCubic(prog(t, USB_AT + 0.25, 0.35)),
      phoneIn: outBack(prog(t, USB_AT + 2.1, 0.3)),
      flow: t > USB_BEAT_AT ? (t - USB_BEAT_AT) * 0.45 : 0,
      flowOpacity: shown(t, USB_BEAT_AT + 0.2, CONTROL_AT + 1, 0.4, 0.6),
    })

    if (screen.draw(screenState(t))) screenTexture.needsUpdate = true
    world.render(t)
  }
  sfx('tap', MAC_AT + 0.75, 0.9)
  sfx('result', MAC_AT + 1.0, 0.5)
  sfx('tap', PHONE_AT + 0.6, 0.7)
  sfx('send', USB_AT + 0.6, 0.4)
  sfx('tool', USB_AT + 2.35, 0.9)

  // ---- iOS screen from t
  const PASSCODE = [0, 4, 8, 1, 5, 10]
  const codeAt = (i: number) => PAIR_AT + 0.8 + i * 0.18
  const trustAt = PAIR_AT + 2.1
  const trustTap = trustAt + 0.55
  const btAt = trustTap + 0.4
  const pairAlert = btAt + 0.35
  const pairTap = pairAlert + 0.6
  const connectedAt = pairTap + 0.3
  const tiktok = appCenter(8)
  const mouseArrive = HOW_AT + 1.8
  const typeAt = HOW_AT + 2.3
  const TYPE_STEP = 0.12
  const TYPED = 'tiktok'
  function screenState(t: number): ScreenState {
    if (t < PHONE_AT + 1.0) return { kind: 'off' }
    if (t < PAIR_AT + 0.6) return { kind: 'lock', brightness: Math.round(outCubic(prog(t, PHONE_AT + 1.0, 0.5)) * 20) / 20 }
    if (t < trustAt) {
      const i = PASSCODE.findLastIndex((_, k) => t >= codeAt(k))
      const press = i < 0 ? 0 : Math.round(bump(t, codeAt(i), 0.18) * 10) / 10
      return { kind: 'passcode', filled: i + 1, pressed: i < 0 ? -1 : PASSCODE[i], press }
    }
    if (t < trustTap + 0.25) return { kind: 'trust', press: t > trustTap ? 1 : 0 }
    if (t < btAt) return { kind: 'home' }
    if (t < HOW_AT) {
      const alertIn = Math.round(prog(t, pairAlert, 0.25) * 10) / 10
      const alertOut = Math.round(prog(t, pairTap + 0.2, 0.15) * 10) / 10
      return { kind: 'bluetooth', alert: alertIn * (1 - alertOut), press: t > pairTap ? 1 : 0, connected: t > connectedAt }
    }
    // how it works: the Mac's mouse taps TikTok's icon, then its keyboard types
    const move = inOutCubic(prog(t, HOW_AT + 0.9, mouseArrive - HOW_AT - 0.9))
    const pointer = {
      x: Math.round(lerp(190, tiktok.x, move)),
      y: Math.round(lerp(470, tiktok.y, move)),
      press: Math.round(bump(t, mouseArrive + 0.1, 0.3) * 10) / 10,
      opacity: Math.round(shown(t, HOW_AT + 0.8, typeAt, 0.3, 0.2) * 10) / 10,
    }
    const typed = t > typeAt ? TYPED.slice(0, clamp(Math.floor((t - typeAt - 0.2) / TYPE_STEP), 0, TYPED.length)) : undefined
    return { kind: 'home', pointer, typed }
  }
  PASSCODE.forEach((_, i) => sfx(`key-${(i % 4) + 1}`, codeAt(i), 0.7))
  sfx('tap', trustTap, 0.8)
  sfx('tap', pairTap, 0.8)
  sfx('success', connectedAt, 0.6)
  for (let i = 0; i < TYPED.length; i++) sfx(`key-${(i % 4) + 1}`, typeAt + 0.2 + i * TYPE_STEP, 0.5)

  // ---- tap ripples on the screen, projected from screen points
  const taps = [
    ...PASSCODE.map((k, i) => ({ ...keyCenter(k), at: codeAt(i) })),
    { ...TRUST_BUTTON, at: trustTap },
    { ...PAIR_BUTTON, at: pairTap },
    { ...tiktok, at: mouseArrive + 0.1 },
  ]
  const rippleEls = taps.map(() => add(overlay, '<div class="ripple"><div></div><div></div></div>'))
  const updateRipples: Update = (t) => {
    taps.forEach((tap, i) => {
      const p = prog(t, tap.at, 0.5)
      const el = rippleEls[i]
      setVisible(el, p > 0 && p < 1 ? 1 : 0)
      if (p <= 0 || p >= 1) return
      const s = world.project(screenPoint(tap.x, tap.y))
      el.style.left = `${s.x}px`
      el.style.top = `${s.y}px`
      const [a, b] = [...el.children] as HTMLElement[]
      const r = 16 + 50 * outCubic(p)
      a.style.width = a.style.height = `${r * 2}px`
      a.style.opacity = String(1 - p)
      b.style.width = b.style.height = `${r}px`
      b.style.opacity = String((1 - p) * 0.6)
    })
  }

  updates = [
    update3d,
    updateRipples,
    sceneHook(overlay),
    textBlock(overlay, { kicker: 'Step 01', title: 'A <em>Mac.</em>', body: 'Any Mac. A Mac mini on a shelf|makes a great home for an agent.', tIn: MAC_AT + 0.4, tOut: PHONE_AT }),
    textBlock(overlay, { kicker: 'Step 02', title: 'An <em>iPhone.</em>', body: 'A real one. No jailbreak,|no app to install on it.', tIn: PHONE_AT + 0.4, tOut: USB_AT }),
    textBlock(overlay, { kicker: 'Step 03', title: 'Plug it <em>in.</em>', body: 'One USB cable. Use a data cable:|some cables only charge.', tIn: USB_AT + 0.4, tOut: PAIR_AT }),
    textBlock(overlay, {
      kicker: 'Step 04',
      title: 'Unlock, trust,|<em>pair.</em>',
      checks: [
        { label: 'Unlock with your passcode', at: codeAt(5) + 0.2 },
        { label: 'Tap Trust on the iPhone', at: trustTap + 0.2 },
        { label: 'Pair the Mac in Bluetooth', at: connectedAt },
      ],
      tIn: PAIR_AT + 0.4,
      tOut: HOW_AT + 0.1,
    }),
    textBlock(overlay, { kicker: 'How it works', title: 'The Mac becomes|its <em>hands.</em>', body: 'Over Bluetooth, the Mac is the|iPhone’s mouse and keyboard.', tIn: HOW_AT + 0.4, tOut: USB_BEAT_AT }),
    textBlock(overlay, { kicker: 'How it works', title: 'The cable gives|it <em>eyes.</em>', body: 'Over USB, the agent sees|the screen, frame by frame.', tIn: USB_BEAT_AT + 0.1, tOut: CONTROL_AT }),
    textBlock(overlay, { kicker: 'Step 05', title: 'Your agent|takes <em>over.</em>', body: 'Drive the iPhone from the CLI,|over MCP, or with the HTTP API.', tIn: CONTROL_AT + 0.3, tOut: PUSH_AT + 0.2 }),
    sceneHow(overlay, world, { macTop, phoneTop, mouseArrive, typeAt }),
    sceneControl(overlay, world, macTop),
    nav(overlay, [
      ['A Mac', MAC_AT],
      ['An iPhone', PHONE_AT],
      ['USB', USB_AT],
      ['Unlock & pair', PAIR_AT],
      ['How it works', HOW_AT],
      ['Control', CONTROL_AT],
    ]),
    sceneDemo(stage, world, screenCenter),
    sceneEnd(stage),
  ]
  sfx('send', HOW_AT + 1.2, 0.35)
  sfx('send', USB_BEAT_AT + 0.1, 0.35)
  sfx('send', PUSH_AT + 0.3, 0.5)
  sounds.push({ src: DEMO_CLIP.src, at: DEMO_AT, from: DEMO_CLIP.start, duration: DEMO_CLIP.duration, tempo: DEMO_SPEED, volume: 0.9 })
  sfx('success', END_AT + 0.9, 0.5)
  await seek(0)
}

/** Centered title before the first step. */
function sceneHook(parent: HTMLElement): Update {
  const el = add(parent, `
    <div style="position:absolute; left:0; right:0; top:330px; text-align:center">
      <div class="tile" style="display:inline-block">${ghostTile(84)}</div>
      <div class="serif" style="font-size:132px; line-height:1; margin-top:34px; font-weight:400">${lines('Give your agent <em>a phone.</em>')}</div>
      <div class="hand" style="font-size:46px; margin-top:26px; color:${MUTED}">${lines('a real iPhone, in five steps')}</div>
    </div>`)
  const tile = el.querySelector<HTMLElement>('.tile')!
  return (t) => {
    revealLines(el, t, 0.3, MAC_AT + 0.2, 0.15)
    const p = outBack(prog(t, 0.1, 0.6))
    tile.style.transform = `scale(${p}) rotate(${(1 - p) * -12}deg)`
  }
}

function sceneHow(parent: HTMLElement, world: ReturnType<typeof createWorld>, o: { macTop: THREE.Vector3; phoneTop: THREE.Vector3; mouseArrive: number; typeAt: number }): Update {
  const svg = svgEl(parent, 'svg', { width: W, height: H, style: 'position:absolute; inset:0; overflow:visible' }) as SVGSVGElement
  const arc = svgEl(svg, 'path', { fill: 'none', stroke: ACCENT_LIGHT, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-dasharray': '2 14' })
  const arrows = [0, 1].map(() => svgEl(svg, 'path', { fill: 'none', stroke: TEXT, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }))
  const mouse = add(parent, `<div class="travel">${ICONS.mouse}</div>`)
  const keyboard = add(parent, `<div class="travel">${ICONS.keyboard}</div>`)
  const thumbs = [0, 1, 2].map(() => add(parent, '<div class="thumb"></div>'))
  const btNote = add(parent, `<div class="note hand"><small>Bluetooth</small>mouse + keyboard</div>`)
  const usbNote = add(parent, `<div class="note hand"><small>USB cable</small>the screen, live</div>`)
  const agent = add(parent, `<div class="badge" style="flex-direction:row-reverse">${ghostTile(64)}<span class="hand" style="font-size:40px">your agent</span></div>`)
  const BT_AT = HOW_AT + 0.6
  const curvePoints = Array.from({ length: 60 }, (_, i) => world.cable.curve.getPointAt(i / 59))

  /** Point on the quadratic arc between Mac and iPhone (screen px), u in 0..1. */
  const arcPoint = (a: { x: number; y: number }, c: { x: number; y: number }, b: { x: number; y: number }, u: number) => ({
    x: (1 - u) ** 2 * a.x + 2 * (1 - u) * u * c.x + u * u * b.x,
    y: (1 - u) ** 2 * a.y + 2 * (1 - u) * u * c.y + u * u * b.y,
  })
  const place = (el: HTMLElement, p: { x: number; y: number }) => {
    el.style.left = `${p.x}px`
    el.style.top = `${p.y}px`
  }

  return (t) => {
    const m = world.project(o.macTop)
    // the arc starts at the agent badge above the Mac
    const a = { x: m.x + 34, y: m.y - 100 }
    const b = world.project(o.phoneTop)
    const c = { x: (a.x + b.x) / 2, y: Math.max(150, Math.min(a.y, b.y) - 180) }
    const arcIn = outCubic(prog(t, BT_AT, 0.9))
    const arcVis = shown(t, BT_AT, CONTROL_AT + 0.3, 0.2, 0.4)
    setVisible(arc, arcVis)
    // draw the arc up to arcIn by sampling it
    const pts = Array.from({ length: 41 }, (_, i) => arcPoint(a, c, b, (i / 40) * arcIn))
    arc.setAttribute('d', `M${pts.map((p) => `${p.x} ${p.y}`).join(' L')}`)
    arc.setAttribute('stroke-dashoffset', String(-t * 30))

    const travel = (el: HTMLElement, start: number, end: number) => {
      const u = inOutCubic(prog(t, start, end - start))
      setVisible(el, shown(t, start - 0.15, end + 0.35, 0.2, 0.3))
      place(el, arcPoint(a, c, b, u))
      el.style.transform = `scale(${1 + 0.15 * bump(t, end, 0.3)})`
    }
    travel(mouse, BT_AT + 0.3, o.mouseArrive)
    travel(keyboard, o.mouseArrive + 0.2, o.typeAt + 0.4)

    const mid = arcPoint(a, c, b, 0.5)
    setVisible(btNote, shown(t, BT_AT + 0.6, CONTROL_AT, 0.4, 0.4))
    place(btNote, { x: mid.x - 120, y: mid.y - 150 })
    arrows[0].setAttribute('d', arrowPath({ x: mid.x - 40, y: mid.y - 62 }, { x: mid.x - 8, y: mid.y - 14 }, 0.3))
    setVisible(arrows[0], shown(t, BT_AT + 0.8, CONTROL_AT, 0.3, 0.4))

    thumbs.forEach((th, i) => {
      const start = USB_BEAT_AT + 0.4 + i * 0.5
      const u = (t - start) / 1.2
      const loop = ((u % 1) + 1) % 1
      const vis = t > start ? shown(t, start, CONTROL_AT, 0.2, 0.4) * Math.min(1, Math.sin(Math.PI * loop) * 3) : 0
      setVisible(th, vis)
      if (vis <= 0) return
      // iPhone end of the cable to the Mac end
      const f = (1 - loop) * (curvePoints.length - 1)
      const p0 = world.project(curvePoints[Math.floor(f)])
      const p1 = world.project(curvePoints[Math.min(curvePoints.length - 1, Math.floor(f) + 1)])
      place(th, { x: lerp(p0.x, p1.x, f % 1), y: lerp(p0.y, p1.y, f % 1) - 40 })
    })
    const cableMid = world.project(curvePoints[34])
    setVisible(usbNote, shown(t, USB_BEAT_AT + 0.5, CONTROL_AT, 0.4, 0.4))
    place(usbNote, { x: cableMid.x - 60, y: cableMid.y + 70 })
    arrows[1].setAttribute('d', arrowPath({ x: cableMid.x - 20, y: cableMid.y + 64 }, { x: cableMid.x, y: cableMid.y + 14 }, -0.3))
    setVisible(arrows[1], shown(t, USB_BEAT_AT + 0.7, CONTROL_AT, 0.3, 0.4))

    const agentIn = outBack(prog(t, HOW_AT + 0.4, 0.5))
    setVisible(agent, shown(t, HOW_AT + 0.4, PUSH_AT + 0.4, 0.2, 0.4))
    place(agent, { x: m.x + 32 - agent.offsetWidth, y: m.y - 132 })
    agent.style.transform = `scale(${agentIn})`
    agent.style.transformOrigin = 'right center'
  }
}

function sceneControl(parent: HTMLElement, world: ReturnType<typeof createWorld>, macTop: THREE.Vector3): Update {
  const CARDS = [
    { tag: 'CLI', note: 'any shell', code: '<b>$</b> ghosthand tap --text TikTok\n<b>$</b> ghosthand type "funny cats"', dx: -330, dy: -360 },
    { tag: 'MCP', note: 'Claude, Cursor, opencode', code: 'claude mcp add --transport http \\\n  ghosthand https://ghosthand.dev/mcp', dx: 50, dy: -480 },
    { tag: 'API', note: 'any language', code: '<b>POST</b> /v1/leases/42/tap\n{ "text": "TikTok" }', dx: 440, dy: -330 },
  ]
  const svg = svgEl(parent, 'svg', { width: W, height: H, style: 'position:absolute; inset:0; overflow:visible' }) as SVGSVGElement
  const links = CARDS.map(() => svgEl(svg, 'path', { fill: 'none', stroke: MUTED, 'stroke-width': 2.5, 'stroke-dasharray': '3 9', 'stroke-linecap': 'round' }))
  const cards = CARDS.map((c) =>
    add(parent, `<div class="card"><div class="tag"><span>${c.tag}</span><span>${c.note}</span></div><pre class="mono">${c.code}</pre></div>`),
  )
  return (t) => {
    const m = world.project(macTop)
    CARDS.forEach((c, i) => {
      const start = CONTROL_AT + 0.6 + i * 0.25
      const p = outBack(prog(t, start, 0.6))
      const vis = shown(t, start, PUSH_AT + 0.5, 0.15, 0.4)
      const el = cards[i]
      setVisible(el, vis)
      const half = el.offsetWidth / 2
      const x = m.x + c.dx * outCubic(prog(t, start, 0.6)) - half
      const y = m.y + c.dy * outCubic(prog(t, start, 0.6)) - 50
      el.style.left = `${x}px`
      el.style.top = `${y}px`
      el.style.transform = `scale(${0.4 + 0.6 * p}) rotate(${(i - 1) * 2.5 * p}deg)`
      setVisible(links[i], vis * 0.8)
      links[i].setAttribute('d', `M${m.x} ${m.y} Q${m.x + c.dx * 0.2} ${m.y + c.dy * 0.7} ${x + half} ${y + el.offsetHeight}`)
    })
  }
}

function nav(parent: HTMLElement, items: Array<[string, number]>): Update {
  const el = add(parent, `<div class="nav">${items.map(([label]) => `<div>${label}<i></i></div>`).join('')}</div>`)
  const rows = [...el.children] as HTMLElement[]
  return (t) => {
    setVisible(el, shown(t, MAC_AT + 0.3, PUSH_AT + 0.3, 0.5, 0.4))
    items.forEach(([, start], i) => {
      const end = items[i + 1]?.[1] ?? PUSH_AT
      const active = t >= start && t < end
      rows[i].style.color = active ? TEXT : t >= end ? PALETTE.dim : MUTED
      const bar = rows[i].querySelector('i')!
      bar.style.width = `${(t >= start ? clamp((t - start) / (end - start)) : 0) * 100}%`
      bar.style.opacity = active ? '1' : '0.35'
    })
  }
}

/** Circle reveal from the iPhone screen into the real demo recording, on the dark background. */
function sceneDemo(parent: HTMLElement, world: ReturnType<typeof createWorld>, screenCenter: THREE.Vector3): Update {
  const el = add(parent, `
    <div id="demo" class="layer">
      <div class="hand" style="position:absolute; left:0; right:0; top:64px; text-align:center; font-size:56px">
        a real run: <span style="color:${ACCENT_LIGHT}">“upload this video to tiktok”</span></div>
      <div class="frame"><img></div>
    </div>`)
  const img = el.querySelector('img')!
  const frame = el.querySelector<HTMLElement>('.frame')!
  const frames = () => window.clipFrames.demo
  const revealAt = DEMO_AT - 0.35
  return (t) => {
    const open = outCubic(prog(t, revealAt, 0.7))
    const close = inOutCubic(prog(t, END_AT, 0.7))
    setVisible(el, open > 0 && close < 1 ? 1 : 0)
    if (open <= 0 || close >= 1) return
    const c = world.project(screenCenter)
    const r = open * 2300 * (1 - close)
    el.style.clipPath = `circle(${r}px at ${close > 0 ? W / 2 : c.x}px ${close > 0 ? H / 2 : c.y}px)`
    frame.style.transform = `scale(${lerp(0.94, 1, outCubic(prog(t, revealAt + 0.2, 0.8)))})`
    const n = clamp(Math.floor((t - DEMO_AT) * CLIP_FPS * DEMO_SPEED), 0, frames() - 1)
    setImage(img, `clips/demo/${String(n + 1).padStart(5, '0')}.jpg`)
  }
}

function sceneEnd(parent: HTMLElement): Update {
  const el = add(parent, `
    <div class="end">
      <div class="tile" style="display:inline-block">${ghostTile(96)}</div>
      <div class="serif" style="font-size:128px; line-height:1; margin-top:24px">${lines('ghosthand')}</div>
      <div class="serif" style="font-size:44px; margin-top:18px; color:${MUTED}">${lines('Give your agent <em>a phone.</em>')}</div>
      <div style="margin-top:44px"><span class="pill mono"><b style="color:${ACCENT_LIGHT}">$</b> npx ghosthand setup</span></div>
      <div style="margin-top:28px; font-size:22px; font-weight:600; letter-spacing:0.3em; color:${TEXT}">GHOSTHAND.DEV</div>
    </div>`)
  const tile = el.querySelector<HTMLElement>('.tile')!
  const pill = el.querySelector<HTMLElement>('.pill')!.parentElement!
  const url = el.lastElementChild as HTMLElement
  return (t) => {
    revealLines(el, t, END_AT + 0.6, DURATION + 1, 0.15)
    const p = outBack(prog(t, END_AT + 0.4, 0.6))
    tile.style.transform = `scale(${p}) rotate(${(1 - p) * -12}deg)`
    const pillIn = outCubic(prog(t, END_AT + 1.2, 0.5))
    pill.style.opacity = String(pillIn)
    pill.style.transform = `translateY(${(1 - pillIn) * 20}px)`
    url.style.opacity = String(outCubic(prog(t, END_AT + 1.5, 0.5)))
  }
}

// ---------------------------------------------------------------- main

export async function seek(t: number) {
  for (const u of updates) u(t)
  await waitDecodes()
}

window.video = { ready: init(), seek, duration: DURATION, sounds }
