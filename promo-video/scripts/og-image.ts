// Open Graph image for ghosthand.dev, rendered from HTML with headless Chrome at 1200x630.
// The background is the hero's ASCII field: glyphs sized by the brightness of a hero-bg.mp4 frame.
//
//   pnpm tsx scripts/og-image.ts                                     # every variant in out/og/
//   pnpm tsx scripts/og-image.ts --variant hero-dark --out ../website/public/og-image.png

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright-core'

const WIDTH = 1200
const HEIGHT = 630
const HERO_FRAME_SECONDS = 8
// Hacker News screen inside the iPhone of the control plane screenshot (website/public/assets).
const PHONE_SCREEN_CROP = '412:892:709:337'

const root = path.resolve(import.meta.dirname, '..')
const website = path.resolve(root, '../website/public')
const { values: args } = parseArgs({
  options: {
    variant: { type: 'string' },
    out: { type: 'string' },
  },
})

function dataUrl(file: string, mime: string) {
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

function fontFace(family: string, file: string) {
  return `@font-face { font-family: '${family}'; src: url(${dataUrl(file, 'font/woff2')}) format('woff2'); font-weight: 100 900; }`
}

/** Extracts one ffmpeg image (video frame or crop) into out/og/ once, as a data URL. */
function ffmpegImage({ name, input, seek, filter }: { name: string; input: string; seek?: number; filter?: string }) {
  const file = path.join(root, 'out/og', name)
  if (!fs.existsSync(file)) {
    console.log(`extracting ${file}`)
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      ...(seek !== undefined ? ['-ss', String(seek)] : []),
      '-i', input,
      ...(filter ? ['-vf', filter] : []),
      '-frames:v', '1', file,
    ])
  }
  return dataUrl(file, 'image/png')
}

type Theme = { bg: string; fg: string; muted: string; glyph: string; logo: string; card: string; border: string }

const DARK: Theme = {
  bg: '#0a0a0a',
  fg: '#fafafa',
  muted: '#a1a1aa',
  glyph: '#7671ec',
  logo: dataUrl(path.join(website, 'logo-white.svg'), 'image/svg+xml'),
  card: '#141416',
  border: 'rgba(255,255,255,0.1)',
}

const LIGHT: Theme = {
  bg: '#fdfcfb',
  fg: '#0a0a0a',
  muted: '#71717a',
  glyph: '#8f8be3',
  logo: dataUrl(path.join(website, 'logo-ink.svg'), 'image/svg+xml'),
  card: '#ffffff',
  border: 'rgba(0,0,0,0.08)',
}

const TITLE_FONT = "'IvarText', serif"
const UI_FONT = "'Inter Variable', sans-serif"
const MONO_FONT = "'JetBrains Mono Variable', monospace"

/** Canvas filled with ASCII glyphs; `mask` is a CSS gradient that hides glyphs behind the text. */
function asciiField({ theme, mask }: { theme: Theme; mask: string }) {
  return `<canvas id="ascii" width="${WIDTH * 2}" height="${HEIGHT * 2}" data-color="${theme.glyph}"
    style="position:absolute;inset:0;width:${WIDTH}px;height:${HEIGHT}px;-webkit-mask-image:${mask};mask-image:${mask}"></canvas>`
}

// Same idea as VideoBackgroundShader dotStyle="ascii": brighter cells get denser, bigger glyphs.
const ASCII_SCRIPT = `
  window.ready = new Promise((resolve) => {
    const canvas = document.getElementById('ascii')
    if (!canvas) return document.fonts.ready.then(resolve)
    const img = new Image()
    img.onload = async () => {
      await document.fonts.ready
      const ctx = canvas.getContext('2d')
      const W = canvas.width, H = canvas.height
      const probe = document.createElement('canvas')
      const cell = 20, cols = Math.ceil(W / cell), rows = Math.ceil(H / cell)
      probe.width = cols; probe.height = rows
      const p = probe.getContext('2d')
      const scale = Math.max(cols / img.width, rows / img.height)
      p.drawImage(img, (cols - img.width * scale) / 2, (rows - img.height * scale) / 2, img.width * scale, img.height * scale)
      const data = p.getImageData(0, 0, cols, rows).data
      const ramp = '.:-=+x?$%8@'
      ctx.fillStyle = canvas.dataset.color
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const b = Math.pow(data[(y * cols + x) * 4] / 255, 0.8)
        if (b < 0.1) continue
        ctx.globalAlpha = 0.45 + 0.55 * b
        ctx.font = (10 + b * 16) + "px 'JetBrains Mono Variable'"
        ctx.fillText(ramp[Math.min(ramp.length - 1, Math.floor(b * ramp.length))], x * cell + cell / 2, y * cell + cell / 2)
      }
      resolve()
    }
    img.src = ${JSON.stringify('HERO_FRAME')}
  })
`

/** Centered hero, same composition as the landing page. */
function heroVariant(theme: Theme) {
  return `
    ${asciiField({ theme, mask: 'radial-gradient(ellipse 50% 46% at 50% 52%, transparent 0%, rgba(0,0,0,0.25) 45%, #000 100%)' })}
    <img src="${theme.logo}" style="position:absolute;left:64px;top:52px;height:46px">
    <div style="position:absolute;right:64px;top:62px;font:500 22px ${UI_FONT};color:${theme.muted}">ghosthand.dev</div>
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding-top:20px">
      <h1 style="margin:0;font:400 104px/0.98 ${TITLE_FONT};color:${theme.fg};letter-spacing:-1px">iPhone control<br>for your agent</h1>
      <p style="margin:34px 0 0;font:450 26px ${UI_FONT};color:${theme.muted}">Screenshots over USB, taps over Bluetooth. Any iOS app.</p>
    </div>`
}

/** Title on the left, the real iPhone screen with agent commands on the right. */
function splitVariant(theme: Theme, phoneScreen: string) {
  const commands = [
    ['ghosthand', 'acquire', ''],
    ['ghosthand', 'screenshot', '-l 42'],
    ['ghosthand', 'tap', '-l 42 --text "Gemini 4 Argon"'],
  ]
  const lines = commands
    .map(
      ([bin, cmd, rest]) =>
        `<div style="white-space:nowrap"><span style="color:#8b87f5">$</span> <span style="color:${'#fafafa'}">${bin}</span> <span style="color:#c4c1fb">${cmd}</span> <span style="color:#a1a1aa">${rest.replaceAll('"', '&quot;')}</span></div>`,
    )
    .join('')
  return `
    ${asciiField({ theme, mask: 'linear-gradient(90deg, transparent 0%, transparent 38%, #000 75%)' })}
    <div style="position:absolute;right:-160px;top:-120px;width:760px;height:760px;border-radius:50%;background:radial-gradient(circle, rgba(79,70,229,0.35), transparent 65%)"></div>
    <div style="position:absolute;left:72px;top:0;bottom:0;width:540px;display:flex;flex-direction:column;justify-content:center">
      <img src="${theme.logo}" style="height:46px;align-self:flex-start">
      <h1 style="margin:44px 0 0;white-space:nowrap;font:400 86px/0.98 ${TITLE_FONT};color:${theme.fg};letter-spacing:-1px">iPhone control<br>for your agent</h1>
      <p style="margin:28px 0 0;font:450 24px/1.4 ${UI_FONT};color:${theme.muted}">A real iPhone on your Mac. Screenshots over USB, taps over Bluetooth. CLI and remote MCP.</p>
      <div style="margin-top:36px;font:500 22px ${UI_FONT};color:${theme.fg}">ghosthand.dev</div>
    </div>
    <div style="position:absolute;left:790px;top:58px;width:300px;height:640px;border-radius:52px;background:#1c1c1f;padding:11px;box-shadow:0 0 0 1.5px #3f3f46, 0 40px 80px rgba(0,0,0,0.6)">
      <div style="position:relative;width:100%;height:100%;border-radius:42px;overflow:hidden;background:url(${phoneScreen}) center/cover">
        <div style="position:absolute;left:6px;top:104px;width:58px;height:58px;border-radius:50%;background:rgba(79,70,229,0.28);box-shadow:0 0 0 2.5px #6b63f2, 0 0 0 9px rgba(107,99,242,0.22)"></div>
      </div>
    </div>
    <div style="position:absolute;left:640px;top:458px;padding:18px 22px;border-radius:14px;background:rgba(20,20,22,0.92);box-shadow:0 0 0 1px rgba(255,255,255,0.1), 0 24px 48px rgba(0,0,0,0.55);font:500 16px/1.75 ${MONO_FONT};backdrop-filter:blur(8px)">
      ${lines}
    </div>`
}

async function main() {
  fs.mkdirSync(path.join(root, 'out/og'), { recursive: true })
  const heroFrame = ffmpegImage({
    name: 'hero-frame.png',
    input: path.join(website, 'assets/hero-bg.mp4'),
    seek: HERO_FRAME_SECONDS,
  })
  const phoneScreen = ffmpegImage({
    name: 'phone-screen.png',
    input: path.join(website, 'assets/control-plane-chat.jpg'),
    filter: `crop=${PHONE_SCREEN_CROP}`,
  })

  const variants: Record<string, { theme: Theme; body: string }> = {
    'hero-dark': { theme: DARK, body: heroVariant(DARK) },
    'hero-light': { theme: LIGHT, body: heroVariant(LIGHT) },
    split: { theme: DARK, body: splitVariant(DARK, phoneScreen) },
  }
  const names = args.variant ? [args.variant] : Object.keys(variants)

  const fonts = [
    fontFace('IvarText', path.join(website, 'fonts/ivartext-regular.woff2')),
    fontFace('Inter Variable', path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')),
    fontFace('JetBrains Mono Variable', path.join(root, 'node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2')),
  ].join('\n')

  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('page error:', e))
  for (const name of names) {
    const variant = variants[name]
    if (!variant) throw new Error(`unknown variant ${name}, expected one of ${Object.keys(variants).join(', ')}`)
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}
      html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${variant.theme.bg}; -webkit-font-smoothing: antialiased }
      </style></head><body><div style="position:relative;width:${WIDTH}px;height:${HEIGHT}px;overflow:hidden">${variant.body}</div>
      <script>${ASCII_SCRIPT.replace('"HERO_FRAME"', JSON.stringify(heroFrame))}</script></body></html>`
    await page.setContent(html)
    await page.evaluate(() => (window as any).ready)
    const out = path.resolve(root, args.out ?? `out/og/og-${name}.png`)
    await page.screenshot({ path: out, type: 'png' })
    console.log(`wrote ${out}`)
  }
  await browser.close()
}

await main()
