// Bundle src/<entry>.ts, then render it with headless Chrome: one screenshot per frame, encoded by ffmpeg.
//
//   pnpm tsx scripts/render.ts                     # src/video.ts -> out/video.mp4 at 60 fps
//   pnpm tsx scripts/render.ts --entry launch      # src/launch.ts -> out/launch.mp4
//   pnpm tsx scripts/render.ts --fps 30 --out out/draft.mp4
//   pnpm tsx scripts/render.ts --stills 1.5,6,14   # PNGs in out/stills/ for quick checks
//   pnpm tsx scripts/render.ts --preview           # out/preview.html with a scrubber, opens it

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import * as esbuild from 'esbuild'
import { pathToFileURL } from 'node:url'
import { chromium, type Page } from 'playwright-core'
import { CLIP_FPS, CLIPS, type Sound } from '../src/shared.ts'

const root = path.resolve(import.meta.dirname, '..')
const { values: args } = parseArgs({
  options: {
    entry: { type: 'string', default: 'video' },
    fps: { type: 'string', default: '60' },
    out: { type: 'string' },
    workers: { type: 'string', default: String(Math.min(8, os.cpus().length)) },
    stills: { type: 'string' },
    preview: { type: 'boolean', default: false },
  },
})

function fontFace(family: string, file: string, style = 'normal') {
  const data = fs.readFileSync(path.join(root, 'node_modules', file)).toString('base64')
  return `@font-face { font-family: '${family}'; src: url(data:font/woff2;base64,${data}) format('woff2'); font-weight: 100 900; font-style: ${style}; }`
}

/** Extracts each clip to out/clips/<name>/00001.jpg... once. Returns frame counts. */
function prepareClips() {
  const frames: Record<string, number> = {}
  for (const clip of CLIPS) {
    const dir = path.join(root, 'out/clips', clip.name)
    if (!fs.existsSync(dir)) {
      console.log(`extracting ${clip.src} to ${dir}`)
      fs.mkdirSync(dir, { recursive: true })
      const range = 'start' in clip ? ['-ss', String(clip.start), '-t', String(clip.duration)] : []
      execFileSync('ffmpeg', [
        '-v', 'error', ...range, '-i', path.resolve(root, clip.src),
        '-vf', `fps=${CLIP_FPS},scale=${clip.width}:-2`, '-q:v', '3',
        path.join(dir, '%05d.jpg'),
      ])
    }
    frames[clip.name] = fs.readdirSync(dir).filter((f) => f.endsWith('.jpg')).length
  }
  return frames
}

/** Writes the page into out/ so clip frames load with relative URLs. */
async function writeHtml({ preview }: { preview: boolean }) {
  const file = path.join(root, 'out', preview ? `${args.entry}-preview.html` : `${args.entry}-render.html`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const clipFrames = prepareClips()
  fs.writeFileSync(file, (await buildHtml({ preview })).replace('<body>', `<body><script>window.clipFrames = ${JSON.stringify(clipFrames)}</script>`))
  return file
}

async function buildHtml({ preview }: { preview: boolean }) {
  const result = await esbuild.build({
    entryPoints: [path.join(root, `src/${args.entry}.ts`)],
    bundle: true,
    format: 'iife',
    write: false,
    target: 'chrome120',
    loader: { '.svg': 'text' },
  })
  const js = result.outputFiles[0].text
  const fonts = [
    fontFace('Inter Variable', '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'),
    fontFace('JetBrains Mono Variable', '@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'),
    fontFace('Fraunces Variable', '@fontsource-variable/fraunces/files/fraunces-latin-full-normal.woff2'),
    fontFace('Fraunces Variable', '@fontsource-variable/fraunces/files/fraunces-latin-full-italic.woff2', 'italic'),
    fontFace('DM Sans Variable', '@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2'),
    fontFace('Caveat Variable', '@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2'),
  ].join('\n')
  const previewUi = `
    <style>
      html, body { width: auto !important; height: auto !important; overflow: auto !important; background: #222 !important }
      #wrap { width: 100vw; height: calc(100vh - 56px); display: grid; place-items: center; overflow: hidden }
      #stage { transform-origin: center; flex: none }
      #bar { height: 56px; display: flex; gap: 12px; align-items: center; padding: 0 16px; font: 14px system-ui; color: #ddd }
      #bar input { flex: 1 }
    </style>
    <script>
      window.video.ready.then(() => {
        const stage = document.getElementById('stage')
        const fit = () => stage.style.transform = 'scale(' + Math.min(innerWidth / 1920, (innerHeight - 56) / 1080) + ')'
        addEventListener('resize', fit); fit()
        const range = document.getElementById('t'), label = document.getElementById('label'), play = document.getElementById('play')
        range.max = window.video.duration
        let playing = false, last = 0
        const show = (t) => { range.value = t; label.textContent = (+t).toFixed(2) + 's'; window.video.seek(+t) }
        range.oninput = () => show(range.value)
        play.onclick = () => { playing = !playing; play.textContent = playing ? 'Pause' : 'Play'; last = performance.now(); if (playing) requestAnimationFrame(tick) }
        const tick = (now) => {
          if (!playing) return
          let t = +range.value + (now - last) / 1000; last = now
          if (t > window.video.duration) t = 0
          show(t); requestAnimationFrame(tick)
        }
      })
    </script>`
  const body = preview
    ? `<div id="wrap"><div id="stage"></div></div><div id="bar"><button id="play">Play</button><input id="t" type="range" min="0" step="0.01" value="0"><span id="label">0.00s</span></div>`
    : `<div id="stage"></div>`
  return `<!doctype html><html><head><meta charset="utf-8"><style>${fonts}</style></head><body>${body}<script>${js}</script>${preview ? previewUi : ''}</body></html>`
}

async function openPage(file: string, browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', (e) => console.error('page error:', e))
  await page.goto(pathToFileURL(file).href)
  await page.evaluate(() => window.video.ready)
  return page
}

async function shot(page: Page, t: number, file: string) {
  await page.evaluate((time) => window.video.seek(time), t)
  await page.screenshot({ path: file, type: 'png' })
}

/** ffmpeg inputs and filter that mix every sound at its time into one track (input 0 is the frames). */
function audioArgs({ sounds, duration }: { sounds: Sound[]; duration: number }) {
  if (!sounds.length) return []
  const inputs = sounds.flatMap((s) => [
    ...(s.from !== undefined ? ['-ss', String(s.from)] : []),
    ...(s.duration !== undefined ? ['-t', String(s.duration)] : []),
    '-i', path.resolve(root, s.src),
  ])
  const chains = sounds.map((s, i) => {
    const ms = Math.round(s.at * 1000)
    const tempo = s.tempo ? `atempo=${s.tempo},` : ''
    const fade = s.fadeOut && s.duration ? `afade=t=out:st=${s.duration - s.fadeOut}:d=${s.fadeOut},` : ''
    return `[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,${tempo}${fade}volume=${s.volume ?? 1},adelay=${ms}|${ms}[a${i}]`
  })
  const mix = `${sounds.map((_, i) => `[a${i}]`).join('')}amix=inputs=${sounds.length}:normalize=0,atrim=0:${duration}[aout]`
  return [...inputs, '-filter_complex', [...chains, mix].join(';'), '-map', '0:v', '-map', '[aout]', '-c:a', 'aac', '-b:a', '192k']
}

async function main() {
  console.log(`bundling src/${args.entry}.ts`)
  if (args.preview) {
    const file = await writeHtml({ preview: true })
    console.log(`wrote ${file}`)
    execFileSync('open', [file])
    return
  }

  const file = await writeHtml({ preview: false })
  const browser = await chromium.launch({ channel: 'chrome', headless: true })

  if (args.stills) {
    const dir = path.join(root, 'out/stills')
    fs.mkdirSync(dir, { recursive: true })
    const page = await openPage(file, browser)
    for (const t of args.stills.split(',').map(Number)) {
      const file = path.join(dir, `${args.entry}-t${t.toFixed(2)}.png`)
      await shot(page, t, file)
      console.log(`wrote ${file}`)
    }
    await browser.close()
    return
  }

  const fps = Number(args.fps)
  const workers = Number(args.workers)
  const pages = await Promise.all(Array.from({ length: workers }, () => openPage(file, browser)))
  const { duration, sounds } = await pages[0].evaluate(() => ({ duration: window.video.duration, sounds: window.video.sounds ?? [] }))
  const total = Math.round(duration * fps)
  const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-frames-'))
  console.log(`rendering ${total} frames at ${fps} fps with ${workers} workers into ${framesDir}`)

  let done = 0
  const started = Date.now()
  await Promise.all(
    pages.map(async (page, w) => {
      for (let i = w; i < total; i += workers) {
        await shot(page, i / fps, path.join(framesDir, `f${String(i).padStart(5, '0')}.png`))
        done++
        if (done % fps === 0) console.log(`frame ${done}/${total} (${((Date.now() - started) / 1000).toFixed(0)}s)`)
      }
      await page.close()
    }),
  )
  await browser.close()

  const out = path.resolve(root, args.out ?? `out/${args.entry}.mp4`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  console.log(`encoding ${out}${sounds.length ? ` with ${sounds.length} sounds` : ''}`)
  execFileSync('ffmpeg', [
    '-y', '-v', 'error',
    '-framerate', String(fps),
    '-i', path.join(framesDir, 'f%05d.png'),
    ...audioArgs({ sounds, duration }),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    out,
  ])
  fs.rmSync(framesDir, { recursive: true, force: true })
  console.log(`wrote ${out}`)
}

await main()
