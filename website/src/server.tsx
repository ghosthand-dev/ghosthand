// Custom entry: account pages, the daemon API, Stripe, and the holocron docs.
//
//   /api/auth/*        better-auth (Google login, device flow, bearer tokens, MCP OAuth)
//   /.well-known/oauth-*, /.well-known/openid-configuration   OAuth discovery (better-auth)
//   /api/cli/*         the daemon's login and plan checks (cli-api.ts)
//   /api/stripe/*      Stripe webhook
//   /login /device /consent /dashboard /subscribe     account pages
//   /mcp               remote MCP, OAuth; routed to the user's Macs (tunnel.ts, before spiceflow)
//   /tunnel/upstream   each signed-in daemon's WebSocket to its user's hub (tunnel.ts)
//   everything else    holocron docs, plus /.well-known/agent-skills/* for `npx skills add`
import { Spiceflow, redirect } from 'spiceflow'
import { router } from 'spiceflow/react'
import { z } from 'zod'
import { app as holocronApp } from '@holocron.so/vite/app'
import skillMd from '../../skills/ghosthand/SKILL.md?raw'
import { getHub, routeHubRequest } from './tunnel.ts'
import { cliApp } from './cli-api.ts'
import { stripeWebhookApp } from './stripe-webhook.ts'
import { ensureOrg, getAuth, getBaseUrl, getDb, getMcpResource, getSession, getUserSubscriptions, listMacSessions } from './db.ts'
import { entitlementFor, isProStatus } from './lib/billing.ts'
import { subscribeRedirectUrl } from './lib/stripe.ts'
import { approveDevice, consentMcp, denyDevice, signOutMac } from './actions.tsx'
// wrangler main is this file, so holocron's auto-import of a root style.css never runs.
import './globals.css'

// Shown in the skills CLI picker. The full trigger text lives in the SKILL.md frontmatter.
const SKILL_DESCRIPTION =
  'Control a real iPhone connected to this Mac with the ghosthand CLI: screenshots and OCR over USB, taps and typing over Bluetooth.'

// The skills CLI checks this sha256 against the exact bytes served below.
let digestPromise: Promise<string> | undefined
function getSkillDigest(): Promise<string> {
  digestPromise ??= (async () => {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(skillMd))
    const hex = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
    return `sha256:${hex}`
  })()
  return digestPromise
}

/** Only same-site paths, so a login link cannot redirect to another site.
 *  Browsers read `/\evil.example` as `//evil.example`: no backslashes, no control chars. */
function safeCallback(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/dashboard'
  return value
}

async function accountLayout({ children }: { children?: React.ReactNode }) {
  const { AccountDocument } = await import('./components/account-pages.tsx')
  return <AccountDocument>{children}</AccountDocument>
}

const loginQuery = z.object({ callbackURL: z.string().optional(), response_type: z.string().optional() })
const deviceQuery = z.object({ user_code: z.string().optional(), status: z.enum(['approved', 'denied']).optional() })

export const app = new Spiceflow()
  .use(({ request }, next) => {
    const url = new URL(request.url)
    if (!url.hostname.startsWith('www.')) return next()
    url.hostname = url.hostname.slice('www.'.length)
    url.protocol = 'https:'
    throw redirect(url.toString(), { status: 301 })
  })
  .use(async ({ request }, next) => {
    const path = request.parsedUrl.pathname
    const isAuthPath = path.startsWith('/api/auth')
      || path.startsWith('/.well-known/oauth-authorization-server')
      || path.startsWith('/.well-known/oauth-protected-resource')
      || path.startsWith('/.well-known/openid-configuration')
    if (isAuthPath) {
      const response = await getAuth().handler(request)
      if (response.ok || response.status !== 404) return response
    }
    return next()
  })
  .use(cliApp)
  .use(stripeWebhookApp)
  .layout('/login', accountLayout)
  .layout('/device', accountLayout)
  .layout('/consent', accountLayout)
  .layout('/dashboard', accountLayout)

  .page({
    path: '/login',
    query: loginQuery,
    handler: async ({ request, query }) => {
      const callbackURL = safeCallback(query.callbackURL)
      if (await getSession(request)) {
        // An MCP client's authorize request (signed query from /api/auth/oauth2/authorize): resume it.
        if (query.response_type === 'code') throw redirect(`/api/auth/oauth2/authorize${request.parsedUrl.search}`)
        throw redirect(callbackURL)
      }
      const { AuthShell } = await import('./components/account-pages.tsx')
      const { GoogleSignInButton } = await import('./components/account-client.tsx')
      return (
        <AuthShell title='Sign in' description='Agents use your iPhones through ghosthand. Free for 7 days, then $99 per month.'>
          <GoogleSignInButton callbackURL={callbackURL} />
        </AuthShell>
      )
    },
  })
  .get('/signup', () => {
    throw redirect('/login')
  })
  .get('/pricing', () => {
    throw redirect('/docs/pricing', { status: 301 })
  })

  .page({
    path: '/device',
    query: deviceQuery,
    handler: async ({ request, query }) => {
      const { AuthShell } = await import('./components/account-pages.tsx')
      const userCode = query.user_code ?? ''
      if (query.status === 'approved') {
        return <AuthShell title='You are signed in' description='Go back to the ghosthand window on your Mac. It continues by itself.' />
      }
      if (query.status === 'denied') {
        return <AuthShell title='Sign-in denied' description='The Mac was not signed in. Start again from the ghosthand setup window.' />
      }
      if (!userCode) {
        return <AuthShell title='Sign in ghosthand' description='Open this page from the Sign in button in the ghosthand setup window on your Mac.' />
      }
      if (!(await getSession(request))) {
        throw redirect(router.href('/login', { callbackURL: `/device?user_code=${encodeURIComponent(userCode)}` }))
      }
      // Claims the code for this browser session; approve fails without it.
      const device = await getAuth().api.deviceVerify({ query: { user_code: userCode }, headers: request.headers }).catch(() => null)
      if (!device || device.status !== 'pending') {
        return <AuthShell title='Link expired' description='This sign-in link is used or expired. Click Sign in again in the ghosthand setup window.' />
      }
      const { DeviceButtons } = await import('./components/account-client.tsx')
      return (
        <AuthShell
          title='Sign in this Mac?'
          description={<>Check that the code matches the one in the ghosthand window: <span className='font-mono text-foreground'>{userCode}</span></>}
        >
          <DeviceButtons userCode={userCode} approve={approveDevice} deny={denyDevice} />
        </AuthShell>
      )
    },
  })

  // An MCP client asks for access: /api/auth/oauth2/authorize sends the signed query here.
  .page('/consent', async ({ request }) => {
    const { search, searchParams } = request.parsedUrl
    if (!(await getSession(request))) throw redirect(router.href('/login', { callbackURL: `/consent${search}` }))
    const { AuthShell } = await import('./components/account-pages.tsx')
    const clientId = searchParams.get('client_id')
    if (!clientId || !searchParams.get('sig')) {
      return <AuthShell title='Nothing to approve' description='Open this page from the sign-in window of your MCP client.' />
    }
    const client = await getDb().query.oauthClient.findFirst({ where: { clientId } })
    const details = {
      Client: clientId,
      Scopes: searchParams.get('scope') || 'none',
      Resource: searchParams.get('resource') || getMcpResource(),
      Redirect: searchParams.get('redirect_uri') || '',
    }
    console.log('mcp consent', { name: client?.name, ...details })
    const { ConsentButtons } = await import('./components/account-client.tsx')
    return (
      <AuthShell
        title={`Allow ${client?.name || 'this MCP client'}?`}
        description='It can use the iPhones on every Mac signed in with this account: screenshots, taps and typing. Allow only clients you trust.'
      >
        <ConsentButtons oauthQuery={search.slice(1)} consent={consentMcp} />
        <details className='group w-full pt-2 text-xs'>
          <summary className='mx-auto flex w-fit cursor-pointer list-none items-center gap-1 text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden'>
            Technical details
            <svg viewBox='0 0 16 16' className='size-3 transition-transform group-open:rotate-180' fill='none' stroke='currentColor' strokeWidth='1.5' aria-hidden>
              <path d='M4 6l4 4 4-4' strokeLinecap='round' strokeLinejoin='round' />
            </svg>
          </summary>
          <dl className='mt-3 w-full break-all text-left'>
            {Object.entries(details).filter(([, value]) => value).map(([label, value]) => (
              <div key={label} className='border-b border-border py-2 last:border-b-0'>
                <dt className='text-muted-foreground'>{label}</dt>
                <dd className='font-mono text-foreground'>{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      </AuthShell>
    )
  })

  .page('/dashboard', async ({ request }) => {
    const session = await getSession(request)
    if (!session) throw redirect(router.href('/login', { callbackURL: '/dashboard' }))
    const [subscriptions, sessions, hubMacs] = await Promise.all([
      getUserSubscriptions(session.userId),
      listMacSessions(session.userId),
      getHub(session.userId).macs(),
    ])
    const hubBySession = new Map(hubMacs.map((mac) => [mac.sessionId, mac]))
    const macs = sessions.map((mac) => ({ ...mac, slug: hubBySession.get(mac.sessionId)?.slug ?? null, online: hubBySession.get(mac.sessionId)?.online ?? false }))
    const entitlement = entitlementFor({ userCreatedAt: session.user.createdAt, subscriptions, now: new Date() })
    // The Pro one, else the newest, so a canceled or failed plan still shows.
    const subscription = subscriptions.find((s) => isProStatus(s.status)) ?? subscriptions[0] ?? null
    const { DashboardPage } = await import('./components/account-pages.tsx')
    return (
      <DashboardPage
        email={session.user.email}
        name={session.user.name}
        entitlement={entitlement}
        subscription={subscription}
        macs={macs}
        mcpUrl={getMcpResource()}
        signOutMac={signOutMac}
      />
    )
  })

  // A stable link for the daemon's errors and the dashboard: Checkout, or the portal when subscribed.
  .get('/subscribe', async ({ request }) => {
    const session = await getSession(request)
    if (!session) throw redirect(router.href('/login', { callbackURL: '/subscribe' }))
    const org = await ensureOrg(session)
    const url = await subscribeRedirectUrl({ org, email: session.user.email, returnUrl: new URL('/dashboard', getBaseUrl()).toString() })
    throw redirect(url)
  })

  .route({
    method: 'GET',
    path: '/.well-known/agent-skills/index.json',
    detail: { hide: true },
    handler: async () =>
      Response.json({
        $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
        skills: [
          {
            name: 'ghosthand',
            type: 'skill-md',
            description: SKILL_DESCRIPTION,
            url: './ghosthand/SKILL.md',
            digest: await getSkillDigest(),
          },
        ],
      }),
  })
  .route({
    method: 'GET',
    path: '/.well-known/agent-skills/ghosthand/SKILL.md',
    detail: { hide: true },
    handler: () => new Response(skillMd, { headers: { 'content-type': 'text/markdown; charset=utf-8' } }),
  })
  .use(holocronApp)

declare module 'spiceflow/react' {
  interface SpiceflowRegister {
    app: typeof app
  }
}

export { GhosthandHub } from './tunnel.ts'

export default {
  fetch(request: Request): Promise<Response> {
    return routeHubRequest(request) ?? app.handle(request)
  },
} satisfies ExportedHandler<Env>
