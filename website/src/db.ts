// Postgres client, better-auth and session helpers.
//
// getAuth() builds a new better-auth instance per call: Workers read env per request.
// Its cookie cache keeps getSession free of database reads on most requests. The daemon
// authenticates with the session token as a bearer header (bearer plugin), which it
// gets from the device flow (deviceAuthorization plugin, see cli-api.ts).
// Remote MCP clients get OAuth access tokens instead: mcp() is the OAuth provider,
// opaque tokens can be revoked immediately; cimd() loads clients from their metadata URL.
// API tokens (api-key plugin, prefix ghk_) are for scripts that call the HTTP API through
// the Mac tunnel (tunnel.ts): the daemon mints them with its session, hub checks them.
// A signup hook creates the user's personal org: it owns the plan, trial and Mac hub.

import { env } from 'cloudflare:workers'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { betterAuth } from 'better-auth/minimal'
import { bearer, deviceAuthorization } from 'better-auth/plugins'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { createDpopReplayStore, enforceDpopBinding, isDpopBindingError, parseAccessTokenAuthorization } from 'better-auth/oauth2'
import { apiKey } from '@better-auth/api-key'
import { mcp } from '@better-auth/mcp'
import { getOAuthProviderApi } from '@better-auth/oauth-provider'
import { cimd } from '@better-auth/cimd'
import { drizzleAdapter } from 'better-auth-drizzle-adapter'
import { json } from 'spiceflow'
import { strataBetterAuth } from '@strada.sh/sdk/better-auth'
import { fetchCimdOnWorkers } from './cimd-fetch.ts'
import { getHub } from './tunnel.ts'
import { captureException } from './telemetry.ts'

/** An open socket keeps a Durable Object from hibernating (tested: a pg.Client left open blocks it). */
const IDLE_SOCKET_CLOSE_MS = 1_000

/**
 * PlanetScale Postgres through Hyperdrive, which holds the real connection pool. A Worker
 * cannot reuse a socket across requests, so each call gets its own small lazy pool.
 */
export function getDb() {
  const pool = new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 5, idleTimeoutMillis: IDLE_SOCKET_CLOSE_MS })
  // An idle client that dies emits here, outside any query promise; pg already drops it.
  pool.on('error', (error) => captureException(error, { tags: { handler: 'postgres.pool' } }))
  return drizzle({ client: pool, relations: schema.relations })
}

export function getBaseUrl(): string {
  return env.BETTER_AUTH_URL
}

/** The remote MCP endpoint: OAuth token audience and RFC 9728 resource id. */
export function getMcpResource(): string {
  return new URL('/mcp', getBaseUrl()).href
}

export function getAuth() {
  // JWTs are not stored or grant-revocable, even with online introspection.
  const provider = mcp({
    loginPage: '/login', consentPage: '/consent', resource: getMcpResource(),
    disableJwtPlugin: true, prefix: { opaqueAccessToken: 'ghm_' },
  })
  return betterAuth({
    baseURL: getBaseUrl(),
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: 'pg', schema }),
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
    // Replaces the Strada plugin's handler, which reports every APIError: 4xx answers
    // (an expired MCP token, a pending device code) are expected.
    onAPIError: {
      onError: (error) => {
        if (error instanceof APIError && error.statusCode < 500) return
        console.error('better-auth:', error)
        captureException(error, { tags: { handler: 'better-auth' } })
      },
    },
    databaseHooks: {
      user: { create: { after: (user) => createPersonalOrg(user) } },
      session: { delete: {
        before: async (session) => {
          // Delete only this session's grants; revoked-token reuse also ends other sessions' grants.
          await getDb().delete(schema.oauthRefreshToken)
            .where(orm.eq(schema.oauthRefreshToken.sessionId, session.id))
        },
        after: async (session) => {
          const org = await getPersonalOrg(session.userId)
          await getHub(org.orgId).revoke(session.id)
        },
      } },
    },
    plugins: [
      // auth.signup, auth.login (Google, a Mac's device flow), auth.logout events and the user profile.
      strataBetterAuth(),
      deviceAuthorization({ verificationUri: '/device', expiresIn: '15m', interval: '2s' }),
      bearer(),
      // Rate limits are off: a script drives an iPhone with many calls.
      apiKey({ defaultPrefix: 'ghk_', rateLimit: { enabled: false }, maximumNameLength: 64 }),
      provider,
      cimd({ fetchClientMetadataResource: fetchCimdOnWorkers, metadataProfile: 'mcp-2026-07-28' }),
      {
        id: 'mcp-access',
        endpoints: {
          validateMcpAccess: createAuthEndpoint('/mcp-access', {
            method: 'POST', metadata: { SERVER_ONLY: true },
          }, async (ctx) => {
            const authorization = parseAccessTokenAuthorization(ctx.headers?.get('authorization'))
            if (!authorization?.token.startsWith('ghm_')) throw new APIError('UNAUTHORIZED', { error: 'invalid_token' })
            const claims = await getOAuthProviderApi(ctx, provider.options).requireActiveAccessToken(authorization.token)
            const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
            // Deleting a session SET NULLs token.sessionId before the provider's revocation hook.
            if (!audiences.includes(getMcpResource()) || !claims.sid || !claims.sub) throw new APIError('UNAUTHORIZED', { error: 'invalid_token' })
            if (!ctx.request) throw new Error('MCP validation needs the original request')
            await enforceDpopBinding({
              payload: claims, authorization, proofJwt: ctx.headers?.get('dpop') ?? undefined,
              method: ctx.request.method, url: ctx.request.url,
              replayStore: createDpopReplayStore(ctx.context.internalAdapter),
            }).catch((error) => {
              if (isDpopBindingError(error)) throw new APIError('UNAUTHORIZED', { error: error.code, error_description: error.message })
              throw error
            })
            return claims
          }),
        },
      },
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
  return readSession({ headers: request.headers, disableCookieCache: false }).catch((cause) => {
    console.error('getSession failed:', cause)
    captureException(cause, { tags: { handler: 'getSession' } })
    return null
  })
}

/**
 * For the daemon API: errors (database down) stay errors. A null here becomes a 401, and the
 * daemon deletes its token on 401, so an outage must never look like a revoked session.
 */
export async function getSessionStrict(request: Pick<Request, 'headers'>): Promise<Session | null> {
  return readSession({ headers: request.headers, disableCookieCache: true })
}

async function readSession({ headers, disableCookieCache }: { headers: Headers; disableCookieCache: boolean }): Promise<Session | null> {
  const result = await getAuth().api.getSession({ headers, query: { disableCookieCache } })
  if (!result) return null
  const { user } = result
  return {
    userId: user.id,
    sessionId: result.session.id,
    user: { id: user.id, name: user.name, email: user.email, image: user.image ?? null, createdAt: new Date(user.createdAt) },
  }
}

/**
 * The caller's user id: an API token (`Bearer ghk_...`) of a script, else a Mac's session.
 * One database lookup: the bearer plugin would look up a ghk_ token as a session first. Errors throw.
 */
export async function getCallerUserId(request: Pick<Request, 'headers'>): Promise<string | null> {
  const key = request.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1]
  if (!key?.startsWith('ghk_')) return (await getSessionStrict(request))?.userId ?? null
  const result = await getAuth().api.verifyApiKey({ body: { key } })
  return result.valid ? (result.key?.referenceId ?? null) : null
}

export async function requireSession(request: Pick<Request, 'headers'>): Promise<Session> {
  const session = await getSessionStrict(request)
  if (!session) throw json({ error: 'unauthorized' }, { status: 401 })
  return session
}

export type Org = Awaited<ReturnType<typeof getPersonalOrg>>

/** Signup hook: the personal org has org_id = user.id, so a retry is a no-op. */
async function createPersonalOrg(user: { id: string; name: string; email: string; createdAt: Date }): Promise<void> {
  const db = getDb()
  await db.insert(schema.org)
    .values({ orgId: user.id, name: user.name || user.email, kind: 'personal', createdAt: user.createdAt })
    .onConflictDoNothing({ target: schema.org.orgId })
  await db.insert(schema.orgMember)
    .values({ orgId: user.id, userId: user.id, role: 'admin' })
    .onConflictDoNothing({ target: [schema.orgMember.orgId, schema.orgMember.userId] })
}

/**
 * The user's personal org with its subscriptions (every Stripe account, newest first).
 * Looked up through org_member, not by assuming org_id = user.id.
 */
export async function getPersonalOrg(userId: string) {
  const member = await getDb().query.orgMember.findFirst({
    where: { userId, org: { kind: 'personal' } },
    with: { org: { with: { subscriptions: { orderBy: { createdAt: 'desc' } } } } },
  })
  if (!member?.org) throw new Error(`user ${userId} has no personal org`)
  return member.org
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
