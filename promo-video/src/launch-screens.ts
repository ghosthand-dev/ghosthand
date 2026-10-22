// iOS screens on the 3D iPhone (dark mode), drawn with Canvas 2D in a flat illustrated style.
// Coordinates are iPhone SE points (375×667); the canvas is 2.4x for close-ups.

export type ScreenState =
  | { kind: 'off' }
  | { kind: 'lock'; brightness: number }
  | { kind: 'passcode'; filled: number; pressed: number; press: number }
  | { kind: 'trust'; press: number }
  | { kind: 'bluetooth'; alert: number; press: number; connected: boolean }
  | { kind: 'home'; pointer?: { x: number; y: number; press: number; opacity: number }; typed?: string }

const PT_W = 375
const PT_H = 667
const SCALE = 2.4
const FONT = '"DM Sans Variable", system-ui, sans-serif'
const INDIGO = '#4f46e5'
const IOS_BLUE = '#0a84ff'
/** iOS dark mode table cell and secondary label colors. */
const CELL = '#1c1c1e'
const SECONDARY = '#8d8d93'

export function createScreen() {
  const canvas = document.createElement('canvas')
  canvas.width = PT_W * SCALE
  canvas.height = PT_H * SCALE
  const ctx = canvas.getContext('2d')!
  let lastKey = ''

  /** Draws `state`; returns true when the canvas changed and the texture needs an upload. */
  function draw(state: ScreenState) {
    const key = JSON.stringify(state)
    if (key === lastKey) return false
    lastKey = key
    ctx.save()
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0)
    ctx.clearRect(0, 0, PT_W, PT_H)
    ctx.fillStyle = '#0d0b0a'
    ctx.fillRect(0, 0, PT_W, PT_H)
    if (state.kind === 'lock') lock(ctx, state.brightness)
    if (state.kind === 'passcode') passcode(ctx, state)
    if (state.kind === 'trust') trust(ctx, state.press)
    if (state.kind === 'bluetooth') bluetooth(ctx, state)
    if (state.kind === 'home') home(ctx, state)
    ctx.restore()
    return true
  }

  return { canvas, draw }
}

// ---------------------------------------------------------------- pieces

type Ctx = CanvasRenderingContext2D

function font(ctx: Ctx, size: number, weight = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`
}

function text(ctx: Ctx, s: string, x: number, y: number, { size = 15, weight = 400, color = '#fff', align = 'center' as CanvasTextAlign } = {}) {
  font(ctx, size, weight)
  ctx.fillStyle = color
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(s, x, y)
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
  ctx.fillStyle = fill
  ctx.fill()
}

/** Indigo dusk with hills: the wallpaper of every screen. */
function wallpaper(ctx: Ctx, { blur = 0, dim = 0 } = {}) {
  ctx.save()
  if (blur) ctx.filter = `blur(${blur}px)`
  const sky = ctx.createLinearGradient(0, 0, 0, PT_H)
  sky.addColorStop(0, '#14123a')
  sky.addColorStop(0.5, '#4f46e5')
  sky.addColorStop(1, '#a5b4fc')
  ctx.fillStyle = sky
  ctx.fillRect(-40, -40, PT_W + 80, PT_H + 80)
  ctx.fillStyle = '#c7d2fe'
  ctx.beginPath()
  ctx.arc(250, 300, 56, 0, Math.PI * 2)
  ctx.fill()
  const hill = (y: number, amp: number, color: string, phase: number) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.moveTo(-40, PT_H + 40)
    for (let x = -40; x <= PT_W + 40; x += 10) ctx.lineTo(x, y + Math.sin(x / 70 + phase) * amp)
    ctx.lineTo(PT_W + 40, PT_H + 40)
    ctx.fill()
  }
  hill(420, 22, '#6d63f0', 0.4)
  hill(480, 26, '#3f37c9', 2.1)
  hill(545, 20, '#2b2590', 4)
  hill(610, 14, '#1b1760', 1.3)
  ctx.restore()
  if (dim) {
    ctx.fillStyle = `rgba(6, 5, 16, ${dim})`
    ctx.fillRect(0, 0, PT_W, PT_H)
  }
}

function statusBar(ctx: Ctx, color = '#fff') {
  text(ctx, '9:41', PT_W / 2, 11, { size: 12, weight: 600, color })
  ctx.fillStyle = color
  for (let i = 0; i < 4; i++) ctx.fillRect(8 + i * 5, 14 - (i + 1) * 2.4, 3, (i + 1) * 2.4)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.roundRect(PT_W - 32, 6.5, 22, 10, 2.5)
  ctx.stroke()
  ctx.fillRect(PT_W - 30, 8.5, 16, 6)
}

function lock(ctx: Ctx, brightness: number) {
  wallpaper(ctx)
  statusBar(ctx)
  // padlock
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2.2
  ctx.beginPath()
  ctx.arc(PT_W / 2, 48, 5.5, Math.PI, 0)
  ctx.stroke()
  roundRect(ctx, PT_W / 2 - 8, 48, 16, 12, 2.5, '#fff')
  text(ctx, '9:41', PT_W / 2, 128, { size: 84, weight: 250 })
  text(ctx, 'Thursday, October 22', PT_W / 2, 180, { size: 19, weight: 400 })
  text(ctx, 'Press home to unlock', PT_W / 2, 640, { size: 15, weight: 400 })
  if (brightness < 1) {
    ctx.fillStyle = `rgba(0, 0, 0, ${1 - brightness})`
    ctx.fillRect(0, 0, PT_W, PT_H)
  }
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '']
const LETTERS = ['', 'A B C', 'D E F', 'G H I', 'J K L', 'M N O', 'P Q R S', 'T U V', 'W X Y Z', '', '', '']

export function keyCenter(index: number) {
  const col = index % 3
  const row = Math.floor(index / 3)
  return { x: PT_W / 2 + (col - 1) * 98, y: 270 + row * 92 }
}

function passcode(ctx: Ctx, s: { filled: number; pressed: number; press: number }) {
  wallpaper(ctx, { blur: 22, dim: 0.42 })
  statusBar(ctx)
  text(ctx, 'Enter Passcode', PT_W / 2, 120, { size: 20, weight: 400 })
  for (let i = 0; i < 6; i++) {
    const x = PT_W / 2 + (i - 2.5) * 24
    ctx.beginPath()
    ctx.arc(x, 160, 6.5, 0, Math.PI * 2)
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 1.2
    ctx.stroke()
    if (i < s.filled) {
      ctx.fillStyle = '#fff'
      ctx.fill()
    }
  }
  KEYS.forEach((k, i) => {
    if (!k) return
    const { x, y } = keyCenter(i)
    ctx.beginPath()
    ctx.arc(x, y, 38, 0, Math.PI * 2)
    ctx.fillStyle = i === s.pressed ? `rgba(255, 255, 255, ${0.22 + 0.55 * s.press})` : 'rgba(255, 255, 255, 0.22)'
    ctx.fill()
    text(ctx, k, x, LETTERS[i] ? y - 6 : y, { size: 34, weight: 300 })
    if (LETTERS[i]) text(ctx, LETTERS[i], x, y + 17, { size: 9, weight: 600 })
  })
  text(ctx, 'Emergency', 60, 640, { size: 15 })
  text(ctx, 'Cancel', PT_W - 60, 640, { size: 15 })
}

const APPS = [
  ['#f2b84b', 'Notes'], ['#6fbf73', 'Messages'], [INDIGO, 'Photos'], ['#5aa1e3', 'Mail'],
  ['#9c7bd6', 'Podcasts'], ['#ee6b6e', 'Music'], ['#8d8a86', 'Settings'], ['#f29a4a', 'Books'],
  ['#3a3632', 'TikTok'], ['#e85d9a', 'Instagram'], ['#58c4c6', 'Maps'], ['#7f9a52', 'Wallet'],
  ['#f0c64e', 'Weather'], ['#5c78d6', 'Files'], ['#c9744f', 'Safari'], ['#61b58a', 'Phone'],
] as const

export function appCenter(index: number) {
  return { x: 50 + (index % 4) * 92, y: 70 + Math.floor(index / 4) * 96 }
}

function appIcon(ctx: Ctx, x: number, y: number, color: string, i: number) {
  roundRect(ctx, x - 30, y - 30, 60, 60, 14, color)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)'
  ctx.beginPath()
  // simple glyph per app so the grid reads as apps, not squares
  const g = i % 4
  if (g === 0) ctx.roundRect(x - 14, y - 14, 28, 28, 6)
  if (g === 1) ctx.arc(x, y, 14, 0, Math.PI * 2)
  if (g === 2) {
    ctx.moveTo(x, y - 16)
    ctx.lineTo(x + 15, y + 12)
    ctx.lineTo(x - 15, y + 12)
    ctx.closePath()
  }
  if (g === 3) ctx.roundRect(x - 16, y - 7, 32, 14, 7)
  ctx.fill()
}

function home(ctx: Ctx, s: Extract<ScreenState, { kind: 'home' }>) {
  wallpaper(ctx)
  statusBar(ctx)
  APPS.forEach(([color, name], i) => {
    const { x, y } = appCenter(i)
    appIcon(ctx, x, y, color, i)
    text(ctx, name, x, y + 42, { size: 11, weight: 500 })
  })
  roundRect(ctx, 10, 568, PT_W - 20, 90, 24, 'rgba(230, 232, 255, 0.28)')
  ;['#61b58a', '#5aa1e3', '#c9744f', '#ee6b6e'].forEach((c, i) => appIcon(ctx, 50 + i * 92, 613, c, i + 1))

  if (s.typed !== undefined) {
    roundRect(ctx, 0, 0, PT_W, PT_H, 0, 'rgba(6, 5, 16, 0.45)')
    roundRect(ctx, 16, 40, PT_W - 32, 38, 12, 'rgba(58, 58, 66, 0.92)')
    text(ctx, s.typed || 'Search', 46, 59, { size: 16, color: s.typed ? '#ffffff' : '#98989f', align: 'left' })
  }

  if (s.pointer && s.pointer.opacity > 0) {
    // AssistiveTouch pointer: grey disc that shrinks on a press
    const { x, y, press, opacity } = s.pointer
    ctx.beginPath()
    ctx.arc(x, y, 13 * (1 - 0.25 * press), 0, Math.PI * 2)
    ctx.fillStyle = `rgba(90, 84, 80, ${0.6 * opacity})`
    ctx.fill()
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.9 * opacity})`
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

/** Two-button iOS alert in the middle of the screen. `press` highlights the right button. */
function alert(ctx: Ctx, { title, message, left, right, press, opacity }: { title: string; message: string[]; left: string; right: string; press: number; opacity: number }) {
  ctx.save()
  ctx.globalAlpha = opacity
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.fillRect(0, 0, PT_W, PT_H)
  const w = 270
  const h = 96 + message.length * 17
  const x = (PT_W - w) / 2
  const y = (PT_H - h) / 2
  const scale = 1.08 - 0.08 * opacity
  ctx.translate(PT_W / 2, PT_H / 2)
  ctx.scale(scale, scale)
  ctx.translate(-PT_W / 2, -PT_H / 2)
  roundRect(ctx, x, y, w, h, 14, 'rgba(44, 44, 48, 0.97)')
  text(ctx, title, PT_W / 2, y + 26, { size: 17, weight: 600 })
  message.forEach((line, i) => text(ctx, line, PT_W / 2, y + 50 + i * 17, { size: 13 }))
  const by = y + h - 44
  ctx.fillStyle = 'rgba(255, 255, 255, 0.16)'
  ctx.fillRect(x, by, w, 0.7)
  ctx.fillRect(PT_W / 2, by, 0.7, 44)
  if (press > 0) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.14 * press})`
    ctx.fillRect(PT_W / 2, by, w / 2, 44)
  }
  text(ctx, left, x + w / 4, by + 22, { size: 17, color: IOS_BLUE })
  text(ctx, right, x + (w * 3) / 4, by + 22, { size: 17, weight: 600, color: IOS_BLUE })
  ctx.restore()
}

export const TRUST_BUTTON = { x: PT_W / 2 + 270 / 4, y: PT_H / 2 + (96 + 34) / 2 - 22 }
export const PAIR_BUTTON = { x: PT_W / 2 + 270 / 4, y: PT_H / 2 + (96 + 34) / 2 - 22 }

function trust(ctx: Ctx, press: number) {
  home(ctx, { kind: 'home' })
  alert(ctx, {
    title: 'Trust This Computer?',
    message: ['Your settings and data will be', 'accessible from this computer.'],
    left: 'Don’t Trust',
    right: 'Trust',
    press,
    opacity: 1,
  })
}

function bluetooth(ctx: Ctx, s: { alert: number; press: number; connected: boolean }) {
  ctx.fillStyle = '#000000'
  ctx.fillRect(0, 0, PT_W, PT_H)
  statusBar(ctx)
  text(ctx, '‹ Settings', 10, 44, { size: 17, color: IOS_BLUE, align: 'left' })
  text(ctx, 'Bluetooth', PT_W / 2, 44, { size: 17, weight: 600 })
  roundRect(ctx, 0, 84, PT_W, 46, 0, CELL)
  text(ctx, 'Bluetooth', 16, 107, { size: 17, align: 'left' })
  roundRect(ctx, PT_W - 67, 92, 51, 31, 15.5, '#34c759')
  ctx.beginPath()
  ctx.arc(PT_W - 31.5, 107.5, 13.5, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()

  let y = 160
  if (s.connected) {
    text(ctx, 'MY DEVICES', 16, y, { size: 13, color: SECONDARY, align: 'left' })
    roundRect(ctx, 0, y + 14, PT_W, 46, 0, CELL)
    text(ctx, 'Mac mini', 16, y + 37, { size: 17, align: 'left' })
    text(ctx, 'Connected', PT_W - 44, y + 37, { size: 17, color: SECONDARY, align: 'right' })
    ctx.beginPath()
    ctx.arc(PT_W - 24, y + 37, 9, 0, Math.PI * 2)
    ctx.strokeStyle = IOS_BLUE
    ctx.lineWidth = 1.3
    ctx.stroke()
    text(ctx, 'i', PT_W - 24, y + 37, { size: 12, weight: 700, color: IOS_BLUE })
    y += 90
  }
  text(ctx, 'OTHER DEVICES', 16, y, { size: 13, color: SECONDARY, align: 'left' })
  roundRect(ctx, 0, y + 14, PT_W, 46, 0, CELL)
  text(ctx, s.connected ? 'AirPods' : 'Mac mini', 16, y + 37, { size: 17, align: 'left' })

  if (s.alert > 0) {
    alert(ctx, {
      title: 'Bluetooth Pairing Request',
      message: ['“Mac mini” would like to pair', 'with your iPhone.'],
      left: 'Cancel',
      right: 'Pair',
      press: s.press,
      opacity: s.alert,
    })
  }
}

export const SCREEN_POINTS = { w: PT_W, h: PT_H }
