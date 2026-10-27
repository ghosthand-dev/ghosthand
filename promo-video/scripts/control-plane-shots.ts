// Launch screenshots of the control plane: each mock scene over a wallpaper, like a real macOS window.
// `dashboard --mock --snapshot` renders the window with a transparent backdrop (an offscreen render
// cannot draw the blur behind the window); headless Chrome adds the blurred wallpaper and the shadow.
//
//   pnpm tsx scripts/control-plane-shots.ts                       # ghosthand from PATH
//   pnpm tsx scripts/control-plane-shots.ts --ghosthand ../.build/Ghosthand.app/Contents/MacOS/ghosthand
//
// Writes out/control-plane-<scene>.png and website/public/assets/control-plane-<scene>.jpg.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const { values: args } = parseArgs({
  options: {
    ghosthand: { type: 'string', default: 'ghosthand' },
    scenes: { type: 'string', default: 'fleet,chat' },
  },
})

/** Window width in CSS pixels; the snapshot is 2x, so 1200 keeps it at its real size. */
const WINDOW_W = 1200
/** Wallpaper around the window. The output is rendered at 2x. */
const PADDING = 72
const WALLPAPER = path.join(root, 'assets/wallpaper-sky.jpg')
const JPEG_QUALITY = 90

function html(window: string, size: { w: number; h: number }) {
  const h = Math.round((WINDOW_W / size.w) * size.h)
  const canvas = { w: WINDOW_W + 2 * PADDING, h: h + 2 * PADDING }
  const wallpaper = `data:image/jpeg;base64,${fs.readFileSync(WALLPAPER).toString('base64')}`
  const markup = `<!doctype html><html><head><style>
    html, body { margin: 0; width: ${canvas.w}px; height: ${canvas.h}px; overflow: hidden }
    body { background: url(${wallpaper}) center / cover }
    .win { position: absolute; left: ${PADDING}px; top: ${PADDING}px; width: ${WINDOW_W}px; height: ${h}px;
      border-radius: 12px; overflow: hidden;
      /* NSVisualEffectView .hudWindow, dark: a heavy blur of what is behind, darkened */
      backdrop-filter: blur(60px) saturate(1.5); background: rgba(22, 22, 26, 0.62);
      box-shadow: 0 40px 100px rgba(0, 20, 60, 0.45), 0 12px 30px rgba(0, 0, 0, 0.3), 0 0 0 0.5px rgba(0, 0, 0, 0.7) }
    .win img { position: absolute; inset: 0; width: 100%; height: 100% }
    .win::after { content: ''; position: absolute; inset: 0; border-radius: 12px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14); pointer-events: none }
  </style></head><body><div class="win"><img src="data:image/png;base64,${window}"></div></body></html>`
  return { html: markup, canvas }
}

function pngSize(file: string) {
  const buf = fs.readFileSync(file)
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ deviceScaleFactor: 2 })
fs.mkdirSync(path.join(root, 'out'), { recursive: true })
for (const scene of args.scenes.split(',')) {
  const raw = path.join(root, `out/control-plane-${scene}-raw.png`)
  console.log(`rendering mock ${scene}`)
  execFileSync(args.ghosthand, ['dashboard', '--foreground', '--background', '--mock', scene, '--snapshot', raw], { stdio: 'inherit' })
  const shot = html(fs.readFileSync(raw).toString('base64'), pngSize(raw))
  await page.setViewportSize({ width: shot.canvas.w, height: shot.canvas.h })
  await page.setContent(shot.html)
  await page.waitForLoadState('load')
  const png = path.join(root, `out/control-plane-${scene}.png`)
  const jpg = path.join(root, `../website/public/assets/control-plane-${scene}.jpg`)
  await page.screenshot({ path: png })
  await page.screenshot({ path: jpg, type: 'jpeg', quality: JPEG_QUALITY })
  console.log(`wrote ${png} and ${jpg}`)
}
await browser.close()
