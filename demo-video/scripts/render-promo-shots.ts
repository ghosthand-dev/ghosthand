// Renders shot1..shot7 compositions to ../promo-assets/shots/*.mp4
import { execFileSync } from 'node:child_process'
const out = new URL('../../promo-assets/shots/', import.meta.url).pathname
for (const id of ['shot1-hook', 'shot2-intro', 'shot3-demo', 'shot4-multi', 'shot6-anything', 'shot7-end']) {
  console.log(`render ${id}`)
  execFileSync('pnpm', ['exec', 'remotion', 'render', 'src/root.tsx', id, `${out}${id}.mp4`], { stdio: 'inherit' })
}
