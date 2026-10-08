// Server-rendered account pages: the centered auth shell (login, device approval)
// and the dashboard. Minimal on purpose: serif headings, hairlines, no cards.

import type { ReactNode } from 'react'
import { Head, Link } from 'spiceflow/react'
import { formatDay, TRIAL_DAYS, type Entitlement } from '../lib/billing.ts'
import { cn } from '../lib/utils.ts'
import { CopyField, QuickStart, RowAction, SignOutButton, SubscribeLink } from './account-client.tsx'
import { PRIMARY, SECONDARY } from './button-styles.ts'
import type { MacSession } from '../db.ts'

const SERIF = { fontFamily: "'IvarText', serif" }
const DAY_MS = 24 * 60 * 60 * 1000

function Logo({ className }: { className?: string }) {
  return (
    <>
      <img src='/logo-ink.svg' alt='ghosthand' className={cn('h-7.5 w-auto dark:hidden', className)} />
      <img src='/logo-white.svg' alt='ghosthand' className={cn('hidden h-7.5 w-auto dark:block', className)} />
    </>
  )
}

// Runs before paint: `.dark` from the OS setting, the same rule as the docs (appearance.strict).
const SYSTEM_THEME_SCRIPT = `document.documentElement.classList.toggle('dark', matchMedia('(prefers-color-scheme: dark)').matches)`

/** Document shell of the account pages. Holocron's wildcard layout only renders a Fragment
 *  around app pages, so without this they have no <html>, no viewport and no theme. */
export function AccountDocument({ children }: { children: ReactNode }) {
  return (
    <html lang='en' suppressHydrationWarning>
      <Head>
        <Head.Meta charSet='utf-8' />
        <Head.Meta name='viewport' content='width=device-width, initial-scale=1' />
        <link rel='icon' href='/favicon.svg' />
      </Head>
      <body>
        {/* Same place as holocron's theme script. Head.Script logs React ordering errors. */}
        <script dangerouslySetInnerHTML={{ __html: SYSTEM_THEME_SCRIPT }} />
        {children}
      </body>
    </html>
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
          <h1 className='text-3xl tracking-tight text-balance text-foreground' style={SERIF}>{title}</h1>
          <p className='text-sm leading-relaxed text-balance text-muted-foreground'>{description}</p>
        </div>
        {children ? <div className='flex w-full flex-col items-center gap-3'>{children}</div> : null}
      </div>
    </main>
  )
}

function Section({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <section className='flex flex-col gap-6'>
      <div className='flex flex-col gap-1'>
        <h2 className='text-2xl tracking-tight text-pretty text-foreground' style={SERIF}>{title}</h2>
        <p className='text-sm text-muted-foreground'>{description}</p>
      </div>
      {children}
    </section>
  )
}

/** A signed-in Mac, with its MCP slug and hub connection once it connected. */
export type DashboardMac = MacSession & { slug: string | null; online: boolean }

type Subscription = { status: string; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean }

/** Plan name, one sentence on what it means now, and the trial progress. */
function PlanStatus({ entitlement, subscription }: { entitlement: Entitlement; subscription: Subscription | null }) {
  const ends = formatDay(entitlement.trialEndsAt)
  const daysLeft = Math.max(0, Math.ceil((entitlement.trialEndsAt.getTime() - Date.now()) / DAY_MS))
  const status: { label: string; badge: string | null; tone?: 'good' | 'bad'; detail: string } = (() => {
    if (entitlement.plan === 'trial') {
      return {
        label: 'Free trial',
        badge: `${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left`,
        detail: `Your agents can use your iPhones for free until ${ends}. Subscribe before then to keep access.`,
      }
    }
    if (entitlement.plan === 'expired') {
      return {
        label: 'Trial ended',
        badge: null,
        detail: `Your trial ended on ${ends}. Your agents cannot use your iPhones until you subscribe.`,
      }
    }
    const end = subscription?.currentPeriodEnd ? formatDay(subscription.currentPeriodEnd) : null
    if (subscription?.status === 'past_due') {
      return { label: 'Pro', badge: 'Payment failed', tone: 'bad' as const, detail: 'Update your card in Stripe, or Stripe cancels the plan.' }
    }
    if (subscription?.cancelAtPeriodEnd) {
      return { label: 'Pro', badge: 'Canceled', tone: 'bad' as const, detail: end ? `Your plan stays active until ${end}.` : 'Your plan stays active until the end of the period.' }
    }
    return { label: 'Pro', badge: 'Active', tone: 'good' as const, detail: end ? `Renews on ${end} for $99.` : 'Renews every month for $99.' }
  })()

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <span className='text-base font-medium text-foreground'>{status.label}</span>
        {status.badge ? (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
              !status.tone && 'bg-muted text-muted-foreground',
              status.tone === 'good' && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
              status.tone === 'bad' && 'bg-red-500/10 text-red-700 dark:text-red-400',
            )}
          >
            {status.badge}
          </span>
        ) : null}
      </div>
      {entitlement.plan === 'trial' ? (
        <div className='flex w-full max-w-xs gap-1' role='meter' aria-valuemin={0} aria-valuemax={TRIAL_DAYS} aria-valuenow={daysLeft} aria-label='Trial days left'>
          {Array.from({ length: TRIAL_DAYS }, (_, day) => (
            <span key={day} className={cn('h-1.5 flex-1 rounded-full', day < daysLeft ? 'bg-foreground/80' : 'bg-muted')} />
          ))}
        </div>
      ) : null}
      <p className='text-sm text-pretty text-muted-foreground'>{status.detail}</p>
    </div>
  )
}

export function DashboardPage({
  email,
  name,
  entitlement,
  subscription,
  macs,
  mcpUrl,
  signOutMac,
}: {
  email: string
  name: string
  entitlement: Entitlement
  subscription: Subscription | null
  macs: DashboardMac[]
  mcpUrl: string
  signOutMac: (formData: FormData) => Promise<void>
}) {
  const isPro = entitlement.plan === 'pro'

  return (
    <div className='mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-16 px-6 py-10'>
      <Head>
        <Head.Title>Dashboard</Head.Title>
        <Head.Meta name='robots' content='noindex' />
      </Head>
      <header className='flex items-center justify-between'>
        <Link href='/'><Logo /></Link>
        <nav className='flex items-center gap-6 text-sm text-muted-foreground'>
          <Link href='/' className='hover:text-foreground'>Docs</Link>
          <SignOutButton />
        </nav>
      </header>

      <div className='flex flex-col gap-2'>
        <h1 className='text-4xl tracking-tight text-pretty text-foreground' style={SERIF}>
          {name ? `Hi, ${name.split(' ')[0]}` : 'Your account'}
        </h1>
        <p className='text-sm text-muted-foreground'>{email}</p>
      </div>

      <Section title='Plan' description='$99 per month covers every Mac and iPhone on your account.'>
        <PlanStatus entitlement={entitlement} subscription={subscription} />
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
          <SubscribeLink className={cn(isPro ? SECONDARY : PRIMARY, 'w-auto px-5')}>
            {isPro ? 'Manage subscription' : 'Subscribe for $99/month'}
          </SubscribeLink>
          <span className='text-xs text-muted-foreground'>
            {isPro ? 'Change card, get invoices or cancel in Stripe.' : 'Secure checkout with Stripe. Cancel anytime.'}
          </span>
        </div>
      </Section>

      <Section title='MCP server' description='Add this URL as a remote MCP server in Claude, Cursor or opencode.'>
        <CopyField value={mcpUrl} />
      </Section>

      <Section title='Macs' description='Macs signed in with this account. MCP clients reach the iPhones on online Macs; use the MCP name to pick one.'>
        {macs.length ? (
          <ul className='flex flex-col divide-y divide-border rounded-xl border border-border'>
            {macs.map((mac) => (
              <li key={mac.sessionId} className='flex items-center gap-4 px-4 py-3.5'>
                <span className={cn('size-2 shrink-0 rounded-full', mac.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')} aria-hidden />
                <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
                  <span className='truncate text-sm font-medium text-foreground'>{mac.name}</span>
                  <span className='flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground'>
                    {mac.slug ? <code className='font-mono text-foreground/80'>{mac.slug}</code> : null}
                    {mac.slug ? <span aria-hidden>·</span> : null}
                    {mac.version ? <span className='tabular-nums'>v{mac.version}</span> : null}
                    {mac.version ? <span aria-hidden>·</span> : null}
                    <span className='whitespace-nowrap'>Signed in {formatDay(mac.signedInAt)}</span>
                  </span>
                </div>
                <span className={cn('whitespace-nowrap text-xs', mac.online ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                  {mac.online ? 'Online' : `Last seen ${formatDay(mac.lastUsedAt)}`}
                </span>
                <RowAction action={signOutMac} name='sessionId' value={mac.sessionId} pendingText='Signing out…'>Sign out</RowAction>
              </li>
            ))}
          </ul>
        ) : (
          <div className='rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-balance text-muted-foreground'>
            No Mac yet. Run <code className='font-mono text-foreground'>npx ghosthand setup</code> and click Sign in with Google.
          </div>
        )}
      </Section>

      <Section title='Get started' description='Give your agent the skill or the MCP server, then connect the iPhone once.'>
        <QuickStart mcpUrl={mcpUrl} />
      </Section>

      <footer className='mt-auto flex gap-6 border-t border-border pt-6 text-sm text-muted-foreground'>
        <Link href='/' className='hover:text-foreground'>Docs</Link>
        <a href='https://github.com/remorses/ghosthand' className='hover:text-foreground'>GitHub</a>
        {/* A holocron page: Link's typed routes only know this app's pages. */}
        <a href='/docs/privacy' className='hover:text-foreground'>Privacy</a>
      </footer>
    </div>
  )
}
