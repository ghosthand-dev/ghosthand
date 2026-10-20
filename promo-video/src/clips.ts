// iPhone screen recordings shown in the phone mockup. scripts/render.ts extracts them to
// out/clips/<name>/00001.jpg... and passes the frame counts to the page as window.clipFrames.

export const CLIP_FPS = 30
export const CLIP_WIDTH = 420

export const CLIPS = [
  { name: 'upload', src: '../demo-video/public/tiktok/phone.mp4' },
  { name: 'warmup', src: '../demo-video/public/tiktok-warmup/phone.mp4' },
] as const

export type ClipName = (typeof CLIPS)[number]['name']
