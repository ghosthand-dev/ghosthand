import { defineConfig } from 'drizzle-kit'

// DATABASE_URL: PlanetScale in Sigillo (`sigillo run -c prod -- pnpm migrate`), a local Postgres in dev.
export default defineConfig({
  out: './drizzle',
  schema: './src/schema.ts',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
})
