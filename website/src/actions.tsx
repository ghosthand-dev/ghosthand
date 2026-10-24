// Server actions: approve or deny a daemon's login (/device), an MCP client's access
// (/consent), and sign a Mac out (/dashboard).
'use server'

import { getActionRequest, parseFormData, redirect } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import { getAuth, getDb, getPersonalOrg, requireSession } from './db.ts'
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
    trackEvent('mcp_consent', { user_id: session.userId, accepted: accept === 'true' })
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
    if (target) trackEvent('mac_signed_out', { user_id: session.userId })
    throw redirect('/dashboard')
  })
}
