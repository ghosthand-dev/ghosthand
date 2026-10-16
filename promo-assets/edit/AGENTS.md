# Authoring this project

A Diffusion Studio project: a video composition authored as code. The entry
(`index.tsx`) default-exports a Solid component that renders a `<stage>`;
the app compiles it and renders every element into an editable node on the
canvas. The source is the document in both directions: saving recompiles and
remounts the project, and edits made in the app land back in the JSX as props
on the element they were authored as.

## Docs

`.diffusion/docs/` holds the authoring reference and runnable examples for
the installed app version. The app regenerates it on version changes: read it,
never edit it, and trust it over memory.

| Read | For |
| ---- | --- |
| `.diffusion/docs/reference/jsx/README.md` | The JSX contract — elements, props, pipeline. Start here. |
| `.diffusion/docs/reference/jsx/timing.md` | `start`/`end`/`sourceIn`/`sourceOut`, and the time formats. |
| `.diffusion/docs/reference/jsx/generate.md` | Declaring AI-generated assets (`generate.*`). |
| `.diffusion/docs/reference/jsx/variables.md` | `@inspect` variables: annotated consts as live inspector controls. |
| `.diffusion/docs/reference/README.md` | Every dapi command, its options and its output. |
| `.diffusion/docs/examples/` | Complete compositions, basics through shaders. |

## Working here

- Every dapi command is an npm script: `npm run` lists them, and
  `npm run <name> -- <args>` runs one.
- `npm run context` reports what the app has open, where its playhead sits,
  and where generations stand.
- Verify visually with `npm run capture -- <sceneId>`: it renders the
  scene's frames exactly as an export encodes them. Do not export a video to
  check work.
- Position and size are explicit, in pixels. There is no layout pass and no CSS.
- A composition you author from scratch marks one scene `active` and gives
  `<stage>` a `camera` framing it, or the project opens on an empty timeline
  with the frame off screen.
- Times are seconds (`1.5`), frames (`"45f"`), or `"MM:SS"`.
- Types are stripped at compile time, never checked: run `npx tsc --noEmit`.
