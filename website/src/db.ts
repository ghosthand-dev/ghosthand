// D1 client, better-auth and session helpers.
//
// getAuth() builds a new better-auth instance per call: Workers read env per request.
// Its cookie cache keeps getSession free of D1 reads on most requests. The daemon
// authenticates with the session token as a bearer header (bearer plugin), which it
// gets from the device flow (deviceAuthorization plugin, see cli-api.ts).
// Remote MCP clients get OAuth access tokens instead: mcp() is the OAuth provider,
// jwt() signs resource-bound tokens, cimd() loads clients from their metadata URL.

import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/d1'
import * as schema from 'db/schema'
import { betterAuth } from 'better-auth/minimal'
import { bearer, deviceAuthorization, jwt } from 'better-auth/plugins'
import { mcp } from '@better-auth/mcp'
import { cimd } from '@better-auth/cimd'
import { drizzleAdapter } from 'better-auth-drizzle-adapter'
import { json } from 'spiceflow'
import { ulid } from 'ulid'
import { fetchCimdOnWorkers } from './cimd-fetch.ts'

export function getDb() {
  return drizzle(env.DB, { schema, relations: schema.relations })
}

export function getBaseUrl(): string {
  return env.BETTER_AUTH_URL
}

/** The remote MCP endpoint: OAuth token audience and RFC 9728 resource id. */
export function getMcpResource(): string {
  return new URL('/mcp', getBaseUrl()).href
}

export function getAuth() {
  return betterAuth({
    baseURL: getBaseUrl(),
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: 'sqlite' }),
    session: {
      expiresIn: 60 * 60 * 24 * 365, // 1 year: a Mac stays logged in
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: 'select_account',
      },
    },
    // The jwt plugin's /token would hand out session JWTs; MCP uses /oauth2/token.
    disabledPaths: ['/token'],
    plugins: [
      deviceAuthorization({ verificationUri: '/device', expiresIn: '15m', interval: '2s' }),
      bearer(),
      jwt({ disableSettingJwtHeader: true }),
      mcp({ loginPage: '/login', consentPage: '/consent', resource: getMcpResource() }),
      cimd({ fetchClientMetadataResource: fetchCimdOnWorkers, metadataProfile: 'mcp-2026-07-28' }),
    ],
  })
}

export type Session = {
  userId: string
  /** better-auth session id: one per signed-in Mac or browser. */
  sessionId: string
  user: { id: string; name: string; email: string; image: string | null; createdAt: Date }
}

/** For pages: stale or corrupt cookies throw, and count as logged out. */
export async function getSession(request: Pick<Request, 'headers'>): Promise<Session | null> {
  if (!request.headers.has('cookie') && !request.headers.has('authorization')) return null
  return getSessionStrict(request).catch((cause) => {
    console.error('getSession failed:', cause)
    return null
  })
}

/**
 * For the daemon API: errors (D1 down) stay errors. A null here becomes a 401, and the
 * daemon deletes its token on 401, so an outage must never look like a revoked session.
 */
export async function getSessionStrict(request: Pick<Request, 'headers'>): Promise<Session | null> {
  const result = await getAuth().api.getSession({ headers: request.headers })
  if (!result) return null
  const { user } = result
  return {
    userId: user.id,
    sessionId: result.session.id,
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null, createdAt: new Date(user.createdAt) },
  }
}

export async function requireSession(request: Pick<Request, 'headers'>): Promise<Session> {
  const session = await getSession(request)
  if (!session) throw json({ error: 'unauthorized' }, { status: 401 })
  return session
}

export type Org = typeof schema.org.$inferSelect

/** The user's org, created on first need. Race-safe through the unique user_id index. */
export async function ensureOrg(session: Session): Promise<Org> {
  const db = getDb()
  const existing = await db.query.orgMember.findFirst({ where: { userId: session.userId }, with: { org: true } })
  if (existing?.org) return existing.org
  const orgId = ulid()
  try {
    await db.batch([
      db.insert(schema.org).values({ orgId, name: session.user.name || session.user.email }),
      db.insert(schema.orgMember).values({ orgId, userId: session.userId, role: 'admin' }),
    ])
  } catch (cause) {
    const winner = await db.query.orgMember.findFirst({ where: { userId: session.userId }, with: { org: true } })
    if (winner?.org) return winner.org
    throw cause
  }
  const org = await db.query.org.findFirst({ where: { orgId } })
  if (!org) throw new Error(`org ${orgId} missing after insert`)
  return org
}

/** Subscriptions of the user's org, from every Stripe account. Empty without an org. */
export async function getUserSubscriptions(userId: string) {
  const member = await getDb().query.orgMember.findFirst({
    where: { userId },
    with: { org: { with: { subscriptions: { orderBy: { createdAt: 'desc' } } } } },
  })
  return member?.org?.subscriptions ?? []
}

export type MacSession = { sessionId: string; name: string; version: string | null; signedInAt: Date; lastUsedAt: Date }

/** Sessions the daemon created: User-Agent "ghosthand/<version> (<Mac name>)". */
export async function listMacSessions(userId: string): Promise<MacSession[]> {
  const rows = await getDb().query.session.findMany({
    where: { userId, userAgent: { like: 'ghosthand/%' }, expiresAt: { gt: new Date() } },
    orderBy: { updatedAt: 'desc' },
  })
  return rows.map((row) => ({
    sessionId: row.id,
    ...parseDaemonUserAgent(row.userAgent),
    signedInAt: row.createdAt,
    lastUsedAt: row.updatedAt,
  }))
}

/** The daemon's User-Agent: "ghosthand/<version> (<Mac name>)". */
export function parseDaemonUserAgent(userAgent: string | null | undefined): { name: string; version: string | null } {
  const match = userAgent?.match(/^ghosthand\/(\S+)(?: \((.*)\))?$/)
  return { name: match?.[2] || 'Mac', version: match?.[1] ?? null }
}
