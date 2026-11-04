// Small helpers shared by every scene. All motion is a function of timeline time.
;(function () {
  const FPS = 30 // the source video's frame rate; measured tables are in source frames

  // Linear interpolation through rows of [frame, ...values], clamped at both ends.
  function keyframes(rows, frame) {
    if (frame <= rows[0][0]) return rows[0]
    for (let i = 1; i < rows.length; i++) {
      if (frame <= rows[i][0]) {
        const a = rows[i - 1]
        const b = rows[i]
        const k = (frame - a[0]) / (b[0] - a[0])
        return a.map((v, j) => v + (b[j] - v) * k)
      }
    }
    return rows[rows.length - 1]
  }

  // Tracking noise makes the mascot tremble: smooth position, size and rotation with a small
  // gaussian, but never across a jump (a cut or a leap of more than JUMP px in one frame).
  const SMOOTH_SIGMA = 1.8
  const SMOOTH_RADIUS = 5
  const JUMP = 40
  const SMOOTHED_COLUMNS = [0, 1, 2, 3, 4, 6, 7, 8] // not the squash angle, not blink
  const smoothed = {}
  function smoothFrames(frames) {
    const segment = [0]
    for (let i = 1; i < frames.length; i++) {
      const jump = Math.abs(frames[i][0] - frames[i - 1][0]) + Math.abs(frames[i][1] - frames[i - 1][1])
      segment.push(segment[i - 1] + (jump > JUMP ? 1 : 0))
    }
    return frames.map((row, i) => {
      const out = row.slice()
      for (const c of SMOOTHED_COLUMNS) {
        let sum = 0
        let weight = 0
        for (let d = -SMOOTH_RADIUS; d <= SMOOTH_RADIUS; d++) {
          const j = i + d
          if (j < 0 || j >= frames.length || segment[j] !== segment[i]) continue
          const w = Math.exp(-(d * d) / (2 * SMOOTH_SIGMA * SMOOTH_SIGMA))
          sum += frames[j][c] * w
          weight += w
        }
        out[c] = sum / weight
      }
      return out
    })
  }

  // A tracked mascot pose at a source frame: { x, y, R, L, W, ang, yaw, pitch, roll, blink }.
  function trackPose(name, frame) {
    const track = window.MASCOT_TRACKS[name]
    const fr = (smoothed[name] ??= smoothFrames(track.frames))
    const i = Math.max(0, Math.min(fr.length - 1, frame - track.start))
    const i0 = Math.floor(i)
    const i1 = Math.min(fr.length - 1, i0 + 1)
    const k = i - i0
    const v = fr[i0].map((x, j) => x + (fr[i1][j] - x) * k)
    let da = fr[i1][5] - fr[i0][5] // body angle is mod 180: take the short way
    if (da > 90) da -= 180
    if (da < -90) da += 180
    v[5] = fr[i0][5] + da * k
    const [x, y, R, L, W, ang, yaw, pitch, roll, blink] = v
    return { x, y, R, L, W, ang, yaw, pitch, roll, blink }
  }

  // The source's word animation: a word appears at once, slightly low, and settles up.
  function popWord(tl, target, at, { dy = 14, duration = 0.35 } = {}) {
    tl.set(target, { opacity: 1 }, at)
    tl.fromTo(target, { y: dy }, { y: 0, duration, ease: "expo.out", immediateRender: false }, at)
  }

  // One tween spanning the scene that calls draw(t) on every seek.
  function everyFrame(tl, duration, draw) {
    const clock = { t: 0 }
    tl.fromTo(clock, { t: 0 }, { t: duration, duration, ease: "none", onUpdate: () => draw(clock.t) }, 0)
  }

  // Deterministic PRNG (mulberry32).
  function random(seed) {
    let a = seed
    return () => {
      a = (a + 0x6d2b79f5) | 0
      let r = Math.imul(a ^ (a >>> 15), 1 | a)
      r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296
    }
  }

  // One beat of the music (assets/launch-music.mp3, 114.2 BPM, starts on a downbeat). Every scene
  // lasts a whole number of beats, so every cut lands on a beat.
  const BEAT = 0.5253

  // Slows parts of a scene so text can be read. slows: [[fromFrame, toFrame, extraSeconds]]: that
  // span of source frames plays over its normal time plus extraSeconds. Returns frameAt(t) for the
  // draw loop, lt(frame) for timeline positions, and the new scene duration.
  function timeMap(f0, f1, slows = []) {
    const knots = [[0, f0]]
    let t = 0
    let f = f0
    for (const [a, b, extra] of slows) {
      t += (a - f) / FPS
      knots.push([t, a])
      t += (b - a) / FPS + extra
      knots.push([t, b])
      f = b
    }
    t += (f1 - f) / FPS
    knots.push([t, f1])
    const interp = (x, from, to) => {
      if (x <= knots[0][from]) return knots[0][to] + (x - knots[0][from]) * (to ? FPS : 1 / FPS)
      for (let i = 1; i < knots.length; i++) {
        const [a, b] = [knots[i - 1], knots[i]]
        if (x <= b[from]) return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to])
      }
      const last = knots[knots.length - 1]
      return last[to] + (x - last[from]) * (to ? FPS : 1 / FPS)
    }
    return { frameAt: (sec) => interp(sec, 0, 1), lt: (frame) => interp(frame, 1, 0), duration: t }
  }

  // timeMap that stretches source frames f0..f1 to `beats` beats; the extra time is shared by the
  // spans [[fromFrame, toFrame, weight]] (where text is read).
  function stretchTo(f0, f1, beats, spans) {
    const extra = beats * BEAT - (f1 - f0) / FPS
    const total = spans.reduce((sum, [, , w]) => sum + w, 0)
    return timeMap(f0, f1, spans.map(([a, b, w]) => [a, b, (extra * w) / total]))
  }

  // Scene transitions: what leaves eases in (accelerates out of frame), what enters eases out.
  // Use them on elements that do not carry over to the next scene; never on the mascot when it
  // continues from one scene into the next.
  const EXIT_S = 0.38
  const ENTER_S = 0.65
  function slideOut(tl, targets, sceneEnd, props) {
    tl.to(targets, { ...props, opacity: 0, duration: EXIT_S, ease: "power3.in" }, sceneEnd - EXIT_S)
  }
  function slideIn(tl, targets, at, from, duration = ENTER_S) {
    const to = Object.fromEntries(Object.keys(from).map((k) => [k, 0]))
    tl.fromTo(targets, { ...from, opacity: 0 }, { ...to, opacity: 1, duration, ease: "expo.out" }, at)
  }

  window.Kit = { FPS, BEAT, EXIT_S, slideOut, slideIn, keyframes, trackPose, popWord, everyFrame, random, timeMap, stretchTo }
})()
