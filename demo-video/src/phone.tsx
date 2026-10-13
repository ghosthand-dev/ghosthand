// iPhone SE (2nd/3rd gen) mockup drawn with CSS, to scale with the real device:
// body 67.3 x 138.4 mm, 16:9 screen 58.5 x 104 mm, 11 mm Home button.
// ghosthand phones record 750x1334, the same 16:9 screen, so recordings fit without cropping.
import type { CSSProperties, ReactNode } from 'react'
import { colors } from './terminal.tsx'

export type PhoneMockupProps = {
  /** Screen size in composition pixels. Keep the recording's aspect ratio. */
  screenWidth: number
  screenHeight: number
  children: ReactNode
  style?: CSSProperties
}

const BODY_PER_SCREEN = { width: 67.3 / 58.5, height: 138.4 / 104 }

/** Outer size of the body for a screen size, to lay out a scene before rendering. */
export function phoneBodySize(screenWidth: number, screenHeight: number) {
  return { width: screenWidth * BODY_PER_SCREEN.width, height: screenHeight * BODY_PER_SCREEN.height }
}

/** Screen height that gives a body of the wanted height. */
export function phoneScreenHeight(bodyHeight: number) {
  return bodyHeight / BODY_PER_SCREEN.height
}

export function PhoneMockup({ screenWidth, screenHeight, children, style }: PhoneMockupProps) {
  const body = phoneBodySize(screenWidth, screenHeight)
  const mm = body.width / 67.3
  const radius = 10.5 * mm
  const bezelY = (body.height - screenHeight) / 2
  const band = Math.max(3, 0.7 * mm)
  const side = (left: boolean, top: number, height: number) => (
    <div
      style={{
        position: 'absolute',
        [left ? 'left' : 'right']: -0.55 * mm,
        top: top * mm,
        width: 0.9 * mm,
        height: height * mm,
        borderRadius: 0.5 * mm,
        background: '#2a2a2c',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.14)',
      }}
    />
  )

  return (
    <div style={{ position: 'relative', width: body.width, height: body.height, ...style }}>
      {side(true, 16, 6)}
      {side(true, 27, 10)}
      {side(true, 39.5, 10)}
      {side(false, 30, 9)}
      {/* Aluminum band, then black glass front. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: radius,
          background: '#3a3a3c',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.28), 0 30px 80px rgba(0, 20, 60, 0.45), 0 8px 24px rgba(0, 0, 0, 0.3)',
        }}
      />
      <div style={{ position: 'absolute', inset: band, borderRadius: radius - band, background: '#0a0a0a', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)' }} />
      {/* Earpiece and front camera. */}
      <div style={{ position: 'absolute', top: bezelY / 2 - 0.6 * mm, left: '50%', width: 10 * mm, height: 1.2 * mm, marginLeft: -5 * mm, borderRadius: mm, background: '#1d1d1f' }} />
      <div style={{ position: 'absolute', top: bezelY / 2 - 1.1 * mm, left: '50%', width: 2.2 * mm, height: 2.2 * mm, marginLeft: -11.5 * mm, borderRadius: '50%', background: '#15171c', boxShadow: 'inset 0 0 0 1px #24262c' }} />
      {/* Home button. */}
      <div
        style={{
          position: 'absolute',
          bottom: bezelY / 2 - 5.5 * mm,
          left: '50%',
          width: 11 * mm,
          height: 11 * mm,
          marginLeft: -5.5 * mm,
          borderRadius: '50%',
          background: '#0a0a0a',
          boxShadow: `inset 0 0 0 ${0.45 * mm}px #2e2e30`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: bezelY,
          left: (body.width - screenWidth) / 2,
          width: screenWidth,
          height: screenHeight,
          overflow: 'hidden',
          background: '#000',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Expanding ring where a tap landed. Place inside PhoneMockup; `t` and `at` in seconds. */
export function TapRipple({ x, y, t, at }: { x: number; y: number; t: number; at: number }) {
  const p = (t - at) / 0.55
  if (p < 0 || p > 1) return null
  const ease = 1 - (1 - p) ** 3
  const size = 26 + 70 * ease
  return (
    <div
      style={{
        position: 'absolute',
        left: `${x * 100}%`,
        top: `${y * 100}%`,
        width: size,
        height: size,
        marginLeft: -size / 2,
        marginTop: -size / 2,
        borderRadius: '50%',
        border: `3px solid ${colors.claude}`,
        background: `rgba(217, 119, 87, ${0.3 * (1 - p)})`,
        opacity: 1 - p * p,
        pointerEvents: 'none',
      }}
    />
  )
}
