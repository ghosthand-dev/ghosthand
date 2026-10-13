import { Composition, registerRoot } from 'remotion'
import { AgentDemo, demoSchedule, type AgentDemoProps, type PlanItem } from './scene.tsx'
import type { Timeline } from './timeline.ts'
import tiktok from '../public/tiktok/timeline.json'

const FPS = 30

const defaults: Omit<AgentDemoProps, 'timeline' | 'plan'> = {
  title: 'claude — ~/ghosthand',
  cwd: '~/ghosthand',
  toolName: 'Bash',
  background: 'backgrounds/blue-sky.jpg',
  tagline: 'Let AI agents control a real iPhone',
  url: 'ghosthand.dev',
}

const demos: { id: string; timeline: Timeline; plan: PlanItem[] }[] = [
  {
    id: 'tiktok',
    timeline: tiktok,
    plan: [
      { text: 'Open TikTok', from: 'Opening TikTok' },
      { text: 'Pick the video from Photos', from: 'Creating a new TikTok post' },
      { text: 'Write the caption', from: 'Opening the caption editor' },
      { text: 'Post it publicly', from: 'Publishing the video' },
      { text: 'Check the post is live', from: 'Checking the uploaded video' },
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
