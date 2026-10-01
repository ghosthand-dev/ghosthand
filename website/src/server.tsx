// Custom entry: holocron docs plus /.well-known/agent-skills/* so
// `npx skills add https://ghosthand.dev` installs skills/ghosthand/SKILL.md.
import { Spiceflow } from 'spiceflow'
import { app as holocronApp } from '@holocron.so/vite/app'
import skillMd from '../../skills/ghosthand/SKILL.md?raw'

// Shown in the skills CLI picker. The full trigger text lives in the SKILL.md frontmatter.
const SKILL_DESCRIPTION =
  'Control a real iPhone connected to this Mac with the ghosthand CLI: screenshots and OCR over USB, taps and typing over Bluetooth.'

// The skills CLI checks this sha256 against the exact bytes served below.
let digestPromise: Promise<string> | undefined
function getSkillDigest(): Promise<string> {
  digestPromise ??= (async () => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(skillMd))
    const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
    return `sha256:${hex}`
  })()
  return digestPromise
}

export const app = new Spiceflow()
  .route({
    method: 'GET',
    path: '/.well-known/agent-skills/index.json',
    detail: { hide: true },
    handler: async () =>
      Response.json({
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: [
          {
            name: 'ghosthand',
            type: 'skill-md',
            description: SKILL_DESCRIPTION,
            url: './ghosthand/SKILL.md',
            digest: await getSkillDigest(),
          },
        ],
      }),
  })
  .route({
    method: 'GET',
    path: '/.well-known/agent-skills/ghosthand/SKILL.md',
    detail: { hide: true },
    handler: () => new Response(skillMd, { headers: { 'content-type': 'text/markdown; charset=utf-8' } }),
  })
  .use(holocronApp)

export default {
  fetch(request: Request): Promise<Response> {
    return app.handle(request)
  },
}
