// Server actions: approve or deny a daemon's login (/device), an MCP client's access
// (/consent), and on /dashboard: sign a Mac out, remove a bound device, request source access.
'use server'

import { getActionRequest, parseFormData, redirect } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getAuth, getDb, getPersonalOrg, requireSession } from './db.ts'
import { entitlementFor } from './lib/billing.ts'
import { findGithubUser, removeSourceAccess, requestSourceAccess } from './lib/github.ts'
import { getHub } from './tunnel.ts'
import { reportErrors, trackEvent } from './telemetry.ts'

const deviceForm = z.object({ userCode: z.string().min(1) })

export async function approveDevice(formData: FormData) {
  return reportErrors('approveDevice', async () => {
    const request = getActionRequest()
    await requireSession(request)
    const { userCode } = parseFormData(deviceForm, formData)
    await getAuth().api.deviceApprove({ body: { userCode }, headers: request.headers })
    throw redirect(router.href('/device', { user_code: userCode, status: 'approved' }))
  })
}

export async function denyDevice(formData: FormData) {
  return reportErrors('denyDevice', async () => {
    const request = getActionRequest()
    await requireSession(request)
    const { userCode } = parseFormData(deviceForm, formData)
    await getAuth().api.deviceDeny({ body: { userCode }, headers: request.headers })
    throw redirect(router.href('/device', { user_code: userCode, status: 'denied' }))
  })
}

const consentForm = z.object({ accept: z.enum(['true', 'false']), oauthQuery: z.string().min(1) })

/** better-auth checks the query signature, then answers with the client's redirect URL. */
export async function consentMcp(formData: FormData) {
  return reportErrors('consentMcp', async () => {
    const request = getActionRequest()
    const session = await requireSession(request)
    const { accept, oauthQuery } = parseFormData(consentForm, formData)
    // `request` too: on accept, the endpoint resumes /oauth2/authorize, which fails with
    // "request not found" when called with headers only. With a request, better-call
    // answers a Response unless asResponse is false.
    const { url } = await getAuth().api.oauth2Consent({
      body: { accept: accept === 'true', oauth_query: oauthQuery },
      headers: request.headers,
      request,
      asResponse: false,
    })
    trackEvent('mcp_consent', { accepted: accept === 'true' }, { userId: session.userId })
    throw redirect(url)
  })
}

const macForm = z.object({ sessionId: z.string().min(1) })

/** Deletes the Mac's session and drops its hub connection: its next call gets 401. Only the owner's sessions. */
export async function signOutMac(formData: FormData) {
  return reportErrors('signOutMac', async () => {
    const request = getActionRequest()
    const session = await requireSession(request)
    const { sessionId } = parseFormData(macForm, formData)
    const target = await getDb().query.session.findFirst({ where: { id: sessionId, userId: session.userId } })
    if (target) await getAuth().api.revokeSession({ headers: request.headers, body: { token: target.token } })
    // Retry the hub cleanup even if an earlier attempt already deleted the row.
    const org = await getPersonalOrg(session.userId)
    await getHub(org.orgId).revoke(sessionId)
    if (target) trackEvent('mac_signed_out', {}, { userId: session.userId })
    throw redirect('/dashboard')
  })
}

/** A message for the user, shown by the form's ErrorBoundary; reportErrors skips 4xx. */
class FormError extends Error {
  readonly status = 400
}

const deviceRowForm = z.object({ orgDeviceId: z.string().min(1) })

/** Frees the free iPhone or a paid Mac slot: the next lease binds again. Only the owner's org. */
export async function removeDevice(formData: FormData) {
  return reportErrors('removeDevice', async () => {
    const session = await requireSession(getActionRequest())
    const { orgDeviceId } = parseFormData(deviceRowForm, formData)
    const org = await getPersonalOrg(session.userId)
    const removed = await getDb().delete(schema.orgDevice)
      .where(orm.and(orm.eq(schema.orgDevice.orgDeviceId, orgDeviceId), orm.eq(schema.orgDevice.orgId, org.orgId)))
      .returning()
    for (const device of removed) trackEvent('device_removed', { org_id: org.orgId, kind: device.kind }, { userId: session.userId })
    throw redirect('/dashboard')
  })
}

// GitHub usernames: 1-39 characters, letters, digits and single hyphens.
const sourceAccessForm = z.object({ login: z.string().trim().regex(/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/, 'Not a GitHub username') })

/** Pro only: invites the GitHub account as a read-only collaborator on the daemon repo. */
export async function requestSourceAccessAction(formData: FormData) {
  return reportErrors('requestSourceAccess', async () => {
    const request = getActionRequest()
    const session = await requireSession(request)
    const { login } = parseFormData(sourceAccessForm, formData)
    const org = await getPersonalOrg(session.userId)
    if (!entitlementFor({ subscriptions: org.subscriptions, now: new Date() }).sourceAccess) {
      throw new FormError('Source access comes with ghosthand Pro. Subscribe first.')
    }
    const user = await findGithubUser(login, request.signal)
    if (!user) throw new FormError(`No GitHub account named ${login}.`)
    await requestSourceAccess({ orgId: org.orgId, user, signal: request.signal })
    throw redirect('/dashboard')
  })
}

export async function removeSourceAccessAction() {
  return reportErrors('removeSourceAccess', async () => {
    const request = getActionRequest()
    const session = await requireSession(request)
    const org = await getPersonalOrg(session.userId)
    await removeSourceAccess({ orgId: org.orgId, signal: request.signal })
    throw redirect('/dashboard')
  })
}
