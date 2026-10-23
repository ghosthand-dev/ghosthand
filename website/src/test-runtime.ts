// Real workerd, D1, R2 and hibernating WebSockets, with test-only local credentials.
import { createTestHarness } from 'wrangler'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export async function startTestRuntime() {
  const root = fileURLToPath(new URL('../', import.meta.url))
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
    d1_databases: [{
      binding: 'DB', database_name: 'security-test', database_id: 'local-test',
      migrations_dir: path.resolve(root, '../db/drizzle'),
      migrations_pattern: path.resolve(root, '../db/drizzle/*/migration.sql'),
    }],
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
    await worker.applyD1Migrations('DB')
    return { server, worker, env: await worker.getEnv(), baseUrl: url.origin }
  } catch (error) {
    await server.close()
    throw error
  }
}
