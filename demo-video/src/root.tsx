import { Composition, registerRoot } from 'remotion'
import { AgentDemo, demoSchedule, type AgentDemoProps, type PlanItem } from './scene.tsx'
import type { Timeline } from './timeline.ts'
import { AgentChips, EndCard, IconOrbit, IconRow, LogoPop, PromptCard, SplitFrame, TapDot } from './promo-graphics.tsx'
import { Shot1Hook, Shot2Intro, Shot3Demo, Shot4Multi, Shot6Anything, Shot7End } from './promo-shots.tsx'
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
      <Composition id="gfx-icon-orbit" component={IconOrbit} fps={FPS} width={1920} height={1080} durationInFrames={90} defaultProps={{ names: ['Instagram', 'TikTok', 'Spotify', 'Gmail', 'Uber', 'LinkedIn', 'Airbnb', 'Slack'] }} />
      <Composition id="gfx-icon-row" component={IconRow} fps={FPS} width={1920} height={1080} durationInFrames={90} defaultProps={{ names: ['WhatsApp', 'Reddit', 'Instagram', 'TikTok'] }} />
      <Composition id="gfx-logo-pop" component={LogoPop} fps={FPS} width={1920} height={1080} durationInFrames={60} />
      <Composition id="gfx-agent-chips" component={AgentChips} fps={FPS} width={1920} height={1080} durationInFrames={75} />
      <Composition id="gfx-split-frame" component={SplitFrame} fps={FPS} width={1920} height={1080} durationInFrames={Math.round(12.7 * FPS)} defaultProps={{ left: 'ghosthand on your Mac', right: 'Your iPhone', total: 38, speed: 3 }} />
      <Composition id="gfx-end-card" component={EndCard} fps={FPS} width={1920} height={1080} durationInFrames={90} defaultProps={{ url: 'ghosthand.dev' }} />
      <Composition id="gfx-prompt-card" component={PromptCard} fps={FPS} width={1920} height={1080} durationInFrames={150} defaultProps={{ prompt: 'order me a Waymo to the restaurant Tom sent in the group chat' }} />
      <Composition id="shot1-hook" component={Shot1Hook} fps={FPS} width={1920} height={1080} durationInFrames={129} defaultProps={{ src: 'promo/g-desk-hero-edit-push.mp4' }} />
      <Composition id="shot2-intro" component={Shot2Intro} fps={FPS} width={1920} height={1080} durationInFrames={153} />
      <Composition id="shot3-demo" component={Shot3Demo} fps={FPS} width={1920} height={1080} durationInFrames={285} defaultProps={{ phones: ['promo/ui-messages-scroll.mp4', 'promo/ui-waymo-request.mp4', 'promo/ui-waymo-confirmed.mp4'], total: 38, speed: 4 }} />
      <Composition id="shot4-multi" component={Shot4Multi} fps={FPS} width={1920} height={1080} durationInFrames={138} />
      <Composition id="shot6-anything" component={Shot6Anything} fps={FPS} width={1920} height={1080} durationInFrames={198} />
      <Composition id="shot7-end" component={Shot7End} fps={FPS} width={1920} height={1080} durationInFrames={93} />
      <Composition id="gfx-tap-dot" component={TapDot} fps={FPS} width={400} height={400} durationInFrames={45} />
    </>
  )
}

registerRoot(Root)
