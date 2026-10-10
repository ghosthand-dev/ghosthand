---
title: Send photos and videos for upload in apps
description: How to get a photo or video from the Mac into the iPhone's Photos library with ghosthand, so TikTok, Instagram and other apps can upload it.
---

# Send photos and videos for upload in apps

**Apps like TikTok and Instagram upload only from Photos.** So a file from the Mac must get into the Photos library first. Ghosthand does it with one USB copy and a few taps:

```
Mac file ──file push --app org.videolan.vlc-ios──> Files > On My iPhone > VLC
                                                     │ Share > Save Video / Save Image
                                                     ▼
                                                   Photos ──Share > TikTok──> draft or post
```

## Why not copy it straight into Photos

**There is no USB way to add to Photos without an app on the iPhone.** Tested on an SE2 (iOS 18.6) and checked against other tools:

| Way | Result |
| --- | --- |
| `file push` to `/DCIM` | the file is on disk, but Photos does not import it |
| ImageCaptureCore upload | the iPhone does not offer upload, only delete |
| Finder photo sync, iMazing | read-only "From My Mac" albums; needs iCloud Photos off |
| Delete `PhotoData/Photos.sqlite` to force a rebuild | destroys albums and edits; never do it |
| 3uTools, Tenorshare | they need their own app on the iPhone |

## 1. One-time setup: install VLC

**VLC is a free USB drop folder.** It has no account and no ads. Its `Info.plist` has `UIFileSharingEnabled` (so `--app` can write to it) and `LSSupportsOpeningDocumentsInPlace` (so its folder shows in the Files app).

```bash
ghosthand app list -l 42 | grep vlc
# org.videolan.vlc-ios  VLC <version>  [file sharing]  (page 2)
```

If it is missing, install it from the App Store with taps. Any other app with `[file sharing]` works too. System apps like Fitness refuse `--app`.

## 2. Copy the file over USB

```bash
ghosthand file push -l 42 clip.mp4 /Documents/clip.mp4 --app org.videolan.vlc-ios
```

The copy is byte for byte: no Wi-Fi, no quality loss, and large videos are fine.

## 3. Save it to Photos

The **Files app** saves any file to Photos, so the VLC app does not need to open:

```bash
ghosthand tap -l 42 --text Files --screentext            # open Files (or find its icon first)
ghosthand tap -l 42 --text "On My iPhone" --screentext
ghosthand tap -l 42 --text VLC --screentext
ghosthand hold -l 42 --text clip --duration 2000 --screentext
ghosthand tap -l 42 --text Share --screentext
ghosthand tap -l 42 --text "Save Video" --screentext     # "Save Image" for photos
ghosthand photo list -l 42 --limit 1                      # the new item is in /DCIM now
```

## 4. Upload from the app

**Open the photo in Photos, tap Share, then pick the app.** Tested with TikTok: Share > TikTok > **Photo** > Next > **Drafts**. The draft shows under Profile, ready to post later. The app's own **+** > Upload picker also shows the new item first.

## Other ways

1. **Safari** (tested on an SE2, iOS 18.6): serve the file from the Mac (`python3 -m http.server`; if the iPhone cannot reach the Mac's LAN address, use a public tunnel). Open the URL on the iPhone, `hold` the image (1200 ms did not open the menu, 2000 ms did), then tap **Save to Photos**. For videos, download first, then Files > Share > **Save Video**.
2. **AirDrop from the Mac**: the item lands in Photos, but it is hard to automate from the Mac side.

## Clean up

```bash
ghosthand file remove -l 42 /Documents/clip.mp4 --app org.videolan.vlc-ios
ghosthand photo delete -l 42 IMG_0042.MP4    # name from photo list
```

<details>
<summary>Test status</summary>

- Safari "Save to Photos" and the TikTok draft were tested on an SE2, iOS 18.6.2.
- The VLC flow was not tested end to end yet: the App Store install stopped at "You have not verified your Apple ID" on the test account.
- VLC's file sharing keys were read from https://github.com/videolan/vlc-ios/blob/master/Resources/iOS/Info.plist

</details>
