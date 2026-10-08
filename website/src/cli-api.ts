// API for the ghosthand daemon (Sources/ghosthand/account.swift). Our own small
// contract over better-auth, so a better-auth upgrade cannot break installed daemons.
//
//   daemon ── POST /api/cli/login ────────▶ device code + verification URL
//          ── POST /api/cli/login/token ──▶ pending | approved (+ token) | denied | expired
//          ── GET  /api/cli/account ──────▶ plan, allowed, notice     (Bearer token)
//          ── POST /api/cli/logout ───────▶ revokes the token          (Bearer token)

import { Spiceflow, json } from 'spiceflow'
import { APIError } from 'better-auth/api'
import { z } from 'zod'
import { getAuth, getBaseUrl, getSessionStrict, getUserSubscriptions } from './db.ts'
import { entitlementFor } from './lib/billing.ts'

const CLIENT_ID = 'ghosthand'
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code'

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
      const subscriptions = await getUserSubscriptions(session.userId)
      const entitlement = entitlementFor({ userCreatedAt: session.user.createdAt, subscriptions, now: new Date() })
      return {
        userId: session.userId,
        email: session.user.email,
        name: session.user.name,
        plan: entitlement.plan,
        allowed: entitlement.allowed,
        trialEndsAt: entitlement.trialEndsAt.toISOString(),
        notice: entitlement.notice,
        subscribeUrl,
        dashboardUrl: new URL('/dashboard', getBaseUrl()).toString(),
      }
    },
  })
  .route({
    method: 'POST',
    path: '/logout',
    detail: { hide: true },
    async handler({ request }) {
      await getAuth().api.signOut({ headers: request.headers }).catch(() => {})
      return { ok: true }
    },
  })
