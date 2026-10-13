import { Composition, registerRoot } from 'remotion'
import { AgentDemo, demoSchedule, type AgentDemoProps } from './scene.tsx'
import type { Timeline } from './timeline.ts'
import tiktok from '../public/tiktok/timeline.json'

const FPS = 30

const defaults: Omit<AgentDemoProps, 'timeline'> = {
  title: 'claude — ~/ghosthand',
  cwd: '~/ghosthand',
  toolName: 'Bash',
  background: 'backgrounds/blue-sky.jpg',
  island: false,
  tagline: 'Let AI agents control a real iPhone',
  url: 'ghosthand.dev',
}

const demos: { id: string; timeline: Timeline }[] = [{ id: 'tiktok', timeline: tiktok as Timeline }]

function Root() {
  return (
    <>
      {demos.map(({ id, timeline }) => (
        <Composition
          key={id}
          id={id}
          component={AgentDemo}
          fps={FPS}
          width={1920}
          height={1080}
          durationInFrames={Math.round(demoSchedule(timeline).total * FPS)}
          defaultProps={{ ...defaults, timeline }}
        />
      ))}
    </>
  )
}

registerRoot(Root)
