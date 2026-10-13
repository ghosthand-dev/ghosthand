// Modern iPhone mockup (Pro style: titanium band, thin even bezel, side buttons), drawn with CSS.
// The screen keeps the recording's aspect ratio, so nothing is cropped or letterboxed.
import type { CSSProperties, ReactNode } from 'react'
import { colors } from './terminal.tsx'

export type PhoneMockupProps = {
  /** Screen size in composition pixels. Keep the recording's aspect ratio. */
  screenWidth: number
  screenHeight: number
  /** Dynamic Island. Leave off for recordings with a centered status bar clock (iPhone SE). */
  island?: boolean
  children: ReactNode
  style?: CSSProperties
}

const BAND = 6
const BEZEL = 13

/** Outer size of the body for a screen size, to lay out a scene before rendering. */
export function phoneBodySize(screenWidth: number, screenHeight: number) {
  return { width: screenWidth + 2 * (BAND + BEZEL), height: screenHeight + 2 * (BAND + BEZEL) }
}

function SideButton({ side, top, height }: { side: 'left' | 'right'; top: number; height: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        [side]: -4,
        top,
        width: 6,
        height,
        borderRadius: 3,
        background: '#3a3a3c',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)',
      }}
    />
  )
}

export function PhoneMockup({ screenWidth, screenHeight, island = false, children, style }: PhoneMockupProps) {
  const body = phoneBodySize(screenWidth, screenHeight)
  const screenRadius = Math.round(screenWidth * 0.075)
  const bodyRadius = screenRadius + BAND + BEZEL
  const h = body.height

  return (
    <div style={{ position: 'relative', width: body.width, height: body.height, ...style }}>
      <SideButton side="left" top={h * 0.16} height={h * 0.045} />
      <SideButton side="left" top={h * 0.235} height={h * 0.075} />
      <SideButton side="left" top={h * 0.325} height={h * 0.075} />
      <SideButton side="right" top={h * 0.255} height={h * 0.11} />
      <SideButton side="right" top={h * 0.6} height={h * 0.06} />
      {/* Titanium band with a thin light edge, then the black glass bezel. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: bodyRadius,
          background: '#2c2c2e',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.22), 0 30px 80px rgba(0, 20, 60, 0.45), 0 8px 24px rgba(0, 0, 0, 0.3)',
        }}
      />
      <div style={{ position: 'absolute', inset: BAND, borderRadius: bodyRadius - BAND, background: '#050505' }} />
      <div
        style={{
          position: 'absolute',
          top: BAND + BEZEL,
          left: BAND + BEZEL,
          width: screenWidth,
          height: screenHeight,
          borderRadius: screenRadius,
          overflow: 'hidden',
          background: '#000',
        }}
      >
        {children}
        {island && (
          <div style={{ position: 'absolute', top: 11, left: '50%', width: 120, height: 35, marginLeft: -60, borderRadius: 18, background: '#000' }} />
        )}
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
