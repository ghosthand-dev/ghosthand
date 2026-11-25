// Operator routes for the cloud fleet, called by scripts/cloud-host.ts with CLOUD_ADMIN_TOKEN.
//
//   GET    /api/cloud-admin/hosts               hosts with running and cached phones
//   PUT    /api/cloud-admin/hosts/:slug         add or change {address, slots, enabled}
//   DELETE /api/cloud-admin/hosts/:slug         remove (refused while it runs or holds a phone)
//   POST   /api/cloud-admin/phones/:id/recover  restart a phone from R2 when its host is gone
//   GET    /api/cloud-admin/snapshot            the fleet state and its newest events

import { timingSafeEqual } from 'node:crypto'
import { env } from 'cloudflare:workers'
import { Spiceflow, json } from 'spiceflow'
import { z } from 'zod'
import { getFleet } from './fleet.ts'

const HOST_SLUG = /^[a-z0-9-]{1,40}$/
const MAX_SLOTS = 64
const MAX_EVENTS = 1000

export const cloudAdminApp = new Spiceflow({ basePath: '/api/cloud-admin' })
  .use(async ({ request }, next) => {
    if (!(await isAdmin(request.headers.get('authorization')))) throw json({ message: 'unauthorized' }, { status: 401 })
    return next()
  })
  .route({
    method: 'GET',
    path: '/hosts',
    detail: { hide: true },
    handler: async () => ({ hosts: await getFleet().hosts() }),
  })
  .route({
    method: 'PUT',
    path: '/hosts/:slug',
    detail: { hide: true },
    request: z.object({
      address: z.string().regex(/^[0-9.]+:\d{1,5}$/, 'address is <private IP>:<port>, e.g. 10.77.0.1:7400'),
      slots: z.number().int().min(0).max(MAX_SLOTS),
      enabled: z.boolean(),
    }),
    handler: async ({ request, params }) => {
      if (!HOST_SLUG.test(params.slug)) throw json({ message: 'slug is lowercase letters, digits and -' }, { status: 400 })
      const body = await request.json()
      return { hosts: await getFleet().setHost({ slug: params.slug, ...body }) }
    },
  })
  .route({
    method: 'DELETE',
    path: '/hosts/:slug',
    detail: { hide: true },
    handler: async ({ params }) => {
      const result = await getFleet().removeHost({ slug: params.slug })
      if (!result.ok) throw json({ message: result.detail }, { status: 409 })
      return { ok: true }
    },
  })
  .route({
    method: 'POST',
    path: '/phones/:id/recover',
    detail: { hide: true },
    handler: async ({ params }) => {
      const result = await getFleet().recover({ phoneId: params.id })
      if (!result.ok) throw json({ message: `no phone ${params.id}` }, { status: 404 })
      return result
    },
  })
  .route({
    method: 'GET',
    path: '/snapshot',
    detail: { hide: true },
    query: z.object({ events: z.coerce.number().int().min(0).max(MAX_EVENTS).optional() }),
    handler: async ({ query }) => getFleet().snapshot({ events: query.events }),
  })

async function isAdmin(authorization: string | null): Promise<boolean> {
  const token = authorization?.match(/^Bearer (.+)$/)?.[1]
  if (!token || !env.CLOUD_ADMIN_TOKEN) return false
  // Compare digests: equal length, so timingSafeEqual never throws or leaks the length.
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
  return timingSafeEqual(await digest(token), await digest(env.CLOUD_ADMIN_TOKEN))
}
