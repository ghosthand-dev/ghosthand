// This entry is bundled only by security tests, never by the website build.
import { env } from 'cloudflare:workers'
import { getAuth } from './db.ts'
import { GhosthandHub, getHub, routeHubRequest } from './tunnel.ts'
import { cliApp } from './cli-api.ts'
import { GhosthandTask, getTask } from './task.ts'
import { uploadsApp } from './uploads.ts'
import { runAction } from 'spiceflow/testing'
import { signOutMac } from './actions.tsx'

export class TestHub extends GhosthandHub {
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === '/__test/expire') return Response.json(await this.expireNow())
    return super.fetch(request)
  }

  async expireNow() {
    // Tests call the real alarm without sleeping until a wall-clock deadline.
    for (const socket of this.ctx.getWebSockets()) {
      socket.serializeAttachment({ ...socket.deserializeAttachment(), expiresAt: Date.now() - 1 })
    }
    await this.alarm()
    return { deadline: await this.ctx.storage.getAlarm(), macs: await this.macs() }
  }
}

export class TestTask extends GhosthandTask {
  async fetch(request: Request): Promise<Response> {
    switch (new URL(request.url).pathname) {
      // The real alarm, without waiting for its wall-clock time.
      case '/__test/task/alarm':
        await this.alarm()
        return Response.json({ meta: this.ctx.storage.kv.get('meta') ?? null })
      // Stored keys, to check that chunks are written in batches.
      case '/__test/task/keys':
        return Response.json([...this.ctx.storage.kv.list()].map(([key]) => key))
      // Resets the object like a deploy or crash: the running turn stops, storage stays.
      case '/__test/task/crash':
        this.ctx.abort('test restart')
    }
    return new Response(null, { status: 404 })
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/__test/session') {
      const auth = getAuth()
      const context = await auth.$context
      const userId = url.searchParams.get('userId')
      const user = userId ? await context.internalAdapter.findUserById(userId) : await context.internalAdapter.createUser({
        name: 'Security test', email: `${crypto.randomUUID()}@example.com`, emailVerified: true,
      }, { method: 'admin' })
      if (!user) return new Response(null, { status: 404 })
      const session = await context.internalAdapter.createSession(user.id)
      return Response.json({ user, session })
    }
    if (url.pathname.startsWith('/__test/task/')) {
      return getTask({ orgId: url.searchParams.get('org')!, taskId: url.searchParams.get('task')! }).fetch(request)
    }
    if (url.pathname === '/__test/expire') {
      return getHub(url.searchParams.get('org')!).fetch(request)
    }
    if (url.pathname === '/__test/sign-out-mac') {
      const form = await request.formData()
      try {
        await runAction(() => signOutMac(form), { request })
      } catch (error) {
        if (error instanceof Response) return error
        throw error
      }
      return new Response(null, { status: 204 })
    }
    if (url.pathname.startsWith('/api/auth/')) return getAuth().handler(request)
    const hub = routeHubRequest(request)
    if (hub) return hub
    if (url.pathname.startsWith('/api/cli/')) return cliApp.handle(request)
    return uploadsApp.handle(request)
  },
} satisfies ExportedHandler<typeof env>
