---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand record start"
sidebarTitle: "record start"
description: "Start recording the iPhone screen and sound to a new .mov or .mp4 file. Stops by itself after 5 minutes; stop earlier with record stop"
---

## Usage

```bash
ghosthand record start <path>
```

## Options

| Option | Description |
| --- | --- |
| `--fps [n]` | Frame rate cap, 1 up to the iPhone's rate (usually 60). Default: every frame |
| `--max-duration [s]` | Stop by itself after this many seconds, 1-3600 (default: 300) |
| `--no-audio` | Record the screen only, no sound |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Returns at once; the recording runs in the daemon while you send input. Use any
other command meanwhile: screenshots, screentext and taps keep working.
- The file is written on the daemon's Mac. The CLI makes a relative path absolute
  against its own folder; through MCP or HTTP pass an absolute path. The folder must
  exist and the file must not: a recording never overwrites a file.
- It stops by itself, and the file is complete, after --max-duration, when the
  lease ends (release, idle timeout, --force), or when the daemon stops. Run
  `record stop` to get its size and duration.
- The lease idle timeout still counts: send a command at least every 10 minutes
  (or acquire with a longer --idle-timeout), or the lease ends and so does the recording.
- One recording per iPhone at a time. A locked iPhone cannot start one.
- Video is H.264 at the native screen size (828x1792 on an XR); sound is AAC.
  Size measured on an XR: 3-5 MB per minute on a still screen, at most about
  17 MB per minute while the screen moves. --fps 30 lowers both.
- A dark display sends no frames: start fails with `no-frame`. Run `wake` first.
- The sound track is the iPhone's sound output. It is silent when nothing plays.
- With sound, record start and record stop pause media that is playing on the
  iPhone (iOS audio route change; tested on iOS 18.7). Start the recording first,
  then start playback; or press play again after record start. --no-audio does not pause it.
- The round AssistiveTouch button is in the video unless "Always Show Menu" is off
  (Settings &gt; Accessibility &gt; Touch &gt; AssistiveTouch). USB cannot change that
  setting; ask the user before you change it in Settings. The mouse pointer dot stays in the video.

## Examples

```bash
$ ghosthand record start -l 42 /tmp/demo.mov
$ ghosthand record start -l 42 /tmp/demo.mp4 --fps 30 --max-duration 60
```

## MCP tool

The same command is the MCP tool [`record-start`](/docs/mcp/record-start); flags are arguments.
