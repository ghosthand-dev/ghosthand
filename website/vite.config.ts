import { cloudflare } from '@cloudflare/vite-plugin'
import { holocron } from '@holocron.so/vite'
import { stradaVitePlugin } from '@strada.sh/sdk/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  clearScreen: false,
  plugins: [
    // Git commit and branch of the build on every Strada record (vcs.ref.head.*, deployment.id).
    stradaVitePlugin(),
    holocron({ entry: './src/server.tsx', pagesDir: './src' }),
    // Must come after holocron: it reads the rsc/ssr environments holocron creates.
    cloudflare({
      viteEnvironment: {
        name: 'rsc',
        childEnvironments: ['ssr'],
      },
    }),
  ],
})
