---
title: Send photos and videos for upload in apps
description: How to get a photo or video from the Mac into the iPhone's Photos library with ghosthand, so TikTok, Instagram and other apps can upload it.
---

# Send photos and videos for upload in apps

**Apps like TikTok and Instagram upload only from Photos.** So a file from the Mac must get into the Photos library first. `ghosthand upload` does it for photos and videos:

```
ghosthand upload clip.mp4 ──daemon──> ghosthand.dev (R2, 1 day) ──> https://ghosthand.dev/u/<id>
iPhone Safari ──open link, tap Save──> iOS share sheet ──Save Video / Save Image──> Photos
                                                                                     │
                                                     Photos ──Share > TikTok──> draft or post
```

| File | Way | Why |
| --- | --- | --- |
| Photo or video, up to 100 MB | `ghosthand upload`, Safari **Save** > **Save Video** | One command, no install, no server on the Mac |
| Offline, or over 100 MB | USB copy into VLC, then Files **Save Video** | No network; needs VLC |

## Upload, then save from Safari

### 1. Upload the file

```bash
ghosthand upload clip.mp4
# https://ghosthand.dev/u/3fK9xQ2mZr7T
# clip.mp4 (5234112 bytes), expires 11 Oct 2026 at 16:34. ...
```

- **Needs this Mac signed in** to ghosthand.dev with a trial or plan, like `acquire`. No lease: the upload does not touch the iPhone.
- **At most 100 MB.** The link expires after 1 day. Anyone with the link can download the file.
- **Keep the extension** in the file name (`.mp4`, `.jpg`): it tells iOS the type.
- MCP: the `upload` tool takes `path` (a file on the daemon's Mac), or `data` (base64) with `name`.

### 2. Open the link in Safari and save

```bash
ghosthand key -l 42 cmd+space                       # Spotlight, from any app
ghosthand type -l 42 Safari
ghosthand key -l 42 enter
ghosthand key -l 42 cmd+l                           # address bar
ghosthand type -l 42 https://ghosthand.dev/u/3fK9xQ2mZr7T
ghosthand key -l 42 enter
ghosthand tap -l 42 --text Save --screentext        # wait until it says Save, not Loading...
ghosthand tap -l 42 --text "Save Video"             # "Save Image" for photos
ghosthand photo list -l 42 --limit 1
```

**Why a page with a button.** A direct video link only plays in Safari: the player and the Share sheet have no Save Video. The page downloads the file, wraps it in a `File`, and the **Save** tap calls `navigator.share({ files })`. The share sheet of a file has **Save Video**. `navigator.share` runs only from a tap, so the button is needed.

## Offline: USB copy into VLC, then save from Files

### 1. One-time setup: install VLC

**VLC is a free USB drop folder.** It has no account and no ads. Its `Info.plist` has `UIFileSharingEnabled` (so `--app` can write to it) and `LSSupportsOpeningDocumentsInPlace` (so its folder shows in the Files app).

```bash
ghosthand app list -l 42 | grep vlc
# org.videolan.vlc-ios  VLC <version>  [file sharing]  (page 2)
```

If it is missing, install it from the App Store with taps. Any other app with `[file sharing]` works too. System apps like Fitness refuse `--app`.

### 2. Copy the file and save it

The copy is byte for byte: no Wi-Fi, no quality loss, and large videos are fine.

```bash
ghosthand file push -l 42 clip.mp4 /Documents/clip.mp4 --app org.videolan.vlc-ios
ghosthand key -l 42 cmd+space
ghosthand type -l 42 Files
ghosthand key -l 42 enter
ghosthand tap -l 42 --text Browse
ghosthand tap -l 42 --text "On My iPhone"
ghosthand tap -l 42 --text VLC
ghosthand hold -l 42 --text clip --duration 2000 --screentext
ghosthand tap -l 42 --text Share
ghosthand tap -l 42 --text "Save Video"         # "Save Image" for photos
ghosthand photo list -l 42 --limit 1
```

## Upload from the app

**Open the photo in Photos, tap Share, then pick the app.** Tested with TikTok: Share > TikTok > **Photo** > Next > **Drafts**. The draft shows under Profile, ready to post later. The app's own **+** > Upload picker also shows the new item first.

## Why not copy it straight into Photos

**There is no USB way to add to Photos without an app on the iPhone.** Tested on an SE2 (iOS 18.6) and checked against other tools:

| Way | Result |
| --- | --- |
| `file push` to `/DCIM` | the file is on disk, but Photos does not import it |
| ImageCaptureCore upload | the iPhone does not offer upload, only delete |
| Finder photo sync, iMazing | read-only "From My Mac" albums; needs iCloud Photos off |
| Delete `PhotoData/Photos.sqlite` to force a rebuild | destroys albums and edits; never do it |
| 3uTools, Tenorshare | they need their own app on the iPhone |

**AirDrop from the Mac** lands the item in Photos, but it is hard to automate from the Mac side.

## Clean up

```bash
ghosthand file remove -l 42 /Documents/clip.mp4 --app org.videolan.vlc-ios
ghosthand photo delete -l 42 IMG_0042.MP4    # name from photo list
```

<details>
<summary>Test status</summary>

- Tested on an SE2, iOS 18.6.2, October 10: `ghosthand upload` (mp4, ghosthand.dev) > Safari > Save > Save Video, the item showed in `photo list`. Earlier the same day: Mac share page > Save > Save Video (mp4, over a kimaki HTTPS tunnel and over the LAN URL), uguu.se link > Safari > Save to Photos (jpg), and VLC push > Files > Save Video (mp4). Every item showed in `photo list`.
- A direct mp4 link in Safari opened the video player. Neither the player nor the Share sheet offered Save Video.
- The TikTok draft was tested on the same phone.
- VLC's file sharing keys were read from https://github.com/videolan/vlc-ios/blob/master/Resources/iOS/Info.plist

</details>
