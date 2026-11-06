// API for the ghosthand daemon (daemon/Sources/ghosthand/account.swift). Our own small
// contract over better-auth, so a better-auth upgrade cannot break installed daemons.
//
//   daemon ── POST /api/cli/login ────────▶ device code + verification URL
//          ── POST /api/cli/login/token ──▶ pending | approved (+ token) | denied | expired
//          ── GET  /api/cli/account ──────▶ plan, paid Macs, notice   (Bearer token)
//          ── POST /api/cli/lease-check ──▶ may this iPhone on this Mac be leased? (Bearer token)
//          ── POST /api/cli/logout ───────▶ revokes the token          (Bearer token)
//          ── POST /api/cli/tokens ───────▶ new API token for scripts  (Bearer token)
//          ── DELETE /api/cli/tokens/:id ─▶ revokes an API token       (Bearer token)
//          ── POST /api/cli/upload ───────▶ R2 file + share page URL   (Bearer session or API token, uploads.ts)
//          ── /api/cli/upload/multipart ──▶ same for files over 100 MB, in parts
//          script ─ POST /api/cli/upload ─▶ same, straight from another computer with an API token
//          ── POST /api/cli/tasks ──────────▶ phone task, AI SDK UI message stream (task.ts)
//          ── GET  /api/cli/tasks/:id/stream ▶ the running turn again, or 204
//          ── GET  /api/cli/tasks/:id ───────▶ the task's messages
//          ── POST /api/cli/tasks/:id/abort ─▶ stops the running turn

import { Spiceflow, json } from 'spiceflow'
import { APIError } from 'better-auth/api'
import { UI_MESSAGE_STREAM_HEADERS, validateUIMessages } from 'ai'
import { z } from 'zod'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import pg from 'pg'
import { getAuth, getBaseUrl, getCallerUserId, getDb, getPersonalOrg, getSessionStrict, type Org } from './db.ts'
import { entitlementFor, leaseDecision, taskDecision, taskMonthStart, type DeviceRef, type LeaseDecision } from './lib/billing.ts'
import { abortMultipartUpload, completeMultipartUpload, createUpload, parseUploadId, startMultipartUpload, uploadPart } from './uploads.ts'
import { getTask, TASK_LEASE_PATTERN } from './task.ts'
import { TaskPhone } from './task-agent.ts'
import { trackEvent } from './telemetry.ts'

const CLIENT_ID = 'ghosthand'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'
const HTTP_NO_CONTENT = 204
/** Chosen by the client, like an AI SDK chat id. Scoped to the org in getTask. */
const taskId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)

function parseTaskId(id: string): string {
  const parsed = taskId.safeParse(id)
  if (!parsed.success) throw json({ message: 'invalid task id' }, { status: 400 })
  return parsed.data
}

/** The Mac's session, or an API token of a script: the caller and its org. */
async function requireCaller(request: Request): Promise<{ userId: string; org: Org }> {
  const userId = await getCallerUserId(request)
  if (!userId) throw json({ message: 'unauthorized' }, { status: 401 })
  return { userId, org: await getPersonalOrg(userId) }
}

/** Each prompt spends AI tokens: Free gets FREE_TASKS_PER_MONTH per month, Pro is unlimited.
 *  Records the prompt when allowed. Two prompts racing past the last free one can both pass. */
async function takeTaskPrompt({ request, taskId }: { request: Request; taskId: string }): Promise<{ userId: string; orgId: string }> {
  const { userId, org } = await requireCaller(request)
  const db = getDb()
  const now = new Date()
  const entitlement = entitlementFor({ subscriptions: org.subscriptions, now })
  const used = entitlement.plan === 'pro' ? 0 : await db.$count(schema.taskRun, orm.and(
    orm.eq(schema.taskRun.orgId, org.orgId),
    orm.gte(schema.taskRun.createdAt, taskMonthStart(now)),
  ))
  const decision = taskDecision({ entitlement, used, now, subscribeUrl: new URL('/subscribe', getBaseUrl()).toString() })
  if (!decision.allowed) {
    trackEvent('task_limit_reached', { org_id: org.orgId, used }, { userId })
    throw json({ message: decision.message }, { status: 402 })
  }
  await db.insert(schema.taskRun).values({ orgId: org.orgId, taskId, userId })
  return { userId, orgId: org.orgId }
}

const deviceRef = z.object({
  /** Hex SHA-256 of "ghosthand-device:" + UDID or IOPlatformUUID, made on the Mac. */
  id: z.string().regex(/^[0-9a-f]{64}$/),
  name: z.string().trim().min(1).max(100),
})
const PG_UNIQUE_VIOLATION = '23505'
/** Two Macs racing for the same slot: one insert wins, the other decides again. */
const LEASE_CHECK_ATTEMPTS = 3

/** Decides with `leaseDecision` and binds the device it asks for; on a lost race, reloads and decides again. */
async function checkLease({ userId, phone, mac }: { userId: string; phone: DeviceRef; mac: DeviceRef }) {
  const db = getDb()
  for (let attempt = 1; ; attempt++) {
    const org = await getPersonalOrg(userId)
    const entitlement = entitlementFor({ subscriptions: org.subscriptions, now: new Date() })
    const decision: LeaseDecision = leaseDecision({ entitlement, devices: org.devices, phone, mac })
    if (!decision.allowed || !decision.bind) return { org, entitlement, decision }
    const device = decision.bind.kind === 'phone' ? phone : mac
    try {
      await db.insert(schema.orgDevice)
        .values({ orgId: org.orgId, kind: decision.bind.kind, deviceHash: device.hash, name: device.name, slot: decision.bind.slot })
        .onConflictDoUpdate({
          target: [schema.orgDevice.orgId, schema.orgDevice.kind, schema.orgDevice.deviceHash],
          set: { slot: decision.bind.slot, name: device.name },
        })
      trackEvent('device_bound', { org_id: org.orgId, kind: decision.bind.kind, slot: decision.bind.slot }, { userId })
      return { org, entitlement, decision }
    } catch (error) {
      const cause = error instanceof orm.DrizzleQueryError ? error.cause : error
      const lostRace = cause instanceof pg.DatabaseError && cause.code === PG_UNIQUE_VIOLATION
      if (!lostRace || attempt >= LEASE_CHECK_ATTEMPTS) throw error
    }
  }
}

export const cliApp = new Spiceflow({ basePath: '/api/cli' })
  .route({
    method: 'POST',
    path: '/login',
    detail: { hide: true },
    async handler() {
      const code = await getAuth().api.deviceCode({ body: { client_id: CLIENT_ID } })
      return {
        deviceCode: code.device_code,
        userCode: code.user_code,
        verificationUrl: new URL(code.verification_uri_complete, getBaseUrl()).toString(),
        expiresIn: code.expires_in,
        interval: code.interval,
      }
    },
  })
  .route({
    method: 'POST',
    path: '/login/token',
    detail: { hide: true },
    request: z.object({ deviceCode: z.string().min(1) }),
    async handler({ request }) {
      const { deviceCode } = await request.json()
      try {
        const auth = getAuth()
        const token = await auth.api.deviceToken({
          body: { grant_type: DEVICE_GRANT, device_code: deviceCode, client_id: CLIENT_ID },
          // The session keeps the daemon's User-Agent ("ghosthand/0.4.0 (Mac name)") for the dashboard.
          headers: request.headers,
        })
        // The code is spent now: answer everything the daemon saves in one response.
        const session = await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token.access_token}` }) })
        if (!session) throw new Error('device token did not resolve to a session')
        return { status: 'approved' as const, token: token.access_token, userId: session.user.id, email: session.user.email }
      } catch (cause) {
        // The device plugin throws APIError with the OAuth error code in body.error.
        if (!(cause instanceof APIError)) throw cause
        switch (cause.body?.error) {
          case 'authorization_pending':
          case 'slow_down':
            return { status: 'pending' as const }
          case 'access_denied':
            return { status: 'denied' as const }
          case 'expired_token':
          case 'invalid_grant':
            return { status: 'expired' as const }
        }
        throw cause
      }
    },
  })
  .route({
    method: 'GET',
    path: '/account',
    detail: { hide: true },
    async handler({ request }) {
      const session = await getSessionStrict(request)
      if (!session) throw json({ error: 'unauthorized' }, { status: 401 })
      const subscribeUrl = new URL('/subscribe', getBaseUrl()).toString()
      const org = await getPersonalOrg(session.userId)
      const entitlement = entitlementFor({ subscriptions: org.subscriptions, now: new Date() })
      return {
        userId: session.userId,
        email: session.user.email,
        name: session.user.name,
        plan: entitlement.plan,
        paidMacs: entitlement.paidMacs,
        sourceAccess: entitlement.sourceAccess,
        // TODO: remove allowed and trialEndsAt once no daemon before lease-check runs (0.12 and older
        // decode them and check only here, so they keep unlimited iPhones until they update).
        allowed: true,
        trialEndsAt: entitlement.validUntil.toISOString(),
        notice: entitlement.notice,
        subscribeUrl,
        dashboardUrl: new URL('/dashboard', getBaseUrl()).toString(),
      }
    },
  })
  // The daemon asks before every acquire and wait; it caches allowed iPhones until validUntil.
  .route({
    method: 'POST',
    path: '/lease-check',
    detail: { hide: true },
    request: z.object({ phone: deviceRef, mac: deviceRef }),
    async handler({ request }) {
      const session = await getSessionStrict(request)
      if (!session) throw json({ error: 'unauthorized' }, { status: 401 })
      const body = await request.json()
      const phone = { hash: body.phone.id, name: body.phone.name }
      const mac = { hash: body.mac.id, name: body.mac.name }
      const { org, entitlement, decision } = await checkLease({ userId: session.userId, phone, mac })
      if (!decision.allowed) trackEvent('device_limit_reached', { org_id: org.orgId, plan: entitlement.plan, limit: decision.limit }, { userId: session.userId })
      return {
        allowed: decision.allowed,
        plan: entitlement.plan,
        notice: entitlement.notice,
        message: decision.allowed ? null : decision.message,
        validUntil: entitlement.validUntil.toISOString(),
        subscribeUrl: new URL('/subscribe', getBaseUrl()).toString(),
        dashboardUrl: new URL('/dashboard', getBaseUrl()).toString(),
      }
    },
  })
  .route({
    method: 'POST',
    path: '/upload',
    detail: { hide: true },
    query: z.object({ name: z.string().min(1).max(255) }),
    async handler({ request, query }) {
      // The Mac's session, or an API token from a script on another computer: the file never touches the Mac.
      const { userId } = await requireCaller(request)
      return createUpload({ request, name: query.name, userId })
    },
  })
  // Files over the 100 MB request body limit, in parts (uploads.ts).
  .route({
    method: 'POST',
    path: '/upload/multipart',
    detail: { hide: true },
    query: z.object({ name: z.string().min(1).max(255), size: z.coerce.number().int().positive() }),
    async handler({ request, query }) {
      const { userId } = await requireCaller(request)
      return startMultipartUpload({ request, name: query.name, size: query.size, userId })
    },
  })
  .route({
    method: 'PUT',
    path: '/upload/multipart/:id/:part',
    detail: { hide: true },
    query: z.object({ uploadId: z.string().min(1) }),
    async handler({ request, params, query }) {
      await requireCaller(request)
      const partNumber = z.coerce.number().int().positive().safeParse(params.part)
      if (!partNumber.success) throw json({ message: 'invalid part number' }, { status: 400 })
      return uploadPart({ request, id: parseUploadId(params.id), uploadId: query.uploadId, partNumber: partNumber.data })
    },
  })
  .route({
    method: 'POST',
    path: '/upload/multipart/:id/complete',
    detail: { hide: true },
    request: z.object({
      uploadId: z.string().min(1),
      parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1) })).min(1),
    }),
    async handler({ request, params }) {
      const { userId } = await requireCaller(request)
      const { uploadId, parts } = await request.json()
      return completeMultipartUpload({ id: parseUploadId(params.id), uploadId, parts, userId })
    },
  })
  .route({
    method: 'DELETE',
    path: '/upload/multipart/:id',
    detail: { hide: true },
    query: z.object({ uploadId: z.string().min(1) }),
    async handler({ request, params, query }) {
      await requireCaller(request)
      await abortMultipartUpload({ id: parseUploadId(params.id), uploadId: query.uploadId })
      return { ok: true }
    },
  })
  .route({
    method: 'POST',
    path: '/tokens',
    detail: { hide: true },
    request: z.object({ name: z.string().trim().min(1).max(64) }),
    async handler({ request }) {
      const session = await getSessionStrict(request)
      if (!session) throw json({ message: 'unauthorized' }, { status: 401 })
      const { name } = await request.json()
      // Server-side create: no session cookie, the owner is passed as userId.
      const created = await getAuth().api.createApiKey({ body: { name, userId: session.userId } })
      trackEvent('api_token_created', {}, { userId: session.userId })
      return { id: created.id, name, token: created.key }
    },
  })
  .route({
    method: 'DELETE',
    path: '/tokens/:id',
    detail: { hide: true },
    async handler({ request, params }) {
      const session = await getSessionStrict(request)
      if (!session) throw json({ message: 'unauthorized' }, { status: 401 })
      // Deletes only keys the session's user owns.
      await getAuth().api.deleteApiKey({ body: { keyId: params.id }, headers: request.headers }).catch((cause) => {
        if (cause instanceof APIError) throw json({ message: 'no such token' }, { status: 404 })
        throw cause
      })
      return { ok: true }
    },
  })
  // AI SDK chat transport shape: `id` is the chat (task), the last message is the new prompt.
  // The task keeps its own history, so earlier messages in the body are ignored.
  .route({
    method: 'POST',
    path: '/tasks',
    detail: { hide: true },
    request: z.object({
      id: taskId,
      messages: z.array(z.unknown()).min(1),
      lease: z.string().regex(TASK_LEASE_PATTERN, 'lease must carry its Mac, e.g. studio:42'),
      // Ours, not AI SDK: the leased iPhone, added to the system prompt.
      phone: TaskPhone.optional(),
    }),
    async handler({ request }) {
      const body = await request.json()
      const [message] = await validateUIMessages({ messages: [body.messages.at(-1)] }).catch((cause) => {
        throw json({ message: `invalid message: ${cause instanceof Error ? cause.message : cause}` }, { status: 400 })
      })
      if (message!.role !== 'user') throw json({ message: 'the last message must be a user message' }, { status: 400 })
      const { userId, orgId } = await takeTaskPrompt({ request, taskId: body.id })
      const stream = await getTask({ orgId, taskId: body.id }).send({ orgId, taskId: body.id, lease: body.lease, phone: body.phone, message: message! })
      trackEvent('task_started', { org_id: orgId, task_id: body.id }, { userId })
      return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS })
    },
  })
  // AI SDK resume (`GET {api}/{id}/stream`, 204 when no turn runs). `from` and `message` are
  // ours: a client that lost the stream after `from` chunks of message `message` gets the rest.
  .route({
    method: 'GET',
    path: '/tasks/:id/stream',
    detail: { hide: true },
    query: z.object({ from: z.coerce.number().int().min(0).optional(), message: z.string().optional() }),
    async handler({ request, params, query }) {
      const { org: { orgId } } = await requireCaller(request)
      const stream = await getTask({ orgId, taskId: parseTaskId(params.id) }).resume({ from: query.from, messageId: query.message })
      if (stream === 'gone') throw json({ message: 'a newer turn of this task replaced that stream' }, { status: 410 })
      if (!stream) return new Response(null, { status: HTTP_NO_CONTENT })
      return new Response(stream, { headers: UI_MESSAGE_STREAM_HEADERS })
    },
  })
  .route({
    method: 'GET',
    path: '/tasks/:id',
    detail: { hide: true },
    async handler({ request, params }) {
      const { org: { orgId } } = await requireCaller(request)
      return { messages: await getTask({ orgId, taskId: parseTaskId(params.id) }).messages() }
    },
  })
  .route({
    method: 'POST',
    path: '/tasks/:id/abort',
    detail: { hide: true },
    // `prompt`: the user message id of the turn to stop; another turn keeps running.
    query: z.object({ prompt: z.string().optional() }),
    async handler({ request, params, query }) {
      const { org: { orgId } } = await requireCaller(request)
      return { aborted: await getTask({ orgId, taskId: parseTaskId(params.id) }).abort({ prompt: query.prompt }) }
    },
  })
  .route({
    method: 'POST',
    path: '/logout',
    detail: { hide: true },
    async handler({ request }) {
      await getAuth().api.signOut({ headers: request.headers })
      return { ok: true }
    },
  })
