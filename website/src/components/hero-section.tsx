// Page-width hero with an ASCII VideoBackgroundShader, serif title, and a copy-setup-prompt CTA.
'use client'

import { useState, useSyncExternalStore } from 'react'
import { preload } from 'react-dom'
import { VideoBackgroundShader } from '@holocron.so/vite/mdx'
import dedent from 'string-dedent'
import { Link, router } from 'spiceflow/react'
import { cn } from '../lib/utils.ts'

const HERO_FONT = "'IvarText', serif"

const SETUP_PROMPT = dedent`
  # Set up Ghosthand

  Set up ghosthand so you can control my iPhone.

  ## Before you start

  - Tell me that Ghosthand requires a **Mac** and that I must connect my iPhone to it with a **USB cable**.
  - This prompt requires the **harness sandbox to be disabled** so Ghosthand can install and launch its Mac app and daemon outside the current workspace.
  - For example, in **Codex**, select **Full access** in the permissions menu below the message box before running these commands.
  - If the sandbox is still enabled, ask me to change it before continuing.

  ## Open setup

  Run \`npx -y ghosthand@latest setup\`. It opens the small Ghosthand setup window on this Mac and starts the daemon. Tell me to complete setup in that window.

  **All actions in the setup window must be done by me, not the agent. Do not interact with the window or complete setup for me. Do not open setup again.**

  ## Learn and verify

  1. While I follow the window, install the skill: \`npx -y skills add https://ghosthand.dev -g -y\`.
  2. Read the skill to learn the CLI, and the [Ghosthand docs](https://ghosthand.dev/index.md).
  3. Poll \`npx -y ghosthand@latest setup status\` every 2 seconds until \`ready\` is true.
  4. When ready, run \`npx -y ghosthand@latest list\` and take a screenshot of my iPhone to confirm that it works.
`

// Shader color is a WebGL uniform, so CSS dark: variants cannot reach it.
// Colors sit close to the page background so the title keeps contrast.
const DOT_COLOR_LIGHT = '#9b98e6'
const DOT_COLOR_DARK = '#5d59b8'

const BUTTON =
  'inline-flex h-10 sm:h-9 items-center justify-center gap-2 rounded-lg border px-3.5 font-medium text-base sm:text-sm no-underline transition-colors'

function subscribeToThemeClass(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

export function HeroSection() {
  const [copied, setCopied] = useState(false)
  const isDark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )

  // Starts the font download from <head>. `font-display: block` in globals.css keeps
  // the title hidden until it arrives, so no JS gate (which delayed LCP to hydration).
  preload('/fonts/ivartext-regular.woff2', { as: 'font', type: 'font/woff2', crossOrigin: '' })

  return (
    <div className='relative mt-4 lg:mt-8 mb-6 lg:mb-10 w-full rounded-xl flex flex-col items-center overflow-hidden'>
      <VideoBackgroundShader
        src='/assets/hero-bg.mp4'
        className='absolute inset-0 w-full h-full'
        dotStyle='ascii'
        dotColor={isDark ? DOT_COLOR_DARK : DOT_COLOR_LIGHT}
        dotSize={9}
        minDotSize={1}
        dotMargin={1}
        animSpeed={3}
        gamma={0.8}
        enableMask={false}
      />

      {/* Soft scrim behind the title and CTAs so text stays readable over glyphs */}
      <div
        aria-hidden
        className='absolute inset-0 z-[1] pointer-events-none'
        style={{
          background:
            'radial-gradient(ellipse 45% 40% at 50% 42%, color-mix(in srgb, var(--background) 85%, transparent) 0%, color-mix(in srgb, var(--background) 60%, transparent) 50%, transparent 100%)',
        }}
      />

      <div className='relative z-[2] flex flex-col items-center justify-center text-center max-w-[820px] w-full px-5 pt-16 sm:pt-24 pb-20 lg:pb-[160px] gap-6'>
        <h1
          className='flex flex-col items-center leading-none text-[36px] sm:text-[44px] md:text-[52px] text-foreground'
          style={{ fontFamily: HERO_FONT }}
        >
          <span>iPhone control</span>
          <span>for your agent</span>
        </h1>

        <div className='flex flex-col items-center gap-2'>
          <div className='flex flex-wrap items-center justify-center gap-3'>
            <button
              type='button'
              onClick={async () => {
                await navigator.clipboard.writeText(SETUP_PROMPT)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className={cn(BUTTON, 'cursor-pointer border-transparent bg-primary text-primary-foreground hover:opacity-90')}
            >
              <svg
                aria-hidden
                viewBox='0 0 24 24'
                className='size-4 shrink-0'
                fill='none'
                stroke='currentColor'
                strokeWidth={2}
                strokeLinecap='round'
                strokeLinejoin='round'
              >
                {copied ? (
                  <path d='M20 6 9 17l-5-5' />
                ) : (
                  <>
                    <rect width='8' height='4' x='8' y='2' rx='1' ry='1' />
                    <path d='M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2' />
                  </>
                )}
              </svg>
              {copied ? 'Copied' : 'Copy setup prompt'}
            </button>
            <Link href={router.href('/download')} className={cn(BUTTON, 'border-border bg-background/70 text-foreground hover:bg-muted')}>
              Download for Mac
            </Link>
          </div>
          <p className='rounded-xl bg-background/50 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur-md'>
            Paste the prompt into your agent to set up ghosthand
          </p>
        </div>
      </div>
    </div>
  )
}
