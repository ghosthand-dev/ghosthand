// Run with: playwriter -s <id> --timeout 3000000 -f promo-assets/scripts/run-grok.js
// Reads promo-assets/jobs/<state.jobsFile>.json, skips clips that exist.
// Starts every job across 3 tabs (max 5 in flight), then waits and downloads each as it finishes.
const fs = require('node:fs')
const root = '/Users/morse/Documents/GitHub/iphone-usb-control/promo-assets'
const sdk = await import('/Users/morse/.config/opencode/skills/grok-imagine/utils.js?v=' + Date.now())
const pages = await sdk.getGrokPages({ context, count: 3 })
const jobs = JSON.parse(fs.readFileSync(`${root}/jobs/${state.jobsFile}.json`, 'utf8'))
const todo = jobs.filter((j) => !fs.existsSync(`${root}/clips/${j.id}.mp4`))
console.log(`${todo.length}/${jobs.length} jobs to run`)
const MAX_IN_FLIGHT = 5
let next = 0
async function worker(w) {
  while (next < todo.length) {
    const j = todo[next++]
    const t0 = Date.now()
    try {
      const page = pages[w % pages.length]
      const started = await sdk.startImagineVideo({
        page,
        prompt: j.prompt,
        imagePaths: (j.images || []).map((p) => `${root}/frames/${p}`),
        aspectRatio: j.aspect || '16:9',
        duration: j.duration || 6,
        resolution: j.resolution || '480p',
      })
      const done = await sdk.waitImagineVideo(started)
      const outPath = `${root}/clips/${j.id}.mp4`
      await sdk.downloadImagineVideo({ page, videoUrl: done.videoUrl, outPath })
      fs.appendFileSync(`${root}/clips/manifest.jsonl`, JSON.stringify({ ...j, videoId: done.videoId, width: done.width, height: done.height, seconds: Math.round((Date.now() - t0) / 1000) }) + '\n')
      console.log(`[w${w}] ok ${j.id} ${Math.round((Date.now() - t0) / 1000)}s`)
    } catch (e) {
      console.log(`[w${w}] FAIL ${j.id}: ${String(e).slice(0, 200)}`)
    }
  }
}
await Promise.all(Array.from({ length: MAX_IN_FLIGHT }, (_, w) => worker(w)))
console.log('batch done')
