// Launch video: "Give your agent a phone". Part 1 shows the agent at work: a prompt typed in
// Claude Code, a camera fly over the plugged-in iPhone, then the real demo. Part 2 is how it works:
// the setup steps in a toon-shaded 3D world (src/launch-3d.ts) with HTML text on top, then the end card.
// Pure function of time like src/video.ts: seek(t) sets the camera, meshes, screen and text from t.
//
//   part 1                                         part 2
//    0.0  Claude Code, the prompt is typed          22.6  quick title card, zooms left to right
//    4.7  terminal falls away, camera flies to the  24.2  01 a Mac  27.3  02 an iPhone  30.5  03 USB
//         plugged-in iPhone (one ease-out move)     33.6  04 unlock, trust, pair
//    8.4  camera dives into the iPhone screen       38.9  how it works: Bluetooth = hands, USB = eyes
//    9.5  real demo clip at 2.2x, full frame        45.7  05 CLI, MCP, API cards
//         (demo-video/out/tiktok-launch.mp4)        49.4  end card on a slow turntable (53.6 s total)
//   Every scene start is on a beat of the music (BEAT below).

import * as THREE from 'three'
import logoSvg from '../../website/public/logo-ink.svg'
import { createWorld, PALETTE, PHONE } from './launch-3d.ts'
import { appCenter, createScreen, keyCenter, PAIR_BUTTON, SCREEN_POINTS, TRUST_BUTTON, type ScreenState } from './launch-screens.ts'
import {
  add, bump, clamp, CLIP_FPS, CLIPS, inCubic, inOutCubic, lerp, outBack, outCubic, outQuart, prog, setImage, setVisible, shown, svgEl,
  waitDecodes, type Sound, type Update,
} from './shared.ts'

const W = 1920
const H = 1080
const { text: TEXT, accent: ACCENT, accentLight: ACCENT_LIGHT, muted: MUTED, surface: SURFACE, border: BORDER } = PALETTE

// Music: assets/launch-music.mp3 is the Udio song "Dried Leaves, Lost Dreams"
// (https://www.udio.com/songs/aZ8xPNm46ZGpbrCYNuesGx) cut from 19.80 s, the first bar of its loud part.
// librosa beat tracking: 114.2 BPM, so the file starts on a downbeat and beat n is at n * BEAT.
const BEAT = 0.5253
const beats = (n: number) => n * BEAT
const nearestBeat = (t: number) => Math.round(t / BEAT) * BEAT

// scene starts and cuts land on beats; every other time is relative to one of these
// part 1: the agent at work. Same prompt as the demo-video composition `tiktok-launch`.
const PROMPT = "upload this video to tiktok using the app (so we don't get shadowbanned)"
const TYPE_AT = beats(1)
const ENTER_AT = beats(7)
/** Typing speed that ends the prompt just before enter. */
const TYPE_CPS = PROMPT.length / (ENTER_AT - TYPE_AT - 0.25)
const FLY_AT = ENTER_AT + beats(2)
const FLY_END = FLY_AT + beats(6)
const FLY_LEN = FLY_END - FLY_AT
const DIVE_AT = FLY_END + beats(1)
const DEMO_AT = DIVE_AT + beats(2)
const DEMO_CLIP = CLIPS.find((c) => c.name === 'demo')!
/** The demo recording plays sped up, so the whole TikTok upload fits. */
const DEMO_SPEED = 2.2
const DEMO_LEN = DEMO_CLIP.duration / DEMO_SPEED
// part 2: how it works. Each step stays on screen only long enough to read its text.
const HOOK_AT = nearestBeat(DEMO_AT + DEMO_LEN - 0.4)
const MAC_AT = HOOK_AT + beats(3)
const PHONE_AT = MAC_AT + beats(6)
const USB_AT = PHONE_AT + beats(6)
const PAIR_AT = USB_AT + beats(6)
const HOW_AT = PAIR_AT + beats(10)
const USB_BEAT_AT = HOW_AT + beats(7)
const CONTROL_AT = USB_BEAT_AT + beats(6)
const END_AT = CONTROL_AT + beats(7)
const DURATION = END_AT + beats(8)
/** How much of the USB cable is drawn at t. */
const cableP = (t: number) => inOutCubic(prog(t, USB_AT + 0.6, 1.5))

/** Left column x and the screen shift that keeps the 3D objects right of the text. */
const TEXT_X = 150
const TEXT_SHIFT = 300

/** Claude Code window of the intro, centered, and its colors (same as demo-video/src/terminal.tsx). */
const TERM = { w: 1240, h: 580, x: (W - 1240) / 2, y: (H - 580) / 2 }
const CC = { window: '#1b1a19', chrome: '#252321', border: 'rgba(255, 255, 255, 0.09)', text: '#ece9e4', dim: '#8f8a83', faint: '#5c5853', claude: '#d97757', green: '#5fc27a' }

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
#demo { background: ${PALETTE.bg} }
#demo .frame { position: absolute; inset: 0; overflow: hidden }
#demo img { width: 100%; height: 100%; display: block }
.end { position: absolute; left: 0; right: 0; top: 120px; text-align: center }
.pill { display: inline-flex; align-items: center; gap: 14px; padding: 16px 30px; border-radius: 999px; border: 1.5px solid ${BORDER};
  background: ${SURFACE}; font-size: 28px; box-shadow: 5px 5px 0 ${ACCENT} }
.term-wrap { position: absolute; inset: 0; perspective: 2200px; perspective-origin: 50% 50% }
.term-cam { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0 }
.term { position: absolute; left: ${TERM.x}px; top: ${TERM.y}px; width: ${TERM.w}px; height: ${TERM.h}px; border-radius: 18px; overflow: hidden;
  background: ${CC.window}; border: 1px solid ${CC.border}; color: ${CC.text}; font-size: 22px; line-height: 34px;
  box-shadow: 0 50px 140px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 0, 0, 0.5), 0 0 160px rgba(79, 70, 229, 0.18) }
.term-bar { height: 54px; background: ${CC.chrome}; border-bottom: 1px solid ${CC.border}; display: flex; align-items: center; gap: 10px;
  padding-left: 22px; position: relative }
.term-bar i { width: 16px; height: 16px; border-radius: 50% }
.term-bar span { position: absolute; inset: 0; display: grid; place-items: center; font-size: 17px; font-weight: 600; color: ${CC.dim} }
.term-body { padding: 28px 36px }
.welcome, .grow, .input { white-space: pre }
.welcome { display: inline-block; border: 1.5px solid ${CC.claude}; border-radius: 10px; padding: 12px 26px 12px 20px }
.cc { color: ${CC.claude} }
.dim { color: ${CC.dim} }
.faint { color: ${CC.faint} }
.grow { overflow: hidden }
.user-row { background: rgba(255, 255, 255, 0.06); color: ${CC.dim}; padding-left: 13px }
.input { border: 1px solid ${CC.faint}; border-radius: 10px; padding: 10px 13px }
.caret { display: inline-block; width: 13.2px; height: 28px; vertical-align: -6px; background: ${CC.text} }
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
/**
 * Camera key in orbit form: the camera sits `r` away from `target`, at azimuth `az` (radians around y,
 * 0 = in front, +z) and elevation `el`. Azimuth is not wrapped, so going from 0 to 2π flies a full circle.
 */
type Shot = { t: number; target: Vec; r: number; az: number; el: number; fov?: number; shift?: number }

/**
 * Monotone cubic spline (Fritsch–Carlson) through keys at times `ts`: the camera never stops at a key
 * and never overshoots between two keys, so a held shot stays held.
 */
function spline(ts: number[], ys: number[]) {
  const n = ts.length
  const d = ts.slice(0, -1).map((t, i) => (ys[i + 1] - ys[i]) / (ts[i + 1] - t))
  const m = ts.map((_, i) => {
    if (i === 0) return d[0]
    if (i === n - 1) return d[n - 2]
    if (d[i - 1] * d[i] <= 0) return 0
    return Math.sign(d[i]) * Math.min((Math.abs(d[i - 1]) + Math.abs(d[i])) / 2, 3 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i])))
  })
  return (t: number) => {
    if (t <= ts[0]) return ys[0]
    if (t >= ts[n - 1]) return ys[n - 1]
    const i = ts.findIndex((k) => k > t) - 1
    const h = ts[i + 1] - ts[i]
    const u = (t - ts[i]) / h
    const u2 = u * u
    const u3 = u2 * u
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * m[i + 1]
  }
}

function cameraRig(shots: Shot[]) {
  const ts = shots.map((s) => s.t)
  const channel = (get: (s: Shot) => number) => spline(ts, shots.map(get))
  const tx = channel((s) => s.target[0])
  const ty = channel((s) => s.target[1])
  const tz = channel((s) => s.target[2])
  const r = channel((s) => s.r)
  const az = channel((s) => s.az)
  const el = channel((s) => s.el)
  const fov = channel((s) => s.fov ?? 30)
  const shift = channel((s) => s.shift ?? TEXT_SHIFT)
  const pos = new THREE.Vector3()
  const look = new THREE.Vector3()
  /** `k` is the time on the key axis (an eased 0..1 for the intro fly), `t` the video time for the drift. */
  return (k: number, t = k) => {
    // slow hand-held drift so no shot is ever frozen
    const a = az(k) + 0.025 * Math.sin(t * 0.7) + 0.01 * Math.sin(t * 1.9 + 1)
    const e = el(k) + 0.015 * Math.sin(t * 0.9 + 2)
    const d = r(k)
    look.set(tx(k), ty(k), tz(k))
    pos.set(look.x + d * Math.sin(a) * Math.cos(e), look.y + d * Math.sin(e), look.z + d * Math.cos(a) * Math.cos(e))
    return { pos, look, fov: fov(k), shift: shift(k) }
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
  // dark scrim behind the text column while the camera flies close and objects pass behind the text
  const scrim = add(stage, `<div class="layer" style="background: linear-gradient(90deg, ${PALETTE.bg} 0%, ${PALETTE.bg}e6 30%, ${PALETTE.bg}00 52%)"></div>`)
  const overlay = add(stage, '<div class="layer"></div>')

  // world positions the camera and the overlay follow
  world.scene.updateMatrixWorld(true)
  const screenCenter = world.phone.screen.getWorldPosition(new THREE.Vector3())
  const screenNormal = new THREE.Vector3(0, 0, 1).transformDirection(world.phone.screen.matrixWorld)
  const screenPoint = (x: number, y: number) =>
    world.phone.screen.localToWorld(new THREE.Vector3((x / SCREEN_POINTS.w - 0.5) * PHONE.screenW, (0.5 - y / SCREEN_POINTS.h) * PHONE.screenH, 0))
  const vec = (v: THREE.Vector3): Vec => [v.x, v.y, v.z]
  // the screen's facing direction as orbit angles
  const SCREEN_AZ = Math.atan2(screenNormal.x, screenNormal.z)
  const SCREEN_EL = Math.asin(screenNormal.y)
  const macTop = world.mac.group.localToWorld(new THREE.Vector3(0, 5.6, 0))
  const phoneTop = world.phone.phone.localToWorld(new THREE.Vector3(0, PHONE.h / 2 + 0.8, 0))
  const MAC: Vec = [-10, 2.5, 0]
  const PHONE_MID: Vec = [8, 8.5, 1]
  const SETUP: Vec = [0, 6, 2]
  // the camera rides along with the growing cable end
  const cableAt = (t: number) => vec(world.cable.curve.getPointAt(cableP(t)))

  // part 1: one ease-out fly from high behind the Mac, along the cable, to the front of the iPhone.
  // Keys are on an eased 0..1 axis, so the whole move decelerates into the last shot.
  const flyEnd: Shot = { t: 1, target: [screenCenter.x, screenCenter.y - 1.5, screenCenter.z], r: 36, az: SCREEN_AZ - 0.42, el: 0.12, fov: 28, shift: 330 }
  const introRig = cameraRig([
    { t: 0, target: SETUP, r: 125, az: -2.6, el: 0.95, fov: 26, shift: 0 },
    { t: 0.45, target: [-3, 4, 4], r: 50, az: -1.3, el: 0.3, fov: 28, shift: 160 },
    flyEnd,
  ])
  const hookStart: Omit<Shot, 't'> = { target: MAC, r: 80, az: -2.2, el: 1.05, fov: 26, shift: TEXT_SHIFT }
  const diveEnd: Omit<Shot, 't'> = { target: vec(screenCenter), r: 6, az: SCREEN_AZ, el: SCREEN_EL, fov: 30, shift: 0 }

  const rig = cameraRig([
    // part 1: hold the fly's last shot, then dive into the screen
    { ...flyEnd, t: FLY_END },
    { ...flyEnd, t: DIVE_AT },
    { ...diveEnd, t: DEMO_AT - 0.1 },
    { ...diveEnd, t: DEMO_AT + 0.5 },
    // hidden behind the demo: jump to the hook, a spiral down from high above onto the empty floor
    { ...hookStart, t: DEMO_AT + 0.9 },
    { ...hookStart, t: HOOK_AT },
    { t: MAC_AT, target: MAC, r: 52, az: -0.9, el: 0.5, fov: 28 },
    // 01: orbit the Mac as it drops in spinning
    { t: MAC_AT + 1.4, target: MAC, r: 42, az: 0.1, el: 0.36 },
    { t: PHONE_AT - 0.3, target: MAC, r: 40, az: 0.6, el: 0.3 },
    // 02: fly across to the iPhone and swing around it
    { t: PHONE_AT + 0.9, target: PHONE_MID, r: 44, az: 1.1, el: 0.2, shift: 360 },
    { t: USB_AT - 0.1, target: PHONE_MID, r: 40, az: 0.7, el: 0.24, shift: 360 },
    // 03: chase the cable from the Mac's port to the iPhone
    { t: USB_AT + 0.6, target: cableAt(USB_AT + 0.6), r: 40, az: 1.0, el: 0.5, shift: 380 },
    { t: USB_AT + 1.35, target: cableAt(USB_AT + 1.35), r: 38, az: 1.2, el: 0.46, shift: 380 },
    { t: USB_AT + 2.1, target: vec(world.cable.phonePort), r: 32, az: 1.3, el: 0.36, shift: 360 },
    // 04: tilt up from the port to the screen, then a slow push in
    { t: PAIR_AT + 0.8, target: vec(screenCenter), r: 34, az: SCREEN_AZ - 0.45, el: SCREEN_EL + 0.05, fov: 26, shift: 330 },
    { t: HOW_AT - 0.3, target: vec(screenCenter), r: 30, az: SCREEN_AZ - 0.2, el: SCREEN_EL + 0.02, fov: 26, shift: 330 },
    // how it works: wide, slowly circling the whole setup
    { t: HOW_AT + 1.0, target: SETUP, r: 60, az: -0.35, el: 0.48, fov: 30, shift: 420 },
    { t: CONTROL_AT - 0.2, target: SETUP, r: 58, az: 0.3, el: 0.42, shift: 420 },
    // 05: crane up for the cards
    { t: CONTROL_AT + 0.9, target: [-1, 16, 0], r: 72, az: 0.2, el: 0.28, shift: 400 },
    { t: END_AT, target: [-1, 16, 0], r: 70, az: 0.35, el: 0.3, shift: 400 },
    // crane up over the setup; the end card sits above it on a slow turntable
    { t: END_AT + 1.3, target: [0, 19, 2], r: 108, az: 1.0, el: 0.24, shift: 0 },
    { t: DURATION, target: [0, 20, 2], r: 112, az: 2.2, el: 0.22, shift: 0 },
  ])
  const camera = (t: number) => (t < FLY_END ? introRig(outQuart(prog(t, FLY_AT, FLY_LEN)), t) : rig(t))

  // ---- 3D state from t
  const ledOff = new THREE.Color('#6d635b')
  const ledOn = new THREE.Color('#fff4d6')
  const macMaterial = world.mac.led.material
  const update3d: Update = (t) => {
    const cam = camera(t)
    world.camera.position.copy(cam.pos)
    world.camera.lookAt(cam.look)
    world.camera.fov = cam.fov
    world.camera.setViewOffset(W, H, -cam.shift, 0, W, H)
    world.camera.updateProjectionMatrix()

    // part 1 shows the finished setup (as it is when "how it works" starts); part 2 builds it step by step
    const s = t < HOOK_AT ? HOW_AT : t

    // Mac drops in and squashes on landing
    const fall = prog(s, MAC_AT + 0.25, 0.5)
    const land = MAC_AT + 0.75
    world.mac.group.visible = s > MAC_AT + 0.25
    world.mac.group.position.y = (1 - fall * fall) * 18
    const squash = s > land ? Math.exp(-(s - land) * 7) * Math.sin((s - land) * 22) : 0
    world.mac.group.scale.set(1 + squash * 0.08, 1 - squash * 0.14, 1 + squash * 0.08)
    world.mac.group.rotation.y = -(1 - outCubic(prog(s, MAC_AT + 0.25, 1.1))) * Math.PI * 2
    macMaterial.color.lerpColors(ledOff, ledOn, prog(s, MAC_AT + 1.0, 0.3))

    // iPhone pops in on its stand with a half turn
    const pop = prog(s, PHONE_AT + 0.35, 0.7)
    world.phone.group.visible = pop > 0
    world.phone.group.scale.setScalar(Math.max(0.001, outBack(pop)))
    world.phone.group.rotation.y = -0.32 - (1 - outCubic(prog(s, PHONE_AT + 0.35, 1.1))) * Math.PI * 2

    world.cable.update({
      p: cableP(s),
      macIn: outCubic(prog(s, USB_AT + 0.25, 0.35)),
      phoneIn: outBack(prog(s, USB_AT + 2.1, 0.3)),
      flow: s > USB_BEAT_AT ? (s - USB_BEAT_AT) * 0.45 : 0,
      flowOpacity: shown(s, USB_BEAT_AT + 0.2, CONTROL_AT + 1, 0.4, 0.6),
    })

    if (screen.draw(screenState(s))) screenTexture.needsUpdate = true
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
    (t) => setVisible(scrim, Math.max(shown(t, FLY_AT + 1.2, DIVE_AT + 0.4, 0.6, 0.5), shown(t, USB_AT, HOW_AT + 0.9, 0.5, 0.8))),
    textBlock(overlay, { kicker: 'Meet ghosthand', title: 'Your agent, on a|<em>real iPhone.</em>', body: 'Plugged into your Mac.|It taps, types and swipes like you.', tIn: FLY_AT + 1.3, tOut: DIVE_AT + 0.25 }),
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
    textBlock(overlay, { kicker: 'Step 05', title: 'Your agent|takes <em>over.</em>', body: 'Drive the iPhone from the CLI,|over MCP, or with the HTTP API.', tIn: CONTROL_AT + 0.3, tOut: END_AT + 0.2 }),
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
    sceneTerminal(stage, canvas),
  ]
  sfx('send', FLY_AT, 0.5)
  sfx('send', DIVE_AT + 0.3, 0.5)
  sfx('send', HOW_AT + 1.2, 0.35)
  sfx('send', USB_BEAT_AT + 0.1, 0.35)
  sounds.push({ src: DEMO_CLIP.src, at: DEMO_AT, from: DEMO_CLIP.start, duration: DEMO_CLIP.duration, tempo: DEMO_SPEED, volume: 0.9 })
  sfx('success', END_AT + 0.9, 0.5)
  sounds.push({ src: 'assets/launch-music.mp3', at: 0, duration: DURATION, volume: 0.55, fadeOut: beats(6) })
  await seek(0)
}

/**
 * Part 1 opener: Claude Code in a macOS terminal. The camera pushes in on the input box while the
 * prompt is typed, the agent takes the iPhone, then the window falls away and the blurred 3D world
 * behind it comes into focus.
 */
function sceneTerminal(parent: HTMLElement, canvas: HTMLCanvasElement): Update {
  const SPINNER = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
  const gap = '<div style="height:16px"></div>'
  const wrap = add(parent, `
    <div class="term-wrap"><div class="term-cam"><div class="term mono">
      <div class="term-bar"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i><span style="font-family:'DM Sans Variable'">claude — ~/ghosthand</span></div>
      <div class="term-body">
        <div class="welcome"><span class="cc">✻</span> Welcome to <b>Claude Code</b>!${'\n\n'}<span class="dim">  /help for help, /status for your current setup${'\n\n'}  cwd: /Users/tommy/ghosthand</span></div>
        <div class="grow">${gap}<div class="user-row">&gt; ${PROMPT}</div></div>
        <div class="grow">${gap}<div><span class="dot">⏺</span> <b>Bash</b>(ghosthand acquire --reason "upload to tiktok")</div></div>
        <div class="grow"><div class="dim">  ⎿  studio:42 · iPhone SE · leased</div></div>
        <div class="grow">${gap}<div class="cc"><span class="glyph"></span> Thinking… <span class="dim">(esc to interrupt)</span></div></div>
        <div style="height:22px"></div>
        <div class="input"><span class="dim">&gt; </span><span class="typed"></span><span class="caret"></span></div>
        <div class="faint" style="font-size:18px; padding:4px 14px">? for shortcuts</div>
      </div>
    </div></div></div>`)
  const cam = wrap.querySelector<HTMLElement>('.term-cam')!
  const input = wrap.querySelector<HTMLElement>('.input')!
  const typed = wrap.querySelector<HTMLElement>('.typed')!
  const caret = wrap.querySelector<HTMLElement>('.caret')!
  const dot = wrap.querySelector<HTMLElement>('.dot')!
  const glyph = wrap.querySelector<HTMLElement>('.glyph')!
  const rows = [...wrap.querySelectorAll<HTMLElement>('.grow')]
  const rowH = rows.map((r) => r.offsetHeight)
  // user message, tool call, tool result, spinner (below the others while the agent works)
  const rowAt = [ENTER_AT + 0.05, ENTER_AT + 0.45, ENTER_AT + 0.8, ENTER_AT + 0.15]
  const TOOL_DONE = ENTER_AT + 0.8

  for (let i = 0; i < PROMPT.length; i++) {
    if (PROMPT[i] === ' ' && i % 2 === 0) continue
    sfx(`key-${((i * 3) % 4) + 1}`, TYPE_AT + (i + 0.5) / TYPE_CPS, 0.45)
  }
  sfx('key-1', ENTER_AT, 0.9)
  sfx('send', ENTER_AT + 0.05, 0.6)
  sfx('tool', ENTER_AT + 0.45, 0.5)
  sfx('result', TOOL_DONE, 0.4)

  return (t) => {
    rows.forEach((row, i) => {
      const g = outCubic(prog(t, rowAt[i], 0.3))
      row.style.height = `${rowH[i] * g}px`
      row.style.opacity = String(Math.min(1, g * 1.4))
    })
    const typing = t > TYPE_AT && t < ENTER_AT
    typed.textContent = t < ENTER_AT ? PROMPT.slice(0, clamp(Math.floor((t - TYPE_AT) * TYPE_CPS), 0, PROMPT.length)) : ''
    caret.style.opacity = typing || Math.floor(t * 2) % 2 === 0 ? '1' : '0'
    const running = t < TOOL_DONE
    dot.style.color = running ? CC.dim : CC.green
    dot.style.opacity = String(running ? 0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * 2.2)) : 1)
    glyph.textContent = SPINNER[Math.floor(t * 9) % SPINNER.length]

    // camera: a tilted wide shot pushes in on the input box and follows it down as rows appear
    const inputY = TERM.y + input.offsetTop + input.offsetHeight / 2
    const z = lerp(0.94, 1.42, outCubic(prog(t, 0, ENTER_AT + 0.8)))
    const fy = lerp(H / 2, inputY, outCubic(prog(t, 0.1, ENTER_AT)))
    const tilt = 1 - outCubic(prog(t, 0, 2.8))
    // then the window falls back and away as the camera leaves for the 3D world
    const away = inCubic(prog(t, FLY_AT - 0.25, 0.75))
    cam.style.transform = `translate(${W / 2}px, ${H / 2}px) translateZ(${-away * 1800}px) rotateX(${tilt * 12 + away * 34}deg) ` +
      `rotateY(${tilt * -16}deg) scale(${z}) translate(${-W / 2}px, ${-fy}px)`
    setVisible(wrap, (1 - prog(t, FLY_AT - 0.25, 0.55)) * outCubic(prog(t, 0, 0.4)))
    // the 3D world behind the window comes into focus
    const focus = outCubic(prog(t, FLY_AT - 0.25, 1.1))
    canvas.style.filter = focus >= 1 ? '' : `blur(${(1 - focus) * 16}px) brightness(${0.45 + 0.55 * focus})`
  }
}

/** Quick title card of part 2: the text zooms in while it drifts from left to right (ease-out). */
function sceneHook(parent: HTMLElement): Update {
  const zoom = add(parent, '<div style="position:absolute; left:0; right:0; top:360px; text-align:center"></div>')
  const el = add(zoom, `
    <div>
      <div class="kicker" style="justify-content:center"><span class="line"><span>How it works</span></span></div>
      <div class="serif" style="font-size:112px; line-height:1; margin-top:26px; font-weight:400">${lines('Give your agent <em>a phone.</em>')}</div>
      <div class="hand" style="font-size:44px; margin-top:22px; color:${MUTED}">${lines('connect your iPhone, let your agent control it')}</div>
    </div>`)
  return (t) => {
    revealLines(el, t, HOOK_AT + 0.15, MAC_AT + 0.15, 0.05)
    const p = outCubic(prog(t, HOOK_AT + 0.1, MAC_AT - HOOK_AT + 0.1))
    zoom.style.transform = `translateX(${lerp(-140, 70, p)}px) scale(${lerp(0.9, 1.06, p)})`
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
    setVisible(agent, shown(t, HOW_AT + 0.4, END_AT + 0.4, 0.2, 0.4))
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
      const vis = shown(t, start, END_AT + 0.5, 0.15, 0.4)
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
    setVisible(el, shown(t, MAC_AT + 0.3, END_AT + 0.3, 0.5, 0.4))
    items.forEach(([, start], i) => {
      const end = items[i + 1]?.[1] ?? END_AT
      const active = t >= start && t < end
      rows[i].style.color = active ? TEXT : t >= end ? PALETTE.dim : MUTED
      const bar = rows[i].querySelector('i')!
      bar.style.width = `${(t >= start ? clamp((t - start) / (end - start)) : 0) * 100}%`
      bar.style.opacity = active ? '1' : '0.35'
    })
  }
}

/** Circle reveal from the iPhone screen into the real demo recording, full frame. */
function sceneDemo(parent: HTMLElement, world: ReturnType<typeof createWorld>, screenCenter: THREE.Vector3): Update {
  const el = add(parent, `
    <div id="demo" class="layer">
      <div class="frame"><img></div>
    </div>`)
  const img = el.querySelector('img')!
  const frame = el.querySelector<HTMLElement>('.frame')!
  const frames = () => window.clipFrames.demo
  const revealAt = DEMO_AT - 0.35
  return (t) => {
    const open = outCubic(prog(t, revealAt, 0.7))
    const close = inOutCubic(prog(t, HOOK_AT, 0.5))
    setVisible(el, open > 0 && close < 1 ? 1 : 0)
    if (open <= 0 || close >= 1) return
    const c = world.project(screenCenter)
    const r = open * 2300 * (1 - close)
    el.style.clipPath = `circle(${r}px at ${close > 0 ? W / 2 : c.x}px ${close > 0 ? H / 2 : c.y}px)`
    frame.style.transform = `scale(${lerp(1.08, 1, outCubic(prog(t, revealAt, 1.2)))})`
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
