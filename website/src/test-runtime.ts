// Real workerd, Postgres, R2 and hibernating WebSockets, with test-only local credentials.
// Each runtime gets a fresh database on the local Postgres (TEST_DATABASE_URL), migrated
// with the real drizzle migrations and reached through a local Hyperdrive binding.
import { createTestHarness } from 'wrangler'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'
import os from 'node:os'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'

// Miniflare's Hyperdrive needs a user and password in the URL; local trust auth ignores the password.
const ADMIN_URL = process.env.TEST_DATABASE_URL ?? `postgres://${os.userInfo().username}:local@localhost:5432/postgres`

async function createTestDatabase(root: string) {
  const name = `ghosthand_test_${crypto.randomBytes(6).toString('hex')}`
  const admin = new pg.Client({ connectionString: ADMIN_URL })
  await admin.connect()
  await admin.query(`CREATE DATABASE ${name}`)
  await admin.end()
  const url = new URL(ADMIN_URL)
  url.pathname = `/${name}`
  const pool = new pg.Pool({ connectionString: url.href })
  await migrate(drizzle({ client: pool }), { migrationsFolder: path.resolve(root, '../db/drizzle') })
  return {
    url: url.href,
    pool,
    async drop() {
      await pool.end()
      const client = new pg.Client({ connectionString: ADMIN_URL })
      await client.connect()
      await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`)
      await client.end()
    },
  }
}

export async function startTestRuntime() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const database = await createTestDatabase(root)
  // Wrangler prefers this env var (set by `sigillo run -c dev`) over localConnectionString.
  process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE = database.url
  const config = {
    name: 'ghosthand-security-test',
    main: path.join(root, 'src/test-runtime-worker.ts'),
    compatibility_date: '2026-09-21',
    compatibility_flags: ['nodejs_compat', 'enable_request_signal'],
    vars: {
      BETTER_AUTH_URL: 'http://localhost',
      BETTER_AUTH_SECRET: 'local-security-regression-test-secret-only',
      GOOGLE_CLIENT_ID: 'local-test',
      GOOGLE_CLIENT_SECRET: 'local-test',
      // Task tests call the real model through Vercel AI Gateway: run them with `sigillo run`.
      AI_GATEWAY_API_KEY: process.env.AI_GATEWAY_API_KEY ?? '',
    },
    hyperdrive: [{ binding: 'HYPERDRIVE', id: 'local-test', localConnectionString: database.url }],
    r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'security-test' }],
    durable_objects: {
      bindings: [
        { name: 'GHOSTHAND_HUB', class_name: 'TestHub' },
        { name: 'GHOSTHAND_TASK', class_name: 'TestTask' },
      ],
    },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['TestHub', 'TestTask'] }],
  }
  const server = createTestHarness({ root, workers: [{ config }] })
  try {
    const { url } = await server.listen()
    config.vars.BETTER_AUTH_URL = url.origin
    await server.update({ root, workers: [{ config }] })
    const worker = server.getWorker<Env>()
    return {
      server,
      worker,
      env: await worker.getEnv(),
      baseUrl: url.origin,
      /** Raw SQL on the test database, for states the API cannot reach. */
      sql: async (text: string, params: (string | boolean | Date | string[] | null)[] = []) => (await database.pool.query(text, params)).rows,
      async close() {
        await server.close()
        await database.drop()
      },
    }
  } catch (error) {
    await server.close()
    await database.drop()
    throw error
  }
}
