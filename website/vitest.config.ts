// Unit tests of pure modules only: no holocron or Cloudflare plugins.
import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })
