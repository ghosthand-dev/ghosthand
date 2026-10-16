---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand file list"
sidebarTitle: "file list"
description: "List a folder on the iPhone over USB (AFC): /DCIM, /Downloads, or an app's /Documents with --app"
---

## Usage

```bash
ghosthand file list <path>
```

## Options

| Option | Description |
| --- | --- |
| `--recursive` | Also list everything in subfolders |
| `--app [bundle id]` | Use the Documents folder of this app (only apps with file sharing, see app list) instead of the media folder |
| `--json` | Print JSON |

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Each line: size, modified time (this Mac's time zone), path; folders end with /.
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
$ ghosthand file list -l 42 /
$ ghosthand file list -l 42 /DCIM --recursive
$ ghosthand file list -l 42 /Documents --app org.videolan.vlc-ios
```

## MCP tool

The same command is the MCP tool [`file-list`](/docs/mcp/file-list); flags are arguments.
