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

The default tap now holds for 220...260 ms (was 150...190 ms, 110...130 ms and 45...75 ms before), without adding repeated held reports.
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

**A half-written PNG decodes as all black, without an error.** With the Apple Account
verification code alert open, `--native` returned black 3 times while the file left on the
iPhone showed the alert. A PNG cut after the start of its first IDAT gives a black image.
`--native` now accepts only files that end with the IEND chunk; the next try showed the alert.

**The cmd+shift+3 shortcut can be dropped**: once, right after `key home`, no screenshot
was saved. `--native` presses it once more after 4 s.

### First press ignored, hold and hold-drag, October 10

**A just-opened alert ignored the first press, whatever its kind.** SE2, iOS 18.6.2,
AssistiveTouch > Perform Touch Gestures on. The Remove "Notes"? alert (opened from the
icon's context menu) ignored the first press on Cancel and took the second:

| First and second press | Trials | First press | Second press |
| --- | --- | --- | --- |
| `tap` | 2 | ignored | dismissed |
| `hold --duration 400` | 2 | ignored | dismissed |
| `hold` with a report every 16 ms while held | 2 | ignored | dismissed |
| `swipe x y x y --duration 400` | 2 | ignored | dismissed |

The Settings "Verification Email Sent" alert did the same: `hold` ignored, then `tap`
dismissed it. So the earlier "400 ms press works where tap fails" findings above were
likely second presses. Not isolated: with Perform Touch Gestures off, the first `hold`
on Cancel dismissed the alert, but that alert was opened by a tap, not a hold.

**Hold sends no reports while held.** With a report every 16 ms at the same point, a
1000 ms hold on a Home Screen icon opened the menu, then iOS entered edit mode as if the
finger moved. Without reports the menu stays open.

**Hold-drag moves Home Screen icons only with Perform Touch Gestures off.**
Outdated: these drags used absolute reports, which the finger ignores. With relative
drags, `hold-drag --hold 2500` moves icons with the setting on ([relative-pointer.md](relative-pointer.md#drags-on-ios-17-and-later)).

| Perform Touch Gestures | Start | `--hold` | Result |
| --- | --- | --- | --- |
| on | normal Home Screen | 1000 | menu opens, icon stays |
| on | normal Home Screen | 2500 | edit mode, icon stays |
| on | edit mode | 600, 800, 1000 | icon does not lift; the pointer moves alone |
| off | normal Home Screen | 1000 | edit mode, icon stays |
| off | normal Home Screen | 2500 | icon moved |
| off | edit mode | 1000 | icon moved (2 of 2) |

Sending the button in both mouse reports on every drag step, or reports during the hold,
did not change the result with the setting on. The setting was turned back on after the test.

### Apple 2FA code alert, October 10

**Nothing remote closed it.** SE2, iOS 18.6.2, Safari `id.apple.com` two-factor page after
Allow. `screenshot --native` was all black (4 of 4). No effect: `key esc`, `key enter` (2x),
`key home`, `fn+h`, lock + unlock, and AssistiveTouch menu > Home (2x; the menu opened over
the alert). AssistiveTouch Home is the action `key home` maps to mouse button 3, so that mapping
would not help here. Ask the user to tap OK on the phone.

`key home` now clicks that button 3 (mapped once in AssistiveTouch > Devices). It went Home
from Settings and Safari (2 of 2); it was not retested on this alert.

### Apple password confirmation, October 20

**A 5-second hold succeeded once** on an SE2, iOS 26.5.2. Apple Account's
**Do Not Sign Out** stayed open after normal taps and 1500...2500 ms holds.
After a new lease, this press closed it and a native screenshot showed the
Sign-In & Security page again:

```bash
ghosthand hold -l 42 --text "Do Not Sign Out" --duration 5000 --screentext
ghosthand screenshot -l 42 --native -o result.png
```

**The cause is unresolved.** Duration, elapsed time and reacquiring the lease were
not isolated. Use a verified button position and check the result; do not claim
that every system dialog needs a 5-second press.

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
