---
title: System dialogs and misleading App Store download state
description: Real-device findings and iOS source research from October 9, 2026.
---

# System dialogs

**Do not infer rejected input from an unchanged download button.** On an iPhone SE
(2nd generation), iOS 18.6.2, Ghosthand dismissed the cellular-download alert while
App Store continued to show **Resume** during an active TikTok download.

## Real-device evidence

| Observation | What it establishes |
| --- | --- |
| Download at `(255,402)` was tapped; the visible alert disappeared | The alert did not remain blocked in this run |
| TikTok's icon opened its detail page; Home and App Store navigation worked | Ordinary pointer and keyboard input worked |
| Resume stayed visible on both search and detail pages | The button label alone did not reflect the download state |
| USB logs showed 296 MiB, then 302 MiB of 465 MiB received | TikTok was downloading despite the Resume label |
| A later log capture showed `fractionCompleted = 0.437`, `phase = Downloading` | The download continued after the first log capture |
| Installation lookup returned `IsPlaceholder: true` | Download progress did not yet establish a complete installation |

**The App Store itself ignored progress updates**, not just the USB screenshot:

```text
appstored: com.zhiliaoapp.musically; fractionCompleted = 0.390; phase = Downloading
AppStore: [ASDNotificationCenter]: Received progress: <private>
AppStore: [ASDAppQuery]: Ignoring untracked progress for: com.zhiliaoapp.musically
AppStore: [ASDAppQuery]: Ignoring progress for installed: com.zhiliaoapp.musically
```

**The earlier failure is unresolved.** Earlier coordinate taps and Enter did not
close this alert. This run acquired a new lease, which turned AssistiveTouch back
on, then tapped Download. No Bluetooth descriptor, pairing, or code was changed
during that input test.
There was no controlled comparison proving why the later tap succeeded.

## Separate three problems

```text
Visible cellular alert ──> tap a verified button ──> check actual download progress

Unchanged Resume label ──> inspect appstored / installation state, not repeated taps

Hidden Apple 2FA alert ──> obtain its real position; invisible does not mean untappable
```

**Hidden 2FA is not proof of blocked mouse input.** In the earlier session the OK
button was absent from capture and OCR, so its coordinates were guessed. The user
dismissed it physically. That test did not distinguish a missed button from an
iOS input restriction.

## Supported alternatives

### Hidden Instagram location prompt, October 9

**The on-device screenshot showed the missing dialog.** On the same SE2,
Ghosthand's USB capture showed only a gray backdrop. AssistiveTouch's menu still
responded to clicks. Both its Screenshot action and `cmd+shift+3` created native
PNG files that included the complete Instagram location-permission alert.

```bash
ghosthand key -l 42 cmd+shift+3 --screenshot usb.png --screentext
uvx --from pymobiledevice3 pymobiledevice3 afc ls /DCIM --recursive
# Pick the new PNG; saving it can finish after the USB screenshot returns.
uvx --from pymobiledevice3 pymobiledevice3 afc pull /DCIM/100APPLE/IMG_0002.PNG native.png
```

**A short tap failed at verified coordinates.** The native PNG was 750x1334;
Don't Allow was at `(375,1104)`. `tap` with `--scale 1` did not dismiss it. Another
native screenshot confirmed that it remained. A stationary 400 ms drag at the
same position then dismissed it, without locking or unlocking:

```bash
ghosthand swipe -l 42 375 1104 375 1104 --scale 1 --duration 400 \
  --screenshot after.png --screentext
```

**The cause is not isolated.** At the time of this test, `tap` held for 45...75 ms; this stationary drag
holds longer and sends repeated absolute mouse reports. The test does not tell
which difference mattered. Do not claim that all system alerts reject mice or
that changing the HID registration is necessary. The following contacts prompt
was visible in USB capture; location and contacts prompts behaved differently.

The default tap now holds for 110...130 ms, without adding repeated held reports.
This is a duration change, not proof that it fixes every hidden dialog.

On this SE2, the longer normal tap dismissed the subsequent contacts prompt's
Don't Allow button. The new `double-tap` command selected `ghosthand` as a whole
word in Safari's address field, with selection handles and the Cut/Copy menu.
The first attempt on a different word only showed a caret menu; behavior can
depend on field focus. The original hidden location alert was not reproduced.

### Native screenshot and photo cleanup, October 10

**`screenshot --native` automates the trick above**: cmd+shift+3, AFC read of the new
PNG, scale to screen points, then delete. Measured on the SE2: about 1.3 s.

**Do not delete the PNG over AFC.** After `afc rm` of a screenshot, Photos still listed
"4 Photos" and opened the deleted screenshot from its cache. ImageCaptureCore's
`requestDeleteFiles` (Image Capture.app's path) removed it cleanly: Photos showed
"3 Photos". It needs macOS removable volumes access for Ghosthand (setup's Allow Photos);
without it ptpcamerad asks TCC with a prompt, so commands check `TCCAccessPreflight` first.

**More buttons that ignored a normal tap but took a 400 ms press**: Photos' Delete Photo
action sheet. The Photos notification prompt ignored both a tap and a 400 ms press on Don't
Allow, and stayed after lock and unlock. After `key esc` and a tap at Allow's position it was
gone; which of the two closed it was not checked.

**The cmd+shift+3 shortcut can be dropped**: once, right after `key home`, no screenshot
was saved. `--native` presses it once more after 4 s.

### Other input paths

| Method | Scope | Limit |
| --- | --- | --- |
| Settings > Apps > App Store > Cellular Data > App Downloads > Always Allow | Removes the normal cellular size-permission prompt | Changes data-use policy; obtain permission first; roaming can still prompt |
| Full Keyboard Access, then Tab to a button and Space | Activates a focused accessibility item without pointer coordinates | User enables it; not verified on this exact alert |
| Switch Control item scanning and Select Item | Uses a different accessibility selection path | Configure an exit first; not verified on this exact alert |
| Reset AssistiveTouch | Can restore failed pointer input | Not a controlled reset test |

**Plain Enter is not the Full Keyboard Access activation test.** Apple documents
Space on the focused item. Do not turn Full Keyboard Access on for the user.

**Confirm with AssistiveTouch is different.** It replaces the side-button
double-click for Face ID authentication. This SE2 has Touch ID; the cellular
download-policy alert is not that authentication step.

## iOS implementation evidence

**The cellular prompt handles network permission.** In the iOS 18.2 dump,
`ExpensiveNetworkEvaluatorTask.main` presents `CellularDataPromptDialogRequest`
and accepts `CelularDataPromptActionDownloadNow` (the dump spells it this way).
It then allows proceeding without an inexpensive network.

**AssistiveTouch routes mouse events.** `HNDSystemPointerController` processes
button-mask changes and can repost an original HID event with
`sendHIDSystemEvent:repostCreatorHIDEvent:senderID:`. The inspected code does not
establish an App Store-specific prohibition.

**Event security metadata is not a rejection rule.** Fields such as `senderID`,
`isBuiltIn`, `isGeneratedEvent`, and `secureName` in `AXEventRepresentation` do not
by themselves prove that an alert rejects external input. Capture protection and
input acceptance are separate questions.

**Limits:** the public system dump is iOS 18.2 on iPhone17,1, not this SE2 build.
Some decompiled helper bodies are missing. No reliable exact public report was
found proving a blanket mouse restriction for this cellular alert. GitHub code
search hit its shared rate limit during the investigation.

## Sources

- [Apple: iOS 18 App Store settings](https://support.apple.com/guide/iphone/iph3dfd91de/18.0/ios/18.0)
- [Apple: iOS 18 external keyboard control](https://support.apple.com/guide/iphone/ipha4375873f/18.0/ios/18.0)
- [iOS cellular-download decision implementation](https://github.com/EthanArbuckle/iPhone17-1_18.2_22C152_Restore/blob/main/System/Library/PrivateFrameworks/AppStoreDaemon.framework/Support/ExpensiveNetworkEvaluatorTask.m)
- [iOS AssistiveTouch pointer routing implementation](https://github.com/EthanArbuckle/iPhone17-1_18.2_22C152_Restore/blob/main/System/Library/CoreServices/AssistiveTouch.app/HNDSystemPointerController.m)
