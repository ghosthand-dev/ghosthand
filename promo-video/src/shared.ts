// Shared by every video entry (src/video.ts, src/launch.ts) and scripts/render.ts: clips, sounds,
// the window.video contract, easing math and DOM helpers. Every video is a pure function of time.

// ---------------------------------------------------------------- clips and sounds

// Videos shown as image sequences. scripts/render.ts extracts each to out/clips/<name>/00001.jpg...
// once (delete the folder to extract again) and passes the frame counts to the page as window.clipFrames.
export const CLIP_FPS = 30

export const CLIPS = [
  // iPhone screen recordings in the promo's phone mockup
  { name: 'upload', src: '../demo-video/public/tiktok/phone.mp4', width: 420 },
  { name: 'warmup', src: '../demo-video/public/tiktok-warmup/phone.mp4', width: 420 },
  // full agent demo for the launch video, from the split view to before its end card;
  // render it first in demo-video/: pnpm exec remotion render src/root.tsx tiktok-launch out/tiktok-launch.mp4
  { name: 'demo', src: '../demo-video/out/tiktok-launch.mp4', width: 1920, start: 7.8, duration: 30.2 },
] as const

export type ClipName = (typeof CLIPS)[number]['name']

/**
 * One audio file mixed into the render at `at` seconds. `src` is relative to promo-video/. `tempo` speeds it up.
 * `fadeOut` fades the last seconds of `duration`.
 */
export type Sound = { src: string; at: number; from?: number; duration?: number; volume?: number; tempo?: number; fadeOut?: number }

declare global {
  interface Window {
    video: { ready: Promise<void>; seek: (t: number) => Promise<void>; duration: number; sounds?: Sound[] }
    /** Frame count per clip, set by scripts/render.ts. */
    clipFrames: Record<ClipName, number>
  }
}

// ---------------------------------------------------------------- math

export const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x))
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p
export const prog = (t: number, start: number, dur: number) => clamp((t - start) / dur)
export const outCubic = (p: number) => 1 - (1 - p) ** 3
export const outQuart = (p: number) => 1 - (1 - p) ** 4
export const inCubic = (p: number) => p ** 3
export const inOutCubic = (p: number) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2)
export const outBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2
/** Opacity of something shown from tIn to tOut. */
export const shown = (t: number, tIn: number, tOut: number, fadeIn = 0.3, fadeOut = 0.25) =>
  Math.min(prog(t, tIn, fadeIn), 1 - prog(t, tOut - fadeOut, fadeOut))
/** 0 -> 1 -> 0 hump that lasts `dur` seconds after `at`. */
export const bump = (t: number, at: number, dur: number) => {
  const x = (t - at) / dur
  return x > 0 && x < 1 ? Math.sin(Math.PI * x) : 0
}

export function random(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let x = Math.imul(a ^ (a >>> 15), a | 1)
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------- dom

export type Update = (t: number) => void

export function add<T extends Element = HTMLElement>(parent: Element, html: string): T {
  const tpl = document.createElement('template')
  tpl.innerHTML = html.trim()
  const el = tpl.content.firstElementChild as T
  parent.appendChild(el)
  return el
}

export function svgEl(parent: Element, tag: string, attrs: Record<string, string | number> = {}) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v))
  parent.appendChild(el)
  return el
}

export function setVisible(el: HTMLElement | SVGElement, opacity: number) {
  el.style.display = opacity <= 0.001 ? 'none' : ''
  el.style.opacity = String(opacity)
}

/** Image decodes started since the last waitDecodes(); seek() waits for them. */
let pendingDecodes: Array<Promise<void>> = []

export function setImage(img: HTMLImageElement, src: string) {
  if (img.getAttribute('src') === src) return
  img.setAttribute('src', src)
  pendingDecodes.push(img.decode().catch(() => {}))
}

export async function waitDecodes() {
  const decodes = pendingDecodes
  pendingDecodes = []
  await Promise.all(decodes)
}
