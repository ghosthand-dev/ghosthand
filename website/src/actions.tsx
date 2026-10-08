// Server actions: approve or deny a daemon's login (/device), an MCP client's access
// (/consent), and sign a Mac out (/dashboard).
'use server'

import { getActionRequest, parseFormData, redirect } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getAuth, getDb, requireSession } from './db.ts'
import { getHub } from './tunnel.ts'

const deviceForm = z.object({ userCode: z.string().min(1) })

export async function approveDevice(formData: FormData) {
  const request = getActionRequest()
  await requireSession(request)
  const { userCode } = parseFormData(deviceForm, formData)
  await getAuth().api.deviceApprove({ body: { userCode }, headers: request.headers })
  throw redirect(router.href('/device', { user_code: userCode, status: 'approved' }))
}

export async function denyDevice(formData: FormData) {
  const request = getActionRequest()
  await requireSession(request)
  const { userCode } = parseFormData(deviceForm, formData)
  await getAuth().api.deviceDeny({ body: { userCode }, headers: request.headers })
  throw redirect(router.href('/device', { user_code: userCode, status: 'denied' }))
}

const consentForm = z.object({ accept: z.enum(['true', 'false']), oauthQuery: z.string().min(1) })

/** better-auth checks the query signature, then answers with the client's redirect URL. */
export async function consentMcp(formData: FormData) {
  const request = getActionRequest()
  await requireSession(request)
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
  throw redirect(url)
}

const macForm = z.object({ sessionId: z.string().min(1) })

/** Deletes the Mac's session and drops its hub connection: its next call gets 401. Only the owner's sessions. */
export async function signOutMac(formData: FormData) {
  const session = await requireSession(getActionRequest())
  const { sessionId } = parseFormData(macForm, formData)
  await getDb().delete(schema.session)
    .where(orm.and(orm.eq(schema.session.id, sessionId), orm.eq(schema.session.userId, session.userId)))
    .limit(1)
  await getHub(session.userId).revoke(sessionId)
  throw redirect('/dashboard')
}
