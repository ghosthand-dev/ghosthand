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
      CLOUD_ADMINS: 'cloud-admin-test',
    },
    hyperdrive: [{ binding: 'HYPERDRIVE', id: 'local-test', localConnectionString: database.url }],
    r2_buckets: [{ binding: 'UPLOADS', bucket_name: 'security-test' }, { binding: 'PHONES', bucket_name: 'phones-test' }],
    // Cloud hosts: instead of the Workers VPC, a plain fetch to the scripted host's local address.
    services: [{ binding: 'HOSTS', service: 'ghosthand-security-test', entrypoint: 'TestHosts' }],
    // `?raw` markdown imports (task-agent.ts), which Vite handles in the real build.
    rules: [{ type: 'Text', globs: ['**/*.md?raw'] }],
    durable_objects: {
      bindings: [
        { name: 'GHOSTHAND_HUB', class_name: 'TestHub' },
        { name: 'GHOSTHAND_TASK', class_name: 'TestTask' },
        { name: 'CLOUD_FLEET', class_name: 'TestFleet' },
      ],
    },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['TestHub', 'TestTask', 'TestFleet'] }],
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

type TestRuntime = Awaited<ReturnType<typeof startTestRuntime>>

/** A remote MCP access token for a signed-in test user: a skip-consent client, then the
 *  authorization code flow with PKCE, like a real MCP client. */
export async function mcpAccessToken({ runtime, sessionToken, clientId = crypto.randomUUID() }: { runtime: TestRuntime; sessionToken: string; clientId?: string }) {
  const redirectUri = 'http://127.0.0.1:8765/callback'
  await runtime.sql(
    `INSERT INTO oauth_client (id, client_id, redirect_uris, grant_types, response_types, token_endpoint_auth_method, skip_consent, scopes)
      VALUES ($1, $2, $3, $4, $5, 'none', true, $6) ON CONFLICT DO NOTHING`,
    [clientId, clientId, [redirectUri], ['authorization_code', 'refresh_token'], ['code'], ['openid', 'offline_access']],
  )
  const resource = new URL('/mcp', runtime.baseUrl).href
  // Auth initialization seeds the real resource before the client-resource link.
  await runtime.worker.fetch('/api/auth/get-session')
  await runtime.sql('INSERT INTO oauth_client_resource (id, client_id, resource_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [crypto.randomUUID(), clientId, resource])
  const verifier = crypto.randomBytes(32).toString('base64url')
  const query = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid offline_access',
    resource, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
  })
  const authorize = await runtime.worker.fetch(`/api/auth/oauth2/authorize?${query}`, { headers: { authorization: `Bearer ${sessionToken}` }, redirect: 'manual' })
  if (authorize.status !== 200) throw new Error(`authorize: ${authorize.status} ${await authorize.text()}`)
  const code = new URL((await authorize.json() as { url: string }).url).searchParams.get('code')!
  const response = await runtime.worker.fetch('/api/auth/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId }),
  })
  if (response.status !== 200) throw new Error(`token: ${response.status} ${await response.text()}`)
  return (await response.json() as { access_token: string }).access_token
}
