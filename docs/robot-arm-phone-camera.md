---
title: Open-source robot arm to move an iPhone camera
description: Comparison of 3D-printable robot arms (SO-101, SO-ARM 102, PAROL6, AR4, Thor, Arctos, Moveo, Koch) and non-arm rigs for an agent that moves a phone and takes photos through ghosthand, with EU build costs. Research from 2026-11-05.
---

# Open-source robot arm to move an iPhone camera

**Pick: an SO-ARM 102 follower arm, built without its gripper, with a printed phone clamp on
the wrist.** About **€280 to €350** in parts (printer excluded). It is the SO-101 design with
stronger servos and a stiffer frame, rated for **300 g** at the gripper, which covers an
iPhone Pro Max plus clamp plus cable. If the phone is an iPhone SE and money matters more, the
plain **SO-101 with 12 V servos** costs about **€140 to €170** and uses the same electronics and
software.

```
Mac (agent) ──USB serial──> Waveshare Bus Servo Adapter ──TTL bus──> 5 Feetech servos (arm)
     │                                                                         │
     └──USB (ghosthand)──────────> iPhone in printed clamp on the wrist <──────┘
                                   agent: move arm, then camera photo or screenshot
```

Research only: nothing was bought. Prices were read from shop pages on 2026-11-05. USD to EUR
uses 0.888 (ECB rate of 2026-11-04 via frankfurter.app). Unverified numbers are marked.

## What the use case needs

- **Payload at reach.** An iPhone SE is about 150 g, a Pro Max about 230 g. Add about 40 g of
  printed clamp and about 20 g of USB cable drag: **210 g to 300 g** at the end of the arm.
- **Holding still for a long time.** A camera arm spends most of its time holding a pose. The
  motors must hold without overheating, and the frame must not sag or shake.
- **Repeatable poses.** Absolute joint encoders mean no homing after power on.
- **Simple API from the Mac.** USB serial or Wi‑Fi, a Python library or plain commands.
- **5 axes is enough.** Base yaw, shoulder, elbow and wrist pitch place and aim the phone;
  wrist roll switches portrait and landscape. A 6th axis adds little for a camera.

## Comparison

Prices are EU, parts only, for **one arm** (no leader arm), without the printer. "Payload" is
the number the project publishes; reach is the horizontal radius.

| Project | Axes | Payload (published) | Reach | Motors | Controller and API | Build cost (EU) | Fit for a phone camera |
|---|---|---|---|---|---|---|---|
| [SO-ARM 102](https://github.com/roboninecom/SO-ARM-102) | 5 + gripper | **300 g** rated, 3.4 mm sag at 300 g fully extended (measured by Robonine) | 483 mm, base turns 352° | Feetech STS3250 (50 kg·cm) at shoulder and elbow, STS3235, STS3215; 12 V | Waveshare Bus Servo Adapter over USB serial; LeRobot (Python) | **€280 to €350** follower only (see BOM) | **Best.** Enough torque for a Pro Max, stiff, LeRobot compatible. New design (Sep 2026), needs PET-CF filament |
| [SO-101](https://github.com/TheRobotStudio/SO-ARM100) (SO-ARM100 successor) | 5 + gripper | Not published by The Robot Studio. Robonine lists **150 g** rated; Seeed advises at most 400 g with 12 V servos | 441 mm, base turns 220° | 6× Feetech STS3215, 7.4 V (19.5 kg·cm) or 12 V (30 kg·cm) | Same adapter, USB serial; [LeRobot](https://github.com/huggingface/lerobot) | **€140 to €170** with 12 V servos, follower only; repo BOM €124.30 with 7.4 V servos | Good for an iPhone SE. Marginal for a Pro Max at full extension |
| [PAROL6](https://github.com/PCrnjak/PAROL6-Desktop-robot-arm) | 6 | **1 kg** | 400 mm | Steppers with planetary gearboxes and belts | STM32 board over USB; [Python API](https://github.com/PCrnjak/PAROL6-python-API), GUI, ROS | Kit **€2,438.78**; partial kit €1,218.78; board €242.78; assembled €3,660 | Strong and precise, but 5.5 kg, steppers need homing, 7 to 20 times the price |
| [AR4 MK5](https://www.anninrobotics.com/) (Annin) | 6 | **1.9 kg** (4.15 lb) | 629 mm (24.75 in) | NEMA steppers (StepperOnline package) | Teensy 4.1 over USB; Python API, GUI, ROS 2 ([driver](https://github.com/ycheng517/ar4_ros_driver)) | Combo kit $1,189 + motors $699 = **$1,888 (≈ €1,680)** before US shipping and import VAT; parts can be printed instead of aluminum | Industrial overkill for a phone |
| [Thor](https://github.com/AngelLM/Thor) | 6 | **750 g** including tool | 625 mm tall | NEMA 17 steppers, printed gears and belts | Arduino Mega shield or 3D printer boards; G-code over serial (GRBL or RRF), ROS 2 | **Below €350** (project claim, not re-priced) | Plausible, G-code is easy to send. Big build, open-loop steppers need homing, printed gears add backlash |
| [Arctos](https://arctosrobotics.com/) | 6 | **2 kg** (vendor claim) | 600 mm | NEMA 17/23 steppers, optional closed-loop drivers | Arduino/ESP32 + CAN; Arctos GRBL, ROS/ROS 2, Arctos Studio | Home page says kits "starting at $231"; hardware kits not in the store today. CAD files cost €49.95 | Not fully free (CAD is sold). 10 kg arm; overkill |
| [BCN3D Moveo](https://github.com/BCN3D/BCN3D-Moveo) | 5 | Not published | Not published | NEMA 17 steppers | Arduino Mega + RAMPS, serial | About €400 (community estimate, not verified) | Old (2016), no maintained software, weak wrist. Skip |
| [Koch v1.1](https://github.com/jess-moss/koch-v1-1) | 5 + gripper | Not published | Not published | Dynamixel XL430 (2) + XL330 (4) | Waveshare adapter, LeRobot | Follower **€368** (repo EU BOM) | More expensive and weaker than SO-101. Skip |
| [EEZYbotARM MK2](https://github.com/LostKatana/EEZYbotARM-Mk2) | 3 + gripper | Not published | Small | Hobby PWM servos (MG995 class) | Arduino or ESP32 PWM | €30 to €50 (not verified) | No wrist pitch, no position feedback. Skip |
| [OpenArm](https://github.com/enactic/openarm) | 7 | 4.1 kg nominal | Human arm size | CAN motors | CAN, ROS 2 | About $6,500 per bimanual system (not verified) | Research platform, far too expensive |

### Ready-made arms (not printed, but open APIs)

| Product | Axes | Payload | Motors and API | Price | Note |
|---|---|---|---|---|---|
| [Waveshare RoArm-M2-S](https://www.waveshare.com/roarm-m2-s.htm) | 4 | **0.5 kg at 0.5 m** ([wiki](https://www.waveshare.com/wiki/RoArm-M2-S)) | ST3215 bus servos, dual servo shoulder; ESP32 with Wi‑Fi, JSON over HTTP or USB serial, ROS 2 | **$179.99 (≈ €160)** + shipping | Strongest per euro. Carbon and aluminum, not printed. Phone clamp mounts on the open EoAT plate. No wrist roll |
| [Waveshare RoArm-M3-S](https://www.waveshare.com/roarm-m3.htm) | 5 + 1 | 0.2 kg at 0.5 m | Same ESP32 JSON API | $239.99 (≈ €213) | Too weak for a Pro Max at reach |
| [Hiwonder xArm 1S](https://www.hiwonder.com/products/xarm-1s) | 6 | Not published | LX-15D bus servos; BLE app, USB to PC | $199.99 | Closed app protocol (see earlier research) |

## The pick: SO-ARM 102 follower as a phone camera arm

**Why this one:**

- **Torque where it matters.** The two STS3250 servos (50 kg·cm) carry the shoulder and elbow,
  the joints that hold the phone against gravity. Robonine measured 300 g rated payload, 3.3 A
  peak and 46 °C maximum servo temperature with 300 g on a repeating trajectory.
- **Stiff frame.** 3.4 mm deflection at 300 g fully extended, against 7.5 mm for SO-101.
  Less sag means less image shake and better repeat poses.
- **352° base rotation** (SO-101: 220°), so the phone can look around the whole desk.
- **Absolute encoders** in every servo: no homing, same pose after every power cycle.
- **Simplest Mac control.** One USB serial port, a documented servo protocol, LeRobot or the
  Feetech Python SDK. No firmware to flash, no motion controller in between.
- **Same family as SO-101**, the most built open arm (LeRobot, Hugging Face). Parts, servos and
  answers are easy to find. Fall back to SO-101 parts at any time.
- **Open hardware** (CERN-OHL-P-2.0), software Apache-2.0.

**Changes for the phone:**

- Leave out the gripper servo and the parallel gripper. Print a clamp that bolts to the wrist
  roll servo horn. Keep the phone's center of mass close to the wrist axes.
- Leave the Lightning or USB-C port free. Route the cable along the arm with slack at each
  joint, and add strain relief at the clamp so cable pull does not load the wrist.
- Use the wrist roll for portrait or landscape. The rear camera sits in a corner of the phone;
  the agent's pose math must include that offset.

### BOM: one follower, phone clamp instead of gripper

| Part | Qty | Price | Source |
|---|---|---|---|
| Feetech STS3250 12 V (shoulder, elbow) | 2 | $44.60 each (Alibaba) or $126.40 per 2 (AliExpress) | [SO-ARM 102 BOM](https://github.com/roboninecom/SO-ARM-102/blob/main/docs/bom.md) |
| Feetech STS3235 12 V (base, wrist flex) | 2 | $40.80 each (Alibaba); AliExpress $63.00 (unit not clear) | same |
| Feetech STS3215 12 V 30 kg (wrist roll) | 1 | $14.70 (Alibaba 6-pack) or [$21.99 at Waveshare](https://www.waveshare.com/st3215-servo.htm) | same |
| Waveshare Bus Servo Adapter (A) | 1 | €11.90 (Amazon.fr) or [$4.99 at Waveshare](https://www.waveshare.com/bus-servo-adapter-a.htm) | same |
| 12 V 5 A power supply, 5.5 × 2.1 mm | 1 | €12.00 (Amazon.fr) | same |
| USB-C data cable | 1 | €7.00 | same |
| 6812 base bearing | 1 | €7.40 per 2 (Amazon.fr) | same |
| C-clamps | 2 | €17.40 per 2 (Amazon.fr) | same |
| Servo cable 300 mm, fasteners | | about €10 (estimate) | same |
| Filament: PET-CF links (394 g) + PETG-CF base, no gripper | | about €25 to €35 (estimate) | [printing.md](https://github.com/roboninecom/SO-ARM-102/blob/main/docs/printing.md) |
| Phone clamp (printed, optional 1/4" phone clip) | 1 | about €10 (estimate, not verified) | |
| **Total** | | **≈ €270 with Alibaba servos, ≈ €330 with AliExpress servos** | |

Alibaba adds shipping and Italian import VAT (22%) that the listed prices do not include, so
budget **€280 to €350**. The ready kit from Robonine is
[$389 (≈ €345)](https://robonine.com/shop/so-arm102-robotic-arm-kit/) for leader plus follower;
first batch ships late October 2026. I did not check if it includes printed parts.

**Printing:** about 15.5 h for the follower links and 14 h for the base on a Bambu A1 profile.
PET-CF is abrasive: use a hardened nozzle. All parts fit a 180 × 180 mm bed.

### Budget alternative: SO-101 with 12 V servos

| Part | Qty | Price |
|---|---|---|
| Feetech STS3215 12 V 30 kg | 5 (buy 6, one spare) | $14.70 each on Alibaba (≈ €78 for 6) or $21.99 each at Waveshare (≈ €98 for 5) |
| Bus servo adapter, 12 V 5 A supply, USB-C cable, clamp | | €11.40 + €12 + €7 + €8 ([repo BOM](https://github.com/TheRobotStudio/SO-ARM100#parts-for-one-follower-arm)) |
| PLA+ filament, phone clamp | | about €20 (estimate) |
| **Total** | | **≈ €140 to €170** |

Note that the repo BOM uses 7.4 V servos with a 5 V supply. For a phone, buy the **12 V
version** and a 12 V supply, as the repo itself suggests for more torque.

## Payload check (my estimate, not measured)

Shoulder torque with the arm straight out, SO-101 geometry (about 113 mm + 135 mm links, phone
center about 80 mm past the wrist):

```
phone + clamp + cable   0.30 kg × 33 cm                      ≈ 10 kg·cm
arm's own weight        elbow, 2 wrist servos, links          ≈  4.5 kg·cm
total at the shoulder                                         ≈ 14.5 kg·cm

SO-101, STS3215 7.4 V   19.5 kg·cm stall (less on 5 V)        ≈ 75% or more   too much
SO-101, STS3215 12 V    30 kg·cm stall                        ≈ 48%           hot if held long
SO-ARM 102, STS3250     50 kg·cm stall                        ≈ 29%           comfortable
```

With an iPhone SE (about 210 g total) the SO-101 12 V figure drops to about 38%. Most camera
poses keep the elbow bent, which cuts the lever arm. Robonine also saw about 50 mm tip sag on
SO-101 class servos with stock PID at full extension, cut to about 5 mm with tuned PID.

## Non-arm options

| Rig | Axes | Control | Cost | When it fits better |
|---|---|---|---|---|
| [isaac879 Pan-Tilt-Mount](https://github.com/isaac879/Pan-Tilt-Mount) + slider | 2 or 3 (pan, tilt, slide) | Arduino Nano, NEMA 17 steppers, serial over USB or Bluetooth, hall sensor homing | About €80 to €180 (estimate, not verified) | Fixed scene viewed from a few angles. Built for a DSLR, so a phone is easy. Very stiff and precise |
| [Waveshare 2-axis pan-tilt module](https://www.waveshare.com/2-axis-pan-tilt-camera-module.htm) | 2 (pan 360°, tilt -45° to 90°) | ST3215 bus servos, ESP32, same JSON API as RoArm | $109.99 | Phone only needs to look around from one spot. Payload not published |
| [OpenGimbal](https://github.com/MStefan99/OpenGimbal) | 3 | USB or UART API | n/a | Not released yet (README says hardware is still in testing) |
| Old 3D printer or CoreXY gantry | 3 (X, Y, Z) | G-code over USB serial | Reuse | Top-down views of a flat area only |
| DJI Osmo Mobile, Insta360 Flow | 3 | Phone apps only; no supported Mac API found | €100 to €150 | Not a fit for an agent |

A pan-tilt head is the cheapest and most robust choice if the phone never needs to move to a
different place. Pick an arm when the agent must get close to objects or look from above and
from the side.

## Safety

- Put a **hardware power switch** on the 12 V line. Software stop is not enough.
- Set **torque and angle limits** in the servo registers (Feetech supports both), not only in
  the agent's prompt. Keep the arm clear of the Mac, cables and faces.
- Add a **rest pose** (folded, low gravity load) the arm goes to when idle, so the servos do not
  hold a phone at full extension for hours.
- A clamp failure drops the phone. Use a clamp with a positive lock, and test it with the phone
  upside down before letting the agent drive.

## Unverified numbers

- SO-101 payload: The Robot Studio publishes none. 150 g is Robonine's figure, 400 g is Seeed's
  advice, and the torque estimate above is mine.
- Arctos kit prices and payload: vendor claims; the hardware kits are not in its store today.
- Thor "below €350": project claim, not re-priced.
- Moveo, EEZYbotARM, OpenArm, pan-tilt and slider costs: estimates from search results.
- AliExpress servo unit prices in the SO-ARM 102 BOM: listing format is not clear.
- Filament, cable and phone clamp costs: my estimates.
- Shipping and import VAT for Alibaba and US orders (AR4) are not included anywhere.

## Sources

- SO-101: https://github.com/TheRobotStudio/SO-ARM100 and https://huggingface.co/docs/lerobot/so101
- SO-ARM 102: https://github.com/roboninecom/SO-ARM-102 (BOM, specifications, printing docs), kit https://robonine.com/shop/so-arm102-robotic-arm-kit/
- SO-101 kit prices: https://robonine.com/shop/so-arm101-black-white-robotic-arm-kit/ ($329 pair)
- PAROL6: https://source-robotics.com/products/parol6-robotic-arm-kit, https://source-robotics.com/collections/all
- AR4: https://www.anninrobotics.com/shop
- Thor: https://github.com/AngelLM/Thor
- Arctos: https://arctosrobotics.com/ and its store API (CAD €49.95)
- Moveo: https://github.com/BCN3D/BCN3D-Moveo
- Koch v1.1: https://github.com/jess-moss/koch-v1-1
- Waveshare: https://www.waveshare.com/roarm-m2-s.htm, https://www.waveshare.com/roarm-m3.htm, https://www.waveshare.com/st3215-servo.htm
- Hiwonder: https://www.hiwonder.com/products/xarm-1s
- Earlier research on iPhone-controlled arms: Discord thread "Phone-controlled robot arm research" (session ses_e5dd3592dffefunNH59OO4BzRb)
