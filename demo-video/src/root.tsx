import { Composition, registerRoot } from 'remotion'
import { AgentDemo, demoSchedule, type AgentDemoProps, type PlanItem } from './scene.tsx'
import type { Timeline } from './timeline.ts'
import tiktok from '../public/tiktok/timeline.json'
import tiktokWarmup from '../public/tiktok-warmup/timeline.json'

const FPS = 30

const defaults: Omit<AgentDemoProps, 'timeline' | 'plan'> = {
  title: 'claude — ~/ghosthand',
  toolName: 'Bash',
  background: 'backgrounds/blue-sky.jpg',
  greeting: 'ghosthand is set up and ready on your iPhone. What would you like to do?',
  tagline: 'Let AI agents control a real iPhone',
  url: 'ghosthand.dev',
  phoneLabel: 'Your real iPhone',
}

const tiktokPlan: PlanItem[] = [
  { text: 'Open TikTok', from: 'Opening TikTok' },
  { text: 'Pick the video from Photos', from: 'Creating a new TikTok post' },
  { text: 'Write the caption', from: 'Opening the caption editor' },
  { text: 'Post it publicly', from: 'Publishing the video' },
  { text: 'Check the post is live', from: 'Checking the uploaded video' },
]

const demos: { id: string; timeline: Timeline; plan: PlanItem[] }[] = [
  { id: 'tiktok', timeline: tiktok, plan: tiktokPlan },
  // same run with the prompt typed in the launch video intro (promo-video/src/launch.ts)
  { id: 'tiktok-launch', timeline: { ...tiktok, prompt: "upload this video to tiktok using the app (so we don't get shadowbanned)" }, plan: tiktokPlan },
  {
    id: 'tiktok-warmup',
    timeline: tiktokWarmup,
    plan: [
      { text: 'Open TikTok', from: 'Opening TikTok' },
      { text: 'Skip videos that are not funny', from: 'Switching to the For You feed' },
      { text: 'Like and comment on a funny video', from: 'This biscuit reaction' },
      { text: 'Find another funny one', from: 'Looking for another funny clip' },
      { text: 'Like and comment on it', from: 'This dancing robot meme' },
    ],
  },
]

function Root() {
  return (
    <>
      {demos.map(({ id, timeline, plan }) => (
        <Composition
          key={id}
          id={id}
          component={AgentDemo}
          fps={FPS}
          width={1920}
          height={1080}
          durationInFrames={Math.round(demoSchedule(timeline).total * FPS)}
          defaultProps={{ ...defaults, timeline, plan }}
        />
      ))}
    </>
  )
}

registerRoot(Root)
