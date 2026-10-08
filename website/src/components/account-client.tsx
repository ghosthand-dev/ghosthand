// Client pieces of the account pages: buttons with pending states.
'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createAuthClient } from 'better-auth/react'
import { oauthProviderClient } from '@better-auth/oauth-provider/client'
import { ErrorBoundary } from 'spiceflow/react'
import { cn } from '../lib/utils.ts'
import { PRIMARY, SECONDARY } from './button-styles.ts'

// oauthProviderClient sends the signed oauth_query of /login with sign-in, so after Google
// better-auth resumes an MCP client's authorize request and goes to /consent.
const authClient = createAuthClient({ plugins: [oauthProviderClient()] })

function GoogleMark() {
  return (
    <svg viewBox='0 0 24 24' className='size-4' aria-hidden>
      <path fill='#4285F4' d='M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z' />
      <path fill='#34A853' d='M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z' />
      <path fill='#FBBC05' d='M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z' />
      <path fill='#EA4335' d='M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z' />
    </svg>
  )
}

export function GoogleSignInButton({ callbackURL }: { callbackURL: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button
        type='button'
        className={SECONDARY}
        disabled={loading}
        onClick={async () => {
          setLoading(true)
          setError(null)
          // Navigates to Google on success.
          const { error } = await authClient.signIn.social({ provider: 'google', callbackURL })
          if (error) {
            setError(error.message || 'Cannot open Google sign-in. Try again.')
            setLoading(false)
          }
        }}
      >
        <GoogleMark />
        {loading ? 'Opening Google…' : 'Continue with Google'}
      </button>
      {error ? <p className='text-sm text-red-600'>{error}</p> : null}
    </>
  )
}

export function SignOutButton() {
  const [loading, setLoading] = useState(false)
  return (
    <button
      type='button'
      disabled={loading}
      className='cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait'
      onClick={async () => {
        setLoading(true)
        await authClient.signOut()
        window.location.href = '/login'
      }}
    >
      {loading ? 'Signing out…' : 'Sign out'}
    </button>
  )
}

function SubmitButton({ className, children, pendingText }: { className: string; children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus()
  return (
    <button type='submit' className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  )
}

type FormAction = (formData: FormData) => Promise<void>

export function DeviceButtons({ userCode, approve, deny }: { userCode: string; approve: FormAction; deny: FormAction }) {
  return (
    <ErrorBoundary
      fallback={
        <div className='flex flex-col gap-2 text-sm text-red-600'>
          <ErrorBoundary.ErrorMessage />
          <ErrorBoundary.ResetButton className='underline underline-offset-4'>Try again</ErrorBoundary.ResetButton>
        </div>
      }
    >
      <div className='flex w-full flex-col gap-2'>
        <form action={approve}>
          <input type='hidden' name='userCode' value={userCode} />
          <SubmitButton className={PRIMARY} pendingText='Approving…'>Approve this Mac</SubmitButton>
        </form>
        <form action={deny}>
          <input type='hidden' name='userCode' value={userCode} />
          <SubmitButton className={SECONDARY} pendingText='Denying…'>Deny</SubmitButton>
        </form>
      </div>
    </ErrorBoundary>
  )
}

export function ConsentButtons({ oauthQuery, consent }: { oauthQuery: string; consent: FormAction }) {
  return (
    <ErrorBoundary
      fallback={
        <div className='flex flex-col gap-2 text-sm text-red-600'>
          <ErrorBoundary.ErrorMessage />
          <ErrorBoundary.ResetButton className='underline underline-offset-4'>Try again</ErrorBoundary.ResetButton>
        </div>
      }
    >
      <div className='flex w-full flex-col gap-2'>
        <form action={consent}>
          <input type='hidden' name='oauthQuery' value={oauthQuery} />
          <input type='hidden' name='accept' value='true' />
          <SubmitButton className={PRIMARY} pendingText='Allowing…'>Allow</SubmitButton>
        </form>
        <form action={consent}>
          <input type='hidden' name='oauthQuery' value={oauthQuery} />
          <input type='hidden' name='accept' value='false' />
          <SubmitButton className={SECONDARY} pendingText='Denying…'>Deny</SubmitButton>
        </form>
      </div>
    </ErrorBoundary>
  )
}

/** A value in a code box with a Copy button. */
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className='flex items-center gap-2 rounded-lg border border-border bg-muted/60 py-1.5 pl-4 pr-1.5'>
      <code className='flex-1 overflow-x-auto whitespace-pre font-mono text-[13px] text-foreground'>{value}</code>
      <button
        type='button'
        className='h-7 shrink-0 cursor-pointer rounded-md border border-border bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
        onClick={async () => {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** A small inline form button, e.g. "Sign out" on a Mac row. */
export function RowAction({ action, name, value, children, pendingText }: {
  action: (formData: FormData) => Promise<void>
  name: string
  value: string
  children: React.ReactNode
  pendingText: string
}) {
  return (
    <form action={action}>
      <input type='hidden' name={name} value={value} />
      <SubmitButton
        className='h-8 cursor-pointer whitespace-nowrap rounded-md border border-border px-3 text-xs font-medium text-muted-foreground transition-colors outline-none hover:border-red-500/40 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait dark:hover:text-red-400'
        pendingText={pendingText}
      >
        {children}
      </SubmitButton>
    </form>
  )
}

const TABS = ['CLI', 'MCP'] as const

function quickStart(mcpUrl: string) {
  return {
    CLI: [
      { note: 'Give your agent the skill', code: 'npx -y skills add https://ghosthand.dev -g -y' },
      { note: 'On the Mac with the iPhone: sign in, allow access, plug in, pair', code: 'npx ghosthand setup' },
      { note: 'Then ask your agent', code: 'Take a screenshot of my iPhone and tell me what you see.' },
    ],
    MCP: [
      { note: 'On the Mac with the iPhone, once', code: 'npx ghosthand setup' },
      { note: 'Claude Code', code: `claude mcp add --transport http ghosthand ${mcpUrl}` },
      { note: 'Cursor (mcp.json)', code: `{ "mcpServers": { "ghosthand": { "url": "${mcpUrl}" } } }` },
    ],
  }
}

export function QuickStart({ mcpUrl }: { mcpUrl: string }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('CLI')
  return (
    <div className='flex flex-col gap-6'>
      <div className='flex gap-1 self-start rounded-lg border border-border bg-muted/60 p-1' role='tablist'>
        {TABS.map((name) => (
          <button
            key={name}
            type='button'
            role='tab'
            aria-selected={tab === name}
            onClick={() => setTab(name)}
            className={cn(
              'cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring',
              tab === name && 'bg-background text-foreground ring-1 ring-border',
              tab !== name && 'text-muted-foreground hover:text-foreground',
            )}
          >
            {name}
          </button>
        ))}
      </div>
      <ol className='flex flex-col gap-6'>
        {quickStart(mcpUrl)[tab].map((step, i) => (
          <li key={step.code} className='flex gap-4'>
            <span className='flex size-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-medium tabular-nums text-muted-foreground'>
              {i + 1}
            </span>
            <div className='flex min-w-0 flex-1 flex-col gap-2 pt-0.5'>
              <span className='text-sm text-foreground'>{step.note}</span>
              <CopyField value={step.code} />
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
