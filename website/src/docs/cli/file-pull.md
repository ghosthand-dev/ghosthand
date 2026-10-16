---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand file pull"
sidebarTitle: "file pull"
description: "Copy a file or folder from the iPhone to this Mac over USB"
---

## Usage

```bash
ghosthand file pull <iphone path> [local path]
```

## Options

| Option | Description |
| --- | --- |
| `--app [bundle id]` | Use the Documents folder of this app (only apps with file sharing, see app list) instead of the media folder |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

A file goes to [local path] (default: its name in this folder). A folder is unpacked
inside [local path] (default: this folder), keeping its name.
For the newest photos use `photo pull`; it finds them for you.
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
$ ghosthand file pull -l 42 /DCIM/100APPLE/IMG_0002.PNG native.png
$ ghosthand file pull -l 42 /DCIM/100APPLE ./camera
```

## MCP tool

The same command is the MCP tool [`file-pull`](/docs/mcp/file-pull); flags are arguments.
