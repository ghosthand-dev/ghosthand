// Operator routes for the cloud fleet, called by scripts/cloud-host.ts with the operator's normal
// ghosthand API key, or by a signed-in browser. Only users listed in the CLOUD_ADMINS var get in.
// Each Worker manages only the hosts of its own environment (fleet.ts).
//
//   GET    /api/cloud-admin/view                the /admin/fleet page as JSON: {ok, problems, ...view}
//   GET    /api/cloud-admin/hosts               hosts with running and cached phones
//   PUT    /api/cloud-admin/hosts/:slug         add or change {address, status}; slots come from the host
//   DELETE /api/cloud-admin/hosts/:slug         remove (refused while it runs or holds a phone)
//   POST   /api/cloud-admin/phones/:id/recover  restart a phone from R2 when its host is gone
//   GET    /api/cloud-admin/phones              every phone's runtime columns

import { env } from 'cloudflare:workers'
import { Spiceflow, json } from 'spiceflow'
import { z } from 'zod'
import { getCallerUserId } from '../db.ts'
import { buildFleetView, fleetProblems, type FleetProblem, type FleetView, type HostProbe } from './admin-view.ts'
import { listFleetPhones, listHosts, readFleet, recover, removeHost, setHost } from './fleet.ts'
import { hostClient } from './host.ts'

const HOST_SLUG = /^[a-z0-9-]{1,40}$/
/** Shorter than the cron's poll timeout: an offline host must not hold the page. */
const PROBE_TIMEOUT_MS = 3_000

export function isCloudAdmin(userId: string): boolean {
  return String(env.CLOUD_ADMINS).split(',').map((id) => id.trim()).includes(userId)
}

/** The whole admin view, for the /admin/fleet loader and GET /view. Asks every host of this
 *  environment for its status now; nothing of it is stored. */
export async function loadFleetView({ signal }: { signal: AbortSignal }): Promise<FleetView & { ok: boolean; problems: FleetProblem[] }> {
  const rows = await readFleet()
  const probes = await Promise.all(rows.hosts.map(async (host): Promise<HostProbe> => {
    const started = Date.now()
    const status = await hostClient(host.address).status({ signal: AbortSignal.any([signal, AbortSignal.timeout(PROBE_TIMEOUT_MS)]) })
    const ms = Date.now() - started
    return status instanceof Error ? { slug: host.slug, ms, status: null, error: status.message } : { slug: host.slug, ms, status, error: null }
  }))
  const now = Date.now()
  const view = buildFleetView({ rows, probes, now })
  const problems = fleetProblems(view, now)
  return { ok: problems.length === 0, problems, ...view }
}

export const cloudAdminApp = new Spiceflow({ basePath: '/api/cloud-admin' })
  .use(async ({ request }, next) => {
    const userId = await getCallerUserId(request)
    if (!userId) throw json({ message: 'unauthorized: pass an API key (ghosthand tunnel url --new-token)' }, { status: 401 })
    if (!isCloudAdmin(userId)) throw json({ message: `user ${userId} is not in CLOUD_ADMINS` }, { status: 403 })
    return next()
  })
  .route({
    method: 'GET',
    path: '/view',
    detail: { hide: true },
    handler: ({ request }) => loadFleetView({ signal: request.signal }),
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
