// One-off copy of the old D1 (SQLite) database into Postgres. Safe to re-run: rows that
// already exist are skipped (ON CONFLICT DO NOTHING).
//
//   npx wrangler d1 export ghosthand-db --remote --output ../tmp/ghosthand-d1.sql
//   (cd ../website && sigillo run -c prod -- node ../db/scripts/copy-d1-to-postgres.ts ../tmp/ghosthand-d1.sql)
//
// SQLite stored dates as epoch ms, booleans as 0/1 and string[] / json as JSON text; the
// Postgres schema has timestamptz, boolean, text[] and jsonb. Values are converted per
// column type of the drizzle schema, so the schema is the only mapping.

import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import pg from 'pg'
import * as orm from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { PgTable } from 'drizzle-orm/pg-core'
import * as schema from '../src/schema.ts'

const dumpPath = process.argv[2]
if (!dumpPath) throw new Error('usage: node scripts/copy-d1-to-postgres.ts <d1-export.sql>')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')

// Parents before children, so every foreign key already exists when its row is inserted.
const TABLES: [string, PgTable][] = [
  ['user', schema.user],
  ['org', schema.org],
  ['verification', schema.verification],
  ['jwks', schema.jwks],
  ['oauth_resource', schema.oauthResource],
  ['oauth_client_assertion', schema.oauthClientAssertion],
  ['session', schema.session],
  ['account', schema.account],
  ['device_code', schema.deviceCode],
  ['apikey', schema.apikey],
  ['org_member', schema.orgMember],
  ['stripe_customer', schema.stripeCustomer],
  ['subscription', schema.subscription],
  ['oauth_client', schema.oauthClient],
  ['oauth_client_resource', schema.oauthClientResource],
  ['oauth_consent', schema.oauthConsent],
  ['oauth_refresh_token', schema.oauthRefreshToken],
  ['oauth_access_token', schema.oauthAccessToken],
]

function convert(column: orm.Column, value: unknown): unknown {
  if (value === null || value === undefined) return null
  const anyColumn = column as orm.Column & { dimensions?: number }
  if (anyColumn.dimensions) return typeof value === 'string' ? JSON.parse(value) : value
  switch (column.columnType) {
    case 'PgTimestamp': return new Date(Number(value))
    case 'PgBoolean': return Boolean(Number(value))
    case 'PgJsonb': return typeof value === 'string' ? JSON.parse(value) : value
    case 'PgInteger': return Number(value)
    default: return value
  }
}

// The export inserts child rows before their parent tables exist.
const sqlite = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false })
sqlite.exec(fs.readFileSync(dumpPath, 'utf8'))
console.log(`loaded ${dumpPath}`)

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })
const db = drizzle({ client: pool })

try {
  for (const [name, table] of TABLES) {
    const rows = sqlite.prepare(`SELECT * FROM "${name}"`).all() as Record<string, unknown>[]
    const columns = Object.entries(orm.getColumns(table))
    const values = rows.map((row) => Object.fromEntries(columns.map(([key, column]) => [key, convert(column, row[column.name])])))
    if (values.length) await db.insert(table).values(values).onConflictDoNothing()
    const [{ count }] = (await pool.query(`SELECT count(*)::int AS count FROM "${name}"`)).rows
    console.log(`${name}: ${rows.length} in D1, ${count} in Postgres`)
    if (count < rows.length) throw new Error(`${name}: Postgres has fewer rows than D1`)
  }
  console.log('done')
} finally {
  await pool.end()
}
