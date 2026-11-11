# Pikmin GPS Bridge (Android 9)

`agent_gps_bridge` is a deliberately small local helper for scanner phones on
Android 9. It accepts an explicit broadcast from the on-device Magisk Agent
and uses `LocationManager`'s GPS test provider to publish the same coordinate
to Android system location services.

It has no network permission, no activity, and no persistent location loop.
The Agent remains the only component that chooses scan coordinates.

This is an Android 9 compatibility helper, not a scanner, cloud client, mock
location hiding module, or proof that the game accepted a scan. Do not copy its
configuration to MuMu Android 15 or other Android versions without validation.
For current game/Hunter versions, identity checks, backup and upload/ACK gates,
start with [the Agent README](../phone_agent/README.md).

## Build

Install Android SDK platform 35 and a JDK, then run:

```powershell
# From this agent_gps_bridge directory; Gradle must already be available
gradle --no-daemon :app:assembleDebug
```

The resulting APK is `app/build/outputs/apk/debug/app-debug.apk`.

## One-time device setup

First confirm the intended device and preserve its existing Agent/config/token,
data and pending state with a verified device-local root-only backup. These
commands are for an authorized new bridge installation, not an instruction to
reset permissions or replace an existing device configuration during inspection.

```powershell
adb -s <serial> install -r .\app\build\outputs\apk\debug\app-debug.apk
adb -s <serial> shell pm grant cc.odyliao.pikmingpsbridge android.permission.ACCESS_FINE_LOCATION
adb -s <serial> shell su -c "appops set cc.odyliao.pikmingpsbridge android:mock_location allow"
```

For an Android 9 deployment validated with this bridge, set
`GPS_BRIDGE_PACKAGE=cc.odyliao.pikmingpsbridge` in the Agent's local `config`,
while retaining `SYSTEM_GPS_OVERRIDE=0`. Preserve all unrelated settings,
credentials and scoped uploader code.

## Verification

Use a harmless nearby coordinate first. A successful broadcast returns
`result=-1` and `dumpsys location` must show the same coordinate under the
`gps` provider before resuming production scans.

This confirms only system-location publication. Production acceptance also needs
three distinct new formal targets with fresh native objects, nonzero TSV rows,
accepted uploads, independently checked site acceptance and successful ACKs.

```powershell
adb -s <serial> shell am broadcast --user 0 `
  -n cc.odyliao.pikmingpsbridge/.GpsCommandReceiver `
  -a cc.odyliao.pikmingpsbridge.SET_LOCATION `
  --es lat 24.824 --es lng 121.014
adb -s <serial> shell dumpsys location
```

The bridge is only for owned, rooted scanner devices. Revoke its mock-location
AppOp or uninstall it to disable system-GPS publication immediately.
