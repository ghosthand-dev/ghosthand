// Server actions: approve or deny a daemon's login (/device), sign a Mac out (/dashboard).
'use server'

import { getActionRequest, parseFormData, redirect } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import * as orm from 'drizzle-orm'
import * as schema from 'db/schema'
import { getAuth, getDb, requireSession } from './db.ts'

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

const macForm = z.object({ sessionId: z.string().min(1) })

/** Deletes the Mac's session: its next acquire gets login-required. Only the owner's sessions. */
export async function signOutMac(formData: FormData) {
  const session = await requireSession(getActionRequest())
  const { sessionId } = parseFormData(macForm, formData)
  await getDb().delete(schema.session)
    .where(orm.and(orm.eq(schema.session.id, sessionId), orm.eq(schema.session.userId, session.userId)))
    .limit(1)
  throw redirect('/dashboard')
}
