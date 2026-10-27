// Strada (https://strada.sh): errors, request spans and product events of the Worker and its
// Durable Objects. Every module imports the SDK calls from here, so the SDK is initialized at
// module scope before Spiceflow creates its first span, also in tests and Durable Objects.
//
//   Spiceflow routes, pages ─────────── span exceptions (spiceflowTracer) ───────┐
//   /mcp, /macs, /tunnel/upstream ───── startSpan (server.tsx) ──────────────────┤
//   alarms, WS messages, actions ────── reportErrors() ──────────────────────────┼─▶ project `ghosthand`
//   errors handled inline ───────────── captureException() ──────────────────────┤   service ghosthand-website
//   product events ──────────────────── trackEvent() ────────────────────────────┘
//
// The daemon sends to the same project as service `ghosthand-daemon` (daemon/Sources/ghosthand/telemetry.swift).
// Event properties are ids, counts, names and booleans: never prompts, typed text or tokens.

import { env } from 'cloudflare:workers'
import * as strada from '@strada.sh/sdk'
import type { SpiceflowTracer } from 'spiceflow'

// The SDK returns its own failures as values and already logged them once: nothing to handle.
void strada.initStrada({
  // Empty in tests and before the secret is set: every call is a no-op then.
  projectId: env.STRADA_PROJECT_ID ?? '',
  token: env.STRADA_TOKEN,
  service: 'ghosthand-website',
  environment: env.STRADA_ENVIRONMENT,
  // In the Vite dev server import.meta.hot is set: keep telemetry local.
  enabled: !import.meta.hot,
})

export { startSpan } from '@strada.sh/sdk'

const tracer = strada.trace.getTracer('ghosthand-website')

/** For `new Spiceflow({ tracer })`. Spiceflow sets url.full to request.url: the query is
 *  dropped, because OAuth callbacks carry their code and state there. */
// TODO: pass `tracer` directly once Spiceflow leaves the query out of url.full (spiceflow.js, ATTR.URL_FULL).
export const spiceflowTracer: SpiceflowTracer = {
  startActiveSpan(name: string, ...args: any[]) {
    const options = args.length === 2 ? args[0] : undefined
    const full = options?.attributes?.['url.full']
    if (typeof full === 'string') args[0] = { ...options, attributes: { ...options.attributes, 'url.full': full.replace(/[?#].*$/, '') } }
    return (tracer.startActiveSpan as (...all: any[]) => any)(name, ...args)
  },
}

/** An error handled inline. Tag it with the `handler` or `route` it happened in. */
export function captureException(error: unknown, options?: strada.CaptureExceptionOptions): void {
  void strada.captureException(error, options)
}

/** Product events of the website. The daemon's events are in telemetry.swift. */
export type WebsiteEvents = {
  /** A prompt started a turn of a phone task (POST /api/cli/tasks). */
  task_started: { org_id: string; task_id: string }
  /** A turn ended. `outcome`: finished, aborted, failed or stopped (repeated restarts). */
  task_finished: { org_id: string; task_id: string; outcome: string; steps: number; tool_calls: number; tool_errors: number; duration_ms: number }
  upload_created: { size: number }
  /** The latest Mac installer was found and its download response started. */
  download_started: { version: string }
  api_token_created: {}
  /** /subscribe: Checkout or the billing portal. */
  subscribe_opened: { org_id: string }
  /** The Stripe webhook mirrored a subscription change. */
  subscription_updated: { org_id: string; status: string; cancel_at_period_end: boolean }
  mcp_consent: { accepted: boolean }
  mac_signed_out: {}
}

/** `userId` is sent as `user.id`, like the daemon's events and the Better Auth plugin's, so the event joins `otel_users`. */
export function trackEvent<Name extends keyof WebsiteEvents>(name: Name, properties: WebsiteEvents[Name], options?: strada.TrackOptions): void {
  void strada.track(name, properties, options)
}

/** Code whose errors no span records: Durable Object alarms and WebSocket messages, and server
 *  actions (Spiceflow returns their errors to the page without recording them). Reports the
 *  error, then rethrows it, so the runtime or the page behaves as before. Thrown Responses
 *  (redirect, json) are control flow; errors with a 4xx status (better-auth APIError, form
 *  validation) are expected answers. */
// TODO: drop it for server actions once Spiceflow records their errors on its span.
export async function reportErrors<T>(handler: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const status = Reflect.get(Object(error), 'statusCode') ?? Reflect.get(Object(error), 'status')
    const expected = error instanceof Response || (typeof status === 'number' && status < 500)
    if (!expected) captureException(error, { handled: false, tags: { handler } })
    throw error
  }
}
