---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand file push"
sidebarTitle: "file push"
description: "Copy a file from this Mac to the iPhone over USB, replacing it and making missing folders"
---

## Usage

```bash
ghosthand file push <local file> <iphone path>
```

## Options

| Option | Description |
| --- | --- |
| `--app [bundle id]` | Use the Documents folder of this app (only apps with file sharing, see app list) instead of the media folder |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

&lt;iphone path&gt; is the full path of the new file, with its name.
Files go over USB (AFC), no Developer Mode. Paths start with /. The default root is the
iPhone's media folder (/var/mobile/Media):
  /DCIM        Camera Roll: photos, videos, screenshots (IMG_0001.PNG ...). Use the photo commands
  /Downloads   iOS download databases, not the Files app
  /Books, /PublicStaging, /iTunes_Control, /PhotoData (mostly not readable)
- The Files app ("On My iPhone") and app data are not in this folder. --app &lt;bundle id&gt;
  reaches an app's Documents (/Documents/...), only for apps with [file sharing] in app list.
- A file copied to /DCIM does not appear in Photos. To get a photo or video into Photos
  (for TikTok, Instagram): `ghosthand upload <file>`, open the link in Safari, tap Save,
  then Save Video or Save Image (see `upload --help`). Offline: push it to VLC's
  Documents (--app org.videolan.vlc-ios), then Files &gt; Share &gt; Save Video. Steps:
  https://ghosthand.dev/docs/send-media
- Works while the iPhone is locked, after its first unlock since boot.

## Examples

```bash
$ ghosthand file push -l 42 report.pdf /Downloads/report.pdf
$ ghosthand file push -l 42 movie.mp4 /Documents/movie.mp4 --app org.videolan.vlc-ios
```

## MCP tool

The same command is the MCP tool [`file-push`](/docs/mcp/file-push); flags are arguments.
