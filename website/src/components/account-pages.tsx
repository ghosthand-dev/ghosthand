// Server-rendered account pages: the centered auth shell (login, device approval)
// and the dashboard. Minimal on purpose: serif headings, hairlines, no cards.

import type { ReactNode } from 'react'
import { Head, Link } from 'spiceflow/react'
import { formatDay, type Entitlement } from '../lib/billing.ts'
import { QuickStart, RowAction, SignOutButton } from './account-client.tsx'
import { PRIMARY, SECONDARY } from './button-styles.ts'
import type { MacSession } from '../db.ts'

const SERIF = { fontFamily: "'IvarText', serif" }

function Logo({ className = 'h-7.5' }: { className?: string }) {
  return (
    <>
      <img src='/logo-ink.svg' alt='ghosthand' className={`${className} w-auto dark:hidden`} />
      <img src='/logo-white.svg' alt='ghosthand' className={`${className} w-auto hidden dark:block`} />
    </>
  )
}

export function AuthShell({ title, description, children }: { title: string; description: ReactNode; children?: ReactNode }) {
  return (
    <main className='flex min-h-[80vh] items-center justify-center px-6 py-16'>
      <Head>
        <Head.Title>{title}</Head.Title>
        <Head.Meta name='robots' content='noindex' />
      </Head>
      <div className='flex w-full max-w-xs flex-col items-center gap-8 text-center'>
        <Link href='/'><Logo /></Link>
        <div className='flex flex-col gap-2'>
          <h1 className='text-3xl tracking-tight text-neutral-900 dark:text-neutral-50' style={SERIF}>{title}</h1>
          <p className='text-sm leading-relaxed text-neutral-500 text-balance'>{description}</p>
        </div>
        {children ? <div className='flex w-full flex-col items-center gap-3'>{children}</div> : null}
      </div>
    </main>
  )
}

/** Bordered, rounded table frame: header row tinted, rows split by hairlines. */
const TABLE = 'w-full overflow-hidden rounded-xl border border-neutral-200 bg-white text-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:border-neutral-800 dark:bg-neutral-950'
const TH = 'border-b border-neutral-200 bg-neutral-50 px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900'
// Explicit text-sm on cells: holocron's prose styles size table cells otherwise.
const CELL = 'border-b border-neutral-200/70 px-4 py-3.5 align-middle text-sm group-last:border-b-0 dark:border-neutral-800'
const TD = `${CELL} text-neutral-900 dark:text-neutral-100`

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <tr className='group'>
      <th scope='row' className={`${CELL} w-36 border-r border-r-neutral-200 bg-neutral-50 text-left font-normal text-neutral-500 dark:border-r-neutral-800 dark:bg-neutral-900`}>{label}</th>
      <td className={TD}>{children}</td>
    </tr>
  )
}

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className='mb-16'>
      <h2 className='mb-1 text-2xl tracking-tight text-neutral-900 dark:text-neutral-50' style={SERIF}>{title}</h2>
      <p className='mb-6 text-sm text-neutral-500'>{description}</p>
      {children}
    </section>
  )
}

const STATUS_LABEL = new Map([['active', 'Active'], ['past_due', 'Payment failed'], ['canceled', 'Canceled']])

export function DashboardPage({
  email,
  name,
  entitlement,
  subscription,
  macs,
  signOutMac,
}: {
  email: string
  name: string
  entitlement: Entitlement
  subscription: { status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean } | null
  macs: MacSession[]
  signOutMac: (formData: FormData) => Promise<void>
}) {
  const ends = formatDay(entitlement.trialEndsAt)
  const plan = {
    trial: { label: 'Free trial', detail: `Agents can use your iPhones until ${ends}. Then $99 per month.` },
    pro: { label: 'Pro', detail: '$99 per month.' },
    expired: { label: 'Trial ended', detail: `The trial ended on ${ends}. Agents cannot take your iPhones until you subscribe.` },
  }[entitlement.plan]
  const period = subscription?.currentPeriodEnd
    ? `${subscription.cancelAtPeriodEnd ? 'Ends' : 'Renews'} on ${formatDay(subscription.currentPeriodEnd)}`
    : null

  return (
    <div className='mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-10'>
      <Head>
        <Head.Title>Dashboard</Head.Title>
        <Head.Meta name='robots' content='noindex' />
      </Head>
      <header className='mb-16 flex items-center justify-between'>
        <Link href='/'><Logo /></Link>
        <nav className='flex items-center gap-6 text-sm text-neutral-500'>
          <Link href='/' className='hover:text-neutral-900 dark:hover:text-neutral-100'>Docs</Link>
          <SignOutButton />
        </nav>
      </header>

      <h1 className='mb-2 text-4xl tracking-tight text-neutral-900 dark:text-neutral-50' style={SERIF}>
        {name ? `Hi, ${name.split(' ')[0]}` : 'Your account'}
      </h1>
      <p className='mb-12 text-sm text-neutral-500'>{email}</p>

      <Section title='Plan' description='One plan: every Mac and iPhone on your account, $99 per month.'>
        <div className={`${TABLE} mb-6`}>
        <table className='w-full border-collapse'>
          <tbody>
          <Row label='Plan'>
            <span className='font-medium'>{plan.label}</span>
            <span className='text-neutral-500'> · {plan.detail}</span>
          </Row>
          {subscription ? (
            <Row label='Subscription'>
              {STATUS_LABEL.get(subscription.status) ?? subscription.status}
              {period ? <span className='text-neutral-500'> · {period}</span> : null}
            </Row>
          ) : null}
          </tbody>
        </table>
        </div>
        <div className='flex flex-wrap items-center gap-4'>
          <a href='/subscribe' className={`${entitlement.plan === 'pro' ? SECONDARY : PRIMARY} max-w-60`}>
            {entitlement.plan === 'pro' ? 'Manage subscription' : 'Subscribe · $99/month'}
          </a>
          <span className='text-xs text-neutral-500'>
            {entitlement.plan === 'pro' ? 'Change card, get invoices or cancel in Stripe.' : 'Secure checkout by Stripe. Cancel anytime.'}
          </span>
        </div>
      </Section>

      <Section title='Macs' description='Macs signed in with this account. Agents on them can use the iPhones plugged in.'>
        {macs.length ? (
          <div className={`${TABLE} overflow-x-auto`}>
            <table className='w-full border-collapse'>
              <thead>
                <tr>
                  <th className={TH}>Mac</th>
                  <th className={TH}>Version</th>
                  <th className={TH}>Signed in</th>
                  <th className={TH}>Last seen</th>
                  <th className={TH}><span className='sr-only'>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {macs.map((mac) => (
                  <tr key={mac.sessionId} className='group transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-900'>
                    <td className={`${TD} font-medium`}>
                      <span className='inline-flex items-center gap-2'>
                        <span className='size-1.5 rounded-full bg-emerald-500' aria-hidden />
                        {mac.name}
                      </span>
                    </td>
                    <td className={`${CELL} font-mono text-neutral-500`}>{mac.version ?? '—'}</td>
                    <td className={`${CELL} tabular-nums text-neutral-500`}>{formatDay(mac.signedInAt)}</td>
                    <td className={`${CELL} tabular-nums text-neutral-500`}>{formatDay(mac.lastUsedAt)}</td>
                    <td className={`${TD} text-right`}>
                      <RowAction action={signOutMac} name='sessionId' value={mac.sessionId} pendingText='Signing out…'>Sign out</RowAction>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className={`${TABLE} px-4 py-6 text-center text-neutral-500`}>
            No Mac yet. Run <code className='font-mono text-neutral-800 dark:text-neutral-200'>npx ghosthand setup</code> and click Sign in with Google.
          </div>
        )}
      </Section>

      <Section title='Get started' description='Give your agent the skill or the MCP server, then connect the iPhone once.'>
        <QuickStart />
      </Section>

      <footer className='mt-auto flex gap-6 border-t border-neutral-200 pt-6 text-sm text-neutral-500 dark:border-neutral-800'>
        <Link href='/' className='hover:text-neutral-900 dark:hover:text-neutral-100'>Docs</Link>
        <a href='https://github.com/remorses/ghosthand' className='hover:text-neutral-900 dark:hover:text-neutral-100'>GitHub</a>
        {/* A holocron page: Link's typed routes only know this app's pages. */}
        <a href='/docs/privacy' className='hover:text-neutral-900 dark:hover:text-neutral-100'>Privacy</a>
      </footer>
    </div>
  )
}
