---
title: Phone calls for agents
description: Research on letting an AI agent make and take calls on a ghosthand iPhone, with call audio piped to and from a process. Options, tests on macOS 26.7.1 + iOS 18.6, and a rough plan.
---

# Phone calls for agents

**Goal**: an agent dials or answers a call on the iPhone, hears the other side (downlink) as PCM, and
speaks into the call (uplink) from a process.

**Short answer**: call *control* works today over Bluetooth with public macOS API (tested). Call
*audio* does not: the Mac's Bluetooth refuses the HFP audio link, and USB capture does not carry
call audio. Audio needs either Continuity (same Apple Account on Mac and iPhone) or a second
Bluetooth radio running our own hands-free stack.

```
                        ┌──────────────── control (AT commands over RFCOMM) ───────────────┐
                        │  dial, answer, end, DTMF, caller ID, call state: WORKS today     │
┌──────────┐  internal  ▼                                                                  │
│  iPhone  │◀──────── Mac Bluetooth (HID today) + HFP hands-free (IOBluetooth) ────────────┘
│  (AG)    │                  └── audio (SCO): refused, kIOReturnUnsupported
│          │
│          │── Continuity (Wi-Fi, same Apple Account) ──▶ Phone.app on Mac ──▶ CoreAudio
│          │                                    downlink: process tap   uplink: virtual mic
│          │
│          │── HFP over a USB Bluetooth dongle (own stack, libusb) ──▶ SCO PCM in our process
└──────────┘
```

## What the daemon has today

| Path | Carries | Call audio? |
| --- | --- | --- |
| USB screen capture (`FrameStream`, CoreMediaIO) | screen + media sound (route "System Capture") | No. iOS keeps call audio out of capture and mirroring. Not tested with a live call. |
| Bluetooth Classic HID (private `CBClassicManager`, L2CAP PSM 0x11/0x13) | keyboard, mouse, consumer keys | No. HID has no audio. Report 8 (telephony page: hook switch, mute) is in the report map but not sent yet. |

So the Mac gets **media** sound only, and only one way (iPhone to Mac). There is no path into the
iPhone microphone.

## Test: the Mac as an HFP hands-free unit

macOS still ships `IOBluetoothHandsFreeDevice` (public, since 10.7). The Mac plays the car kit
role (HF), the iPhone is the Audio Gateway (AG). A 60 line Swift script on macOS 26.7.1 against
an iPhone SE 2 on iOS 18.6.2, already bonded to the Mac for HID:

```
service 1          callActive 0        battery 5        signal 2
subscriber 393791730169                     # AT+CNUM: the SIM's own number
connectSCO  ->  SCO opened -536870201       # 0xE00002C7 kIOReturnUnsupported
new audio devices: []
```

- **Service level connection works**: RFCOMM next to our HID channels, indicators, AT commands.
  So `dialNumber`, `acceptCall`, `endCall`, `sendDTMF`, `currentCallList` and caller ID
  (`incomingCallFrom`) should work. Not tested, because each one places or answers a real call.
- **Audio fails**: the Mac refuses to open SCO and no CoreAudio device appears. The old SCO audio
  driver behind this API is gone on modern macOS.
- **Not tested yet**: what happens when the iPhone itself opens SCO during a live call while the
  Mac is connected as HF. If macOS accepts it, audio would be almost free. More likely the call
  loses audio, so HFP control must ask iOS to keep audio on the phone (`acceptCallOnPhone`,
  `transferAudioToPhone`).

## Options

| Option | iOS 18, no jailbreak | Audio both ways | User setup | Daemon work |
| --- | --- | --- | --- | --- |
| HFP control on the internal radio | yes (tested) | no | none, already paired | small |
| Continuity: Phone.app on Mac + virtual audio | yes | yes | same Apple Account, Wi-Fi, "Calls on Other Devices" | medium |
| HFP on a USB Bluetooth dongle, own stack | yes | yes | buy dongle, nvram flag, reboot, pair phone | large |
| Linux box (Pi) with BlueZ + PipeWire + oFono | yes | yes | extra hardware per site | medium, outside daemon |
| USB screen capture audio | no call audio | no | none | n/a |
| Wired USB-C / Lightning audio | yes | yes | adapter, but the port is busy with USB capture | n/a |
| CallKit / VoIP app on the iPhone | no access to cellular calls | n/a | n/a | n/a |
| Twilio, Telnyx, OpenAI Realtime SIP, Vapi, Retell | no iPhone | yes | account + number | none |

### Continuity (Phone.app on macOS 26)

macOS 26 has a **Phone app** that relays the iPhone's cellular calls (`tel:`, `telephony:` and
`phoneapp:` URL schemes). Call audio then plays and records on the Mac:

- **Downlink**: a Core Audio process tap (`AudioHardwareCreateProcessTap`, macOS 14.2+) on the
  process that plays call audio (probably `avconferenced`, not verified), or set the call output
  to a virtual device.
- **Uplink**: macOS has no API to inject a microphone. It needs a virtual input device: BlackHole
  for a prototype (installed on this Mac), later our own AudioServerPlugIn. HAL plugins live in
  `/Library/Audio/Plug-Ins/HAL`, so the installer needs admin rights.
- **Limits**: the Mac must be signed into FaceTime with the **iPhone's Apple Account**. One Mac
  bridges one identity, which breaks the multi-phone, one-identity-per-phone setup. Starting and
  answering calls goes through Phone.app UI or notifications (accessibility actions, no public
  API; `TelephonyUtilities` is private and entitlement gated). HFP control over Bluetooth can do
  dial/answer/end instead, but how the two interact is not tested.
- **Latency**: not measured. Expect the Wi-Fi relay to add some tens of ms on top of the cellular
  network.

### HFP hands-free on a USB Bluetooth dongle

A cheap dongle (CSR8510, Realtek RTL8761B) driven from user space with libusb gives raw HCI, so
we own SCO audio as PCM (CVSD 8 kHz or mSBC 16 kHz wideband). The iPhone pairs to it like a car
kit, next to our HID link on the internal radio.

- **Proven stack**: BTstack runs on macOS 26 with libusb and enables `ENABLE_SCO_OVER_HCI` and
  wideband speech in its libusb port; it has an HFP HF demo. Its license is non-commercial, so
  ghosthand would need a commercial license from BlueKitchen.
  [port README](https://github.com/bluekitchen/btstack/blob/master/port/libusb/README.md)
- **Bumble** (Apache 2.0, Python) has an HFP hands-free example, but its USB transport drops SCO
  packets ("unsupported packet type 3"), so no audio today.
- **Setup**: `sudo nvram bluetoothHostControllerSwitchBehavior=never` and a reboot, so macOS
  keeps its internal controller and leaves the dongle to us. BTstack also warns about a macOS 26
  USB kernel panic with some devices ([libusb #1762](https://github.com/libusb/libusb/issues/1762)).
- **Works for any app that uses the call route**: cellular, and CallKit apps like WhatsApp,
  because iOS sends their audio to the hands-free device too.
- **Latency**: SCO is a few tens of ms. Not measured.
- **Scale**: one controller holds a few SCO links; plan one dongle per phone that calls at the
  same time.

### Hosted telephony

When the number does not matter, skip the iPhone: Twilio from $0.014/min outbound in the US
([pricing](https://www.twilio.com/en-us/voice/pricing/us)), with
[OpenAI Realtime](https://developers.openai.com/api/docs/guides/realtime) over SIP or
Vapi and Retell on top. Lower latency, no hardware, scales.

The iPhone is worth it only when the call must come from **that SIM**: the user's own mobile
number as caller ID, voice OTP calls to the SIM, local numbers that are hard to rent, or VoIP apps
on the phone (WhatsApp calls).

## Legal and ToS

- **US**: the FCC ruled in Feb 2024 that AI voices are "artificial voice" under the TCPA, so calls
  to consumers need prior express consent
  ([FCC](https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf)).
  12 states need consent of all parties to record a call.
- **EU / Italy**: recording and transcribing a call is personal data processing (GDPR); tell the
  other side. Marketing calls must check the Registro delle Opposizioni.
- **Carriers**: consumer plans usually allow personal use only; automated or bulk calling can get
  the SIM blocked.
- **Apple**: HFP and Continuity are standard features, no ToS issue. A private-API call path
  (`TelephonyUtilities`) would be fragile, not a ToS breach for a non-App Store app.
- **Product rule**: the agent says it is an AI at the start of a call, and we never ship bulk
  dialing.

## Recommendation and plan

1. **Call control over the existing Bluetooth (small).** Add an HFP hands-free connection next to
   HID in the daemon. Audio stays on the iPhone. First test what one live call does with HFP
   connected.
2. **Audio via Continuity (medium), for a Mac and iPhone on the same Apple Account.** Process tap
   for the downlink, a virtual mic for the uplink. A BlackHole prototype first.
3. **Audio for the fleet via a USB dongle (large).** Our own HFP HF + SCO over libusb, or a BTstack
   commercial license. This is the only path that works per phone with any Apple Account.

CLI shape (MCP tools named the same, per AGENTS.md):

```bash
ghosthand call dial -l 42 +393331234567     # ATD; waits until ringing or failed
ghosthand call status -l 42                  # call state, caller ID, signal, battery
ghosthand call wait -l 42 --incoming         # waits for RING + caller ID
ghosthand call answer -l 42
ghosthand call dtmf -l 42 1#                 # AT+VTS, for IVR menus
ghosthand call end -l 42
ghosthand call bridge -l 42 -- ./voice-agent # phase 2+: downlink PCM s16le 16 kHz to its
                                             # stdin, its stdout goes into the call
```

MCP cannot stream audio, so MCP gets the control tools plus a higher-level pair later
(`call-say` text to speech, `call-listen` returns a transcript), with the speech loop in the daemon
like other logic.

<details>
<summary>Open questions to test with one live call (needs the user's go)</summary>

- Does `dialNumber` place the call, and does iOS keep audio on the phone with the Mac as HF?
- Does iOS open SCO to the Mac during the call, and does macOS refuse it the same way?
- Does any call audio reach the USB capture audio output?
- Which macOS process plays Continuity call audio, for the process tap?

</details>
