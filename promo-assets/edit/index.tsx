/* @jsxImportSource @diffusionstudio/jsx */

type Shot = { src: string; length: number; sourceIn?: number }

// Cut times follow the TapKit original (see BRIEF.md). Each clip starts where the previous one ends.
const SHOTS: Shot[] = [
  { src: "shot1-hook.mp4", length: 4.3 },
  { src: "shot2-intro.mp4", length: 5.1 },
  { src: "demo-tiktok-upload.mp4", length: 9.5, sourceIn: 6 },
  { src: "shot4-multi.mp4", length: 4.6 },
  { src: "g-three-agents-push.mp4", length: 4.4 },
  { src: "g-phone-rack-push.mp4", length: 4.4 },
  { src: "g-three-phones-push.mp4", length: 4.3 },
  { src: "shot6-anything.mp4", length: 6.6 },
  { src: "shot7-end.mp4", length: 3 },
]

const starts = SHOTS.reduce<number[]>((acc, s, i) => [...acc, i === 0 ? 0 : acc[i - 1] + SHOTS[i - 1].length], [])

export default function Project() {
  return (
    <stage background="#161616" camera={[0.3, 0, 0, 0.3, 85, 150]} id="4s7xpl">
      <scene name="ghosthand promo" width={1920} height={1080} fill="black" active id="5xx2hd">
        <sequence name="Shots" id="uz30bw">
          {SHOTS.map((s, i) => (
            <video src={s.src} width={1920} height={1080} start={starts[i]} end={starts[i] + s.length} muted id="d0h5jy" />
          ))}
        </sequence>
      </scene>
    </stage>
  )
}
