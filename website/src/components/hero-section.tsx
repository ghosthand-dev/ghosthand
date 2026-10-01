// Page-width hero with an ASCII VideoBackgroundShader, serif title, and two CTAs.
'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { VideoBackgroundShader } from '@holocron.so/vite/mdx'

const HERO_FONT = "'IvarText', serif"
const GITHUB_URL = 'https://github.com/remorses/ghosthand'

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
  const [fontsReady, setFontsReady] = useState(false)
  const isDark = useSyncExternalStore(
    subscribeToThemeClass,
    () => document.documentElement.classList.contains('dark'),
    () => false,
  )

  useEffect(() => {
    const timeout = setTimeout(() => setFontsReady(true), 3000)
    void document.fonts.ready.then(() => setFontsReady(true))
    return () => clearTimeout(timeout)
  }, [])

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
        fluidStrength={0.2}
        fluidCurl={80}
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

      <div
        className='relative z-[2] flex flex-col items-center justify-center text-center max-w-[820px] w-full px-5 pt-16 sm:pt-24 pb-20 lg:pb-[160px] gap-6'
        style={{
          opacity: fontsReady ? 1 : 0,
          transition: 'opacity 0.3s cubic-bezier(0.23, 1, 0.32, 1)',
        }}
      >
        <h1
          className='flex flex-col items-center leading-none text-[36px] sm:text-[44px] md:text-[52px] text-foreground'
          style={{ fontFamily: HERO_FONT }}
        >
          <span>Control your iPhone</span>
          <span>with AI agents</span>
        </h1>

        <p className='max-w-[520px] text-base text-muted-foreground'>
          Screenshots over USB, taps over Bluetooth. No jailbreak, no Xcode, no app on the phone.
        </p>

        <div className='flex gap-3 flex-wrap justify-center'>
          <a href='#install' className={`${BUTTON} border-primary bg-primary text-primary-foreground hover:bg-primary/90`}>
            Install
          </a>
          <a
            href={GITHUB_URL}
            target='_blank'
            rel='noopener noreferrer'
            className={`${BUTTON} border-transparent text-foreground hover:bg-accent`}
          >
            GitHub Repo ↗
          </a>
        </div>
      </div>
    </div>
  )
}
