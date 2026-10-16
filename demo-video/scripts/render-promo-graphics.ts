// Renders the gfx-* compositions into ../promo-assets/motion-graphics (alpha ones as webm, others as mp4 + png poster).
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const out = new URL('../../promo-assets/motion-graphics/', import.meta.url).pathname
mkdirSync(out, { recursive: true })
const alpha = ['gfx-icon-orbit', 'gfx-icon-row', 'gfx-logo-pop', 'gfx-agent-chips', 'gfx-tap-dot']
const solid = ['gfx-split-frame', 'gfx-end-card', 'gfx-prompt-card']
const remotion = (args: string[]) => execFileSync('pnpm', ['exec', 'remotion', ...args], { stdio: 'inherit' })

for (const id of alpha) {
  console.log(`render ${id} (alpha webm)`)
  remotion(['render', 'src/root.tsx', id, `${out}${id}.webm`, '--codec=vp8', '--pixel-format=yuva420p', '--image-format=png'])
  remotion(['still', 'src/root.tsx', id, `${out}${id}.png`, '--frame=30', '--image-format=png'])
}
for (const id of solid) {
  console.log(`render ${id} (mp4)`)
  remotion(['render', 'src/root.tsx', id, `${out}${id}.mp4`])
  remotion(['still', 'src/root.tsx', id, `${out}${id}.png`, '--frame=60'])
}
