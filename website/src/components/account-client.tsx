// Client pieces of the account pages: buttons with pending states.
'use client'

import { useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createAuthClient } from 'better-auth/react'
import { ErrorBoundary } from 'spiceflow/react'
import { PRIMARY, SECONDARY } from './button-styles.ts'


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

/** Full-page navigation: /login/google builds the OAuth redirect with its state cookie. */
export function GoogleSignInButton({ href }: { href: string }) {
  const [loading, setLoading] = useState(false)
  return (
    <button
      type='button'
      className={SECONDARY}
      disabled={loading}
      onClick={() => {
        setLoading(true)
        window.location.href = href
      }}
    >
      <GoogleMark />
      {loading ? 'Opening Google…' : 'Continue with Google'}
    </button>
  )
}

export function SignOutButton() {
  const [loading, setLoading] = useState(false)
  return (
    <button
      type='button'
      disabled={loading}
      className='text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 cursor-pointer'
      onClick={async () => {
        setLoading(true)
        await createAuthClient().signOut()
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

type DeviceAction = (formData: FormData) => Promise<void>

export function DeviceButtons({ userCode, approve, deny }: { userCode: string; approve: DeviceAction; deny: DeviceAction }) {
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
      <SubmitButton className='text-sm text-neutral-500 hover:text-red-600 cursor-pointer disabled:cursor-wait' pendingText={pendingText}>
        {children}
      </SubmitButton>
    </form>
  )
}

const TABS = ['CLI', 'MCP'] as const
const QUICK_START = {
  CLI: [
    { note: 'Give your agent the skill', code: 'npx -y skills add https://ghosthand.dev -g -y' },
    { note: 'On the Mac with the iPhone: sign in, allow access, plug in, pair', code: 'npx ghosthand setup' },
    { note: 'Then ask your agent', code: 'Take a screenshot of my iPhone and tell me what you see.' },
  ],
  MCP: [
    { note: 'Claude Code', code: 'claude mcp add ghosthand -- npx -y ghosthand mcp' },
    { note: 'Cursor (mcp.json)', code: '{ "mcpServers": { "ghosthand": { "command": "npx", "args": ["-y", "ghosthand", "mcp"] } } }' },
    { note: 'On the Mac with the iPhone, once', code: 'npx ghosthand setup' },
  ],
} as const

export function QuickStart() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('CLI')
  return (
    <div className='flex flex-col gap-6'>
      <div className='flex gap-1 self-start rounded-lg bg-neutral-100 p-1 dark:bg-neutral-900'>
        {TABS.map((name) => (
          <button
            key={name}
            type='button'
            onClick={() => setTab(name)}
            className={`cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              tab === name ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100' : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <ol className='flex flex-col gap-5 text-sm text-neutral-600 dark:text-neutral-400'>
        {QUICK_START[tab].map((step, i) => (
          <li key={step.code} className='flex flex-col gap-2'>
            <span><span className='tabular-nums text-neutral-400'>{i + 1}.</span> {step.note}</span>
            <code className='block overflow-x-auto whitespace-pre rounded-lg bg-neutral-100 px-4 py-3 font-mono text-[13px] text-neutral-800 dark:bg-neutral-900 dark:text-neutral-200'>
              {step.code}
            </code>
          </li>
        ))}
      </ol>
    </div>
  )
}
