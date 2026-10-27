---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand upload"
sidebarTitle: "upload"
description: "Upload a photo or video to a 1-day link that Safari on the iPhone saves to Photos (Save Video, Save Image)"
---

## Usage

```bash
ghosthand upload <file>
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

The way to get a photo or video into Photos, so apps like TikTok and Instagram can
upload it. Prints a short link to a page with a Save button. No lease: the upload
does not touch the iPhone. Then open the link in Safari (examples above):
- The page shows Loading... until the file is downloaded, then Save. Tap Save only
  when it says Save. The iOS share sheet opens: tap Save Video (Save Image for photos).
- Direct file links download the file. Use this page to save it through iOS's share sheet.
- Needs this Mac signed in to ghosthand.dev (like acquire). The link works on any
  iPhone, also one plugged into another Mac.
- At most 100 MB. The link expires after 1 day; anyone with it can download the file.
- The file name keeps its extension, which tells iOS the type (clip.mp4, a.jpg).
- MCP: send data (base64, up to about 3 MB) and name (e.g. clip.mp4), never a Mac path.
- Offline, or bigger files: `file push` into VLC, see https://ghosthand.dev/docs/send-media

## Examples

```bash
$ ghosthand upload clip.mp4
$ ghosthand key -l 42 cmd+space
$ ghosthand type -l 42 Safari
$ ghosthand key -l 42 enter
$ ghosthand key -l 42 cmd+l
$ ghosthand type -l 42 https://ghosthand.dev/u/3fK9xQ2mZr7T
$ ghosthand key -l 42 enter
$ ghosthand tap -l 42 --text Save --screentext
$ ghosthand tap -l 42 --text "Save Video"
$ ghosthand photo list -l 42 --limit 1
```

## MCP tool

The same command is the MCP tool [`upload`](/docs/mcp/upload); flags are arguments.
