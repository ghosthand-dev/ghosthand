# edit

A Diffusion Studio project: a video composition authored as code. The folder is
a plain npm package whose entry file is a [Solid](https://www.solidjs.com)
component; the app compiles it and renders every element into an editable node
on the canvas.

## Structure

| Path | What it is |
| ---- | ---------- |
| `index.tsx` | The entry. Its default export renders the composition. |
| `package.json` | The project record: `projectId` (its identity, kept across renames), `displayName` (the name shown in the app), `main` (the entry), `diffusion` (how each scene is exported), and the dapi commands as scripts. |
| `tsconfig.json` | Types for the composition tags, through `jsxImportSource`. |
| `assets.yml` | The asset library: for every asset its library path, where its bytes are, and what it was found to be. Written by the app; hand edits are read on the next load. |
| `assets/` | The library's files: put one here and it is taken in while the app watches, and the app writes its own here too — generations under `assets/generated/`. Media imported through the app is linked where it lies instead, never copied. |
| `cache/` | Derived data (thumbnails, waveforms). Disposable, and not checked in. |
| `AGENTS.md` | The agent entry point: what to read in `.diffusion/docs/` and how to work here. |
| `.diffusion/` | App-owned. `docs/` is the authoring reference and examples for the installed app version; the app regenerates it, and it is not checked in. |

## Authoring

The source is the document, in both directions. Saving recompiles the project
and remounts it — scenes rebuild in place, the way reloading a page does, and a
compile error leaves the last good render on the canvas. Edits made in the app
come back the other way: a dragged rect, a trimmed clip or a retyped line lands
as a prop on the element it was authored as.

```tsx
export default function Project() {
  return (
    <stage background="#161616" camera={[0.3, 0, 0, 0.3, 85, 150]}>
      <scene name="Intro" width={1920} height={1080} fill="black" active>
        <video src="b-roll/drone.mp4" start={0} end={6} width={1920} height={1080} />
        <text y={860} width={1920} textAlign="center" fontFamily="Inter" fontSize={96} start={1} end={5}>
          Hello
          <animation type="fade" duration={0.5} />
          <animation type="fade" phase="out" duration={0.5} />
        </text>
      </scene>
    </stage>
  )
}
```

- `<stage>` is the root, and holds one `<scene>` per frame you cut in. A scene
  owns the timeline its children sit on; nothing outside a scene has a clock to
  be placed against.
- One scene carries `active` — the one the playhead, the timeline and an export
  are pointed at — and the stage carries the `camera` the canvas opens on, a
  `[scale, 0, 0, scale, x, y]` matrix (`0.3` fits a 1920×1080 frame). Both are
  editor state: the app writes them back as the view is panned or a scene is
  clicked, but a project that ships without them opens on an empty timeline,
  looking at the corner of nothing.
- Position and size are explicit, in pixels. There is no layout pass and no CSS.
- `start` / `end` place a clip on that timeline, `sourceIn` / `sourceOut` choose
  the part of the media that plays. Times are seconds (`1.5`), frames (`45f`) or
  `"MM:SS"`.
- Style and motion are children: `<animation>` for a preset in or out,
  `<keyframeTrack>` with `<keyframe>` children for one property, `<solidPaint>`
  and the gradient paints, `<stroke>`, `<shadow>`, `<effect>`.
- `src` takes a library path (`"b-roll/drone.mp4"` — the portable form, it
  survives the file being relinked), an asset id, a URL, or an absolute path.
- Generated assets are declared rather than fetched: `src={generate.image({ prompt })}`,
  and `generate.video`, `generate.voice`, `generate.audio`. They are produced on
  mount, in dependency order. `dapi context` reports where each stands:
  generating, failed with the reason, or done with the asset path it landed as.
- Solid is fully available while mounting: `<For>`, `<Show>`, `createMemo`, and
  `useTicker()` for values that follow the playhead.
- npm packages work as they normally do. The folder is a real npm package, so
  `npm i three` in it is all it takes: anything in `node_modules` is resolved
  and bundled, subpath imports included. A composition runs in a browser
  context, so a package that needs Node APIs will not bundle.

Types are stripped at compile time and never checked, so typecheck the project
yourself with `npx tsc --noEmit`.

## Commands

Every dapi command is a script here: `npm run` lists them, and
`npm run <name> -- <args>` runs one (`npm run grab -- b-roll/drone.mp4 -c 6`).
All of them talk to the running app, except `fonts` and `fetch`.

| Script | Command | What it does |
| ------ | ------- | ------------ |
| `open` | `dapi open .` | Launch the app with this project open. |
| `context` | `dapi context` | Which project the app has open, where its playhead sits, its fonts, where its generations stand. |
| `capture` | `dapi capture <id>` | Render frames of a scene, as an export would, to labelled PNG contact sheets. |
| `probe` | `dapi media probe <id\|path>` | Container and per-track metadata, without decoding. |
| `transcribe` | `dapi media transcribe <id\|path>` | Timed speech transcript, word by word. |
| `grab` | `dapi media grab <id\|path>` | Decode frames of a video to labelled PNG contact sheets. |
| `filmstrip` | `dapi media filmstrip <id\|path>` | Thumbnail grid across a window of a video. |
| `waveform` | `dapi media waveform <id\|path>` | Loudness over time, with the silences marked. |
| `listen` | `dapi media listen <id\|path>` | Ask a multimodal model what is in an audio track. |
| `models` | `dapi models [type]` | Generation models and their per-model constraints. |
| `voices` | `dapi voices` | Speech voices for `generate.voice`. |
| `fonts` | `dapi fonts` | Local font families, valid as `fontFamily`. |
| `whoami` | `dapi whoami` | The signed-in account. |
| `logs` | `dapi logs` | Recent console output from the app. |
| `screenshot` | `dapi screenshot` | The whole app window as a PNG. |
| `report` | `dapi report <title>` | File a bug against the editor, with diagnostics attached. |
| `fetch` | `dapi fetch <url>` | Download a video with yt-dlp (installed separately). |

## Reference

- [JSX reference](https://github.com/diffusionstudio/editor/blob/main/reference/jsx/README.md): elements, timing, paints, generation, captions
- [CLI reference](https://github.com/diffusionstudio/editor/blob/main/reference/README.md): every command, its options and its output
- [Examples](https://github.com/diffusionstudio/editor/tree/main/examples): runnable compositions to read
