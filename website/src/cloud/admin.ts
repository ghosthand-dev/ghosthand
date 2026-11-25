// Operator routes for the cloud fleet, called by scripts/cloud-host.ts with the operator's normal
// ghosthand API key. Only users listed in the CLOUD_ADMINS var get in. Each Worker manages only
// the hosts of its own environment (fleet.ts).
//
//   GET    /api/cloud-admin/hosts               hosts with running and cached phones
//   PUT    /api/cloud-admin/hosts/:slug         add or change {address, slots, status}
//   DELETE /api/cloud-admin/hosts/:slug         remove (refused while it runs or holds a phone)
//   POST   /api/cloud-admin/phones/:id/recover  restart a phone from R2 when its host is gone
//   GET    /api/cloud-admin/phones              every phone's runtime columns

import { env } from 'cloudflare:workers'
import { Spiceflow, json } from 'spiceflow'
import { z } from 'zod'
import { getCallerUserId } from '../db.ts'
import { listFleetPhones, listHosts, recover, removeHost, setHost } from './fleet.ts'

const HOST_SLUG = /^[a-z0-9-]{1,40}$/
const MAX_SLOTS = 64

export const cloudAdminApp = new Spiceflow({ basePath: '/api/cloud-admin' })
  .use(async ({ request }, next) => {
    const userId = await getCallerUserId(request)
    if (!userId) throw json({ message: 'unauthorized: pass an API key (ghosthand tunnel url --new-token)' }, { status: 401 })
    if (!cloudAdmins().includes(userId)) throw json({ message: `user ${userId} is not in CLOUD_ADMINS` }, { status: 403 })
    return next()
  })
  .route({
    method: 'GET',
    path: '/hosts',
    detail: { hide: true },
    handler: async () => ({ hosts: await listHosts() }),
  })
  .route({
    method: 'PUT',
    path: '/hosts/:slug',
    detail: { hide: true },
    request: z.object({
      address: z.string().regex(/^[0-9.]+:\d{1,5}$/, 'address is <private IP>:<port>, e.g. 10.77.0.1:7400'),
      slots: z.number().int().min(0).max(MAX_SLOTS),
      status: z.enum(['active', 'draining']),
    }),
    handler: async ({ request, params }) => {
      if (!HOST_SLUG.test(params.slug)) throw json({ message: 'slug is lowercase letters, digits and -' }, { status: 400 })
      const hosts = await setHost({ slug: params.slug, ...await request.json() })
      if (hosts instanceof Error) throw json({ message: hosts.message }, { status: 409 })
      return { hosts }
    },
  })
  .route({
    method: 'DELETE',
    path: '/hosts/:slug',
    detail: { hide: true },
    handler: async ({ params }) => {
      const result = await removeHost({ slug: params.slug })
      if (!result.ok) throw json({ message: result.detail }, { status: 409 })
      return { ok: true }
    },
  })
  .route({
    method: 'POST',
    path: '/phones/:id/recover',
    detail: { hide: true },
    handler: async ({ params }) => {
      const result = await recover({ phoneId: params.id })
      if (!result) throw json({ message: `no phone ${params.id}` }, { status: 404 })
      return result
    },
  })
  .route({
    method: 'GET',
    path: '/phones',
    detail: { hide: true },
    handler: async () => ({ phones: await listFleetPhones() }),
  })

function cloudAdmins(): string[] {
  return String(env.CLOUD_ADMINS).split(',').map((id) => id.trim()).filter(Boolean)
}
