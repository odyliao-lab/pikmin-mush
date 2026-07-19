# PC-only emulator lab

Status on 2026-07-19: native capture injection is proven on the isolated MuMu Player 15
lab VM, but the VM is not a viable Scanner node. Google login returns to the login-method
screen even when the Pikmin hook module is completely disabled. This matches Pikmin's
unsupported rooted-device policy and the VM's inability to provide a trusted physical-device
integrity verdict.

## Proven chain

1. MuMu Player 15 VM 1 (`PikminScannerLab`) runs Android 15 with KernelSU 3.2.5.
2. The VM was cloned from VM 0, then `pm clear com.nianticlabs.pikmin` was run before the
   game was launched. VM 0 was not modified.
3. Official Zygisk Next 1.4.3 was installed on the clone. `znctl status` reported active
   injection for both Zygotes.
4. `module/build-dual-abi.ps1` builds:
   - `x86_64.so`: Zygisk loader running in MuMu's x86_64 Zygote.
   - `arm64-v8a.so`: capture payload loaded into the translated ARM64 game runtime.
5. The loader resolves Android 15's JavaVM and MuMu's `libnb.so` through xDL when linker
   namespaces reject ordinary `dlopen`/`dlsym`.
6. MuMu's Native Bridge loaded the ARM64 payload. Runtime logs confirmed:
   - ARM64 `libil2cpp.so` found.
   - `RegisterMapObject` mushroom hook installed.
   - location-controller `Update` hook installed.
   - the Pikmin process remained alive.

## Rebuild

The defaults expect the locally verified NDK r27d and CMake/Ninja tools under
`%LOCALAPPDATA%\CodexTools`. Override the parameters on another machine.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\module\build-dual-abi.ps1
```

Outputs are written to `build_zygisk\dual-abi\zygisk\arm64-v8a.so` and
`build_zygisk\dual-abi\zygisk\x86_64.so`.

## Blocking result

The test account completed Google's UI flow, but Pikmin returned to its login-method screen.
An A/B run with `/data/adb/modules/zygisk_pikmin_hunter/disable` and `modules64:0` produced
the same result, excluding the capture hook as the cause. The VM itself uses KernelSU and
an emulated Android image, so it cannot be treated as a genuine certified physical device.

The dual-ABI loader remains useful for reverse-engineering and pre-login compatibility tests,
but work on making MuMu a production Scanner stops here. Passing the server-side trust gate
would require integrity circumvention and would still expose test/production accounts to
enforcement risk.

The supported project direction is the physical-phone headless mode in `HEADLESS.md`: the
phone retains the valid game environment while the PC owns the hidden display, lifecycle,
health checks, and Agent control.
