// Synthesizes the UI sound effects into public/sfx/ as 16-bit mono WAV files.
// No samples, no licenses: every sound is a few lines of math. Run: pnpm tsx scripts/make-sounds.ts
import fs from 'node:fs'
import path from 'node:path'

const RATE = 44100
const outDir = path.join(import.meta.dirname, '..', 'public', 'sfx')

type Voice = (t: number) => number

function render(seconds: number, voice: Voice): Float32Array {
  const samples = new Float32Array(Math.round(seconds * RATE))
  for (let i = 0; i < samples.length; i++) samples[i] = voice(i / RATE)
  return samples
}

function wav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), i * 2))
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(1, 22) // mono
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

// Deterministic noise, so the files do not change on every run.
function noise(seed: number): () => number {
  let x = seed
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296
    return (x / 4294967296) * 2 - 1
  }
}

const sine = (freq: number, t: number) => Math.sin(2 * Math.PI * freq * t)
// Attack in seconds, then exponential decay with the given time constant.
const env = (t: number, attack: number, decay: number) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / decay)

// Soft keyboard tick: a short high-passed noise burst, no low thump.
function keyClick(seed: number, tone: number): Float32Array {
  const rand = noise(seed)
  let low = 0
  return render(0.035, (t) => {
    const n = rand()
    low += 0.2 * (n - low) // subtracting the low-passed part keeps only the high "tick"
    const tick = (n - low) * env(t, 0.0008, 0.0035) * 0.22
    const body = sine(tone, t) * env(t, 0.001, 0.006) * 0.05
    return tick + body
  })
}

// Soft sine with a gentle attack and a short glide, for tool calls and results.
function blip(from: number, to: number, seconds: number, gain: number): Float32Array {
  let phase = 0
  return render(seconds, (t) => {
    const freq = from + (to - from) * Math.min(1, t / (seconds * 0.5))
    phase += (2 * Math.PI * freq) / RATE
    return Math.sin(phase) * env(t, 0.008, seconds / 5) * gain
  })
}

// Bell chord with staggered notes, for the final success.
function chime(): Float32Array {
  const notes = [1046.5, 1318.5, 1568]
  return render(1.4, (t) =>
    notes.reduce((sum, freq, i) => {
      const start = i * 0.09
      if (t < start) return sum
      const local = t - start
      return sum + sine(freq, local) * env(local, 0.01, 0.3) * 0.07
    }, 0),
  )
}

// Airy swoosh: high band noise with a smooth envelope, for sending the prompt.
function swoosh(): Float32Array {
  const rand = noise(7)
  let low = 0
  let smooth = 0
  const seconds = 0.4
  return render(seconds, (t) => {
    const n = rand()
    low += 0.08 * (n - low)
    smooth += 0.5 * (n - low - smooth)
    return smooth * Math.sin((Math.PI * t) / seconds) ** 2 * 0.22
  })
}

// Light glassy tick for finger taps on the phone.
function tapPop(): Float32Array {
  return render(0.08, (t) => (sine(1750, t) + 0.4 * sine(2620, t)) * env(t, 0.002, 0.012) * 0.12)
}

const sounds: Record<string, Float32Array> = {
  'key-1': keyClick(1, 2400),
  'key-2': keyClick(2, 2600),
  'key-3': keyClick(3, 2250),
  'key-4': keyClick(4, 2800),
  tool: blip(1320, 1560, 0.12, 0.08),
  result: blip(1480, 1320, 0.1, 0.05),
  send: swoosh(),
  tap: tapPop(),
  success: chime(),
}

fs.mkdirSync(outDir, { recursive: true })
for (const [name, samples] of Object.entries(sounds)) {
  const file = path.join(outDir, `${name}.wav`)
  fs.writeFileSync(file, wav(samples))
  console.log(`wrote ${path.relative(process.cwd(), file)} (${(samples.length / RATE).toFixed(2)}s)`)
}
