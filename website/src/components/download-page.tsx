'use client'

import { useEffect, useRef, useState } from 'react'
import { Link } from 'spiceflow/react'
import { cn } from '../lib/utils.ts'
import { PRIMARY, SECONDARY } from './button-styles.ts'

const DOWNLOAD_URL = 'https://ghosthand.dev/download'
const INSTALLER_PATH = '/download/ghosthand.pkg'
const RELEASE_MANIFEST_PATH = '/releases/latest.json'

const STEPS = [
  'Open the installer.',
  'Sign in with the Google account of your AI chat.',
  'Plug in your iPhone and follow the window.',
]

export function DownloadPage() {
  // `no-release`: a Mac, but no installer is published yet.
  const [platform, setPlatform] = useState<'unknown' | 'mac' | 'no-release' | 'other'>('unknown')
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const started = useRef(false)

  // Browser detection and automatic navigation must run after hydration, not during render.
  useEffect(() => {
    const isMac = /Macintosh|Mac OS X/.test(navigator.userAgent)
      && !/iPhone|iPad|iPod/.test(navigator.userAgent)
      && navigator.maxTouchPoints <= 1
    if (!isMac) return setPlatform('other')
    if (started.current) return
    started.current = true
    // Check first: navigating to a missing installer would replace this page with an error.
    void fetch(RELEASE_MANIFEST_PATH).then((response) => {
      if (!response.ok) return setPlatform('no-release')
      setPlatform('mac')
      window.location.assign(INSTALLER_PATH)
    }, () => setPlatform('no-release'))
  }, [])

  return (
    <div className='not-prose flex flex-col gap-12 px-5 py-12 sm:gap-16 sm:px-8 sm:py-20'>
      <section className='flex flex-col items-center gap-6 text-center text-balance'>
        <h1 className='text-4xl leading-tight text-balance sm:text-5xl' style={{ fontFamily: "'IvarText', serif" }}>
          Download ghosthand for Mac
        </h1>
        <div className='flex w-full max-w-md flex-col items-center gap-3' aria-live='polite'>
          {platform === 'mac' ? (
            <>
              <p className='text-sm text-muted-foreground'>Downloading…</p>
              <button type='button' onClick={() => window.location.assign(INSTALLER_PATH)} className={cn(PRIMARY, 'w-auto')}>
                Download again
              </button>
            </>
          ) : platform === 'no-release' ? (
            <>
              <p className='text-sm text-muted-foreground'>
                Installer coming soon. For now, run <code className='text-foreground'>npx ghosthand setup</code> in Terminal.
              </p>
            </>
          ) : (
            <>
              <p className='font-medium'>Open this page on your Mac</p>
              <button
                type='button'
                className={cn(PRIMARY, 'w-auto')}
                disabled={platform === 'unknown'}
                onClick={async () => {
                  if (!navigator.clipboard) {
                    setCopyStatus('failed')
                    return
                  }
                  const result = await navigator.clipboard.writeText(DOWNLOAD_URL)
                    .catch((cause) => new Error('Cannot copy the link. Open ghosthand.dev/download on your Mac.', { cause }))
                  if (result instanceof Error) {
                    console.warn(result)
                    setCopyStatus('failed')
                    return
                  }
                  setCopyStatus('copied')
                }}
              >
                {copyStatus === 'copied' ? 'Link copied' : 'Copy link'}
              </button>
              {copyStatus === 'failed' ? <span className='select-all text-sm text-muted-foreground'>{DOWNLOAD_URL}</span> : null}
            </>
          )}
          <noscript>
            <Link href={INSTALLER_PATH} download className={cn(SECONDARY, 'w-auto no-underline')}>Download for Mac</Link>
          </noscript>
        </div>
      </section>

      <ol className='mx-auto flex w-full max-w-md list-none flex-col gap-4 p-0'>
        {STEPS.map((step, index) => (
          <li key={step} className='flex items-center gap-4'>
            <span className='flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground'>{index + 1}</span>
            <span className='text-base'>{step}</span>
          </li>
        ))}
      </ol>

      <img
        src='/assets/control-plane-fleet.jpg'
        alt='Ghosthand on a Mac, with connected iPhones and an AI chat'
        className='w-full rounded-xl border border-border'
        width={2688}
        height={1886}
      />
    </div>
  )
}
