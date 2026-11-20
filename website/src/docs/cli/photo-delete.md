---
$schema: https://holocron.so/frontmatter.json
title: "ghosthand photo delete"
sidebarTitle: "photo delete"
description: "Delete photos from the iPhone's Photos library by file name (from photo list), over USB"
---

## Usage

```bash
ghosthand photo delete <name...>
```

Also takes the [global options](/docs/cli/overview#global-options).

## Details

Uses ImageCaptureCore, like Image Capture.app, so Photos forgets the photo too.
Permanent: it skips Recently Deleted.
Only delete photos you made (e.g. screenshots); ask the user before deleting theirs.
The iPhone must be unlocked.
- iCloud Photos on: iOS refuses every USB delete (permission-denied). Delete the photo
  in the Photos app on the iPhone instead, or tell the user it is left over.

## Examples

```bash
$ ghosthand photo delete -l 42 IMG_0004.PNG
```

## MCP tool

The same command is the MCP tool [`photo-delete`](/docs/mcp/photo-delete); flags are arguments.
