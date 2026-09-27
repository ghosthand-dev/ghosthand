# Device access

- `.passcode` contains the local iPhone passcode. It is ignored by Git. Never print, upload, or commit its contents.
- To try the Bluetooth unlock flow, pass it to `iphonectl` as `IPHONECTL_PASSCODE` from `.passcode`. Do not put the passcode in command arguments or logs:

  ```sh
  IPHONECTL_PASSCODE="$(<.passcode)" .build/debug/iphonectl unlock
  ```

- Check the iPhone with `iphonectl list` before input. A wrong passcode is not retried because failed attempts count toward lockout.
