[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Serial,
    [string]$AdbPath = 'C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe',
    [string]$ScrcpyServerPath = "$env:LOCALAPPDATA\CodexTools\scrcpy-v4.1\scrcpy-server",
    [string]$NdkPath = "$env:LOCALAPPDATA\CodexTools\android-ndk\android-ndk-r27d"
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$moduleDirectory = '/data/adb/modules/pikmin_scanner_agent'
$stageDirectory = '/data/local/tmp/pikmin-local-display-install'
$safeSerial = $Serial -replace '[^A-Za-z0-9_.-]', '_'
$compiler = Join-Path $NdkPath `
    'toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android28-clang.cmd'
$drainOutput = Join-Path $env:TEMP "pikmin-localvd-drain-$safeSerial"

foreach ($path in @($AdbPath, $ScrcpyServerPath, $compiler,
        (Join-Path $scriptDirectory 'local-display.sh'),
        (Join-Path $scriptDirectory 'localvd-drain.c'),
        (Join-Path $scriptDirectory 'service.sh'))) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required file not found: $path" }
}

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    & $AdbPath -s $Serial @Arguments
    if ($LASTEXITCODE -ne 0) { throw "ADB failed: $($Arguments -join ' ')" }
}

function Invoke-Root {
    param([string]$Command)
    Invoke-Adb shell "su -c '$Command'"
}

$state = (& $AdbPath -s $Serial get-state 2>$null | Out-String).Trim()
if ($state -ne 'device') { throw "ADB device is not ready: $Serial" }
$abi = (& $AdbPath -s $Serial shell getprop ro.product.cpu.abi | Out-String).Trim()
if ($abi -ne 'arm64-v8a') { throw "This installer currently supports arm64-v8a, found: $abi" }
$rootId = (& $AdbPath -s $Serial shell su -c id | Out-String).Trim()
if ($rootId -notmatch 'uid=0') { throw 'Root access is unavailable.' }

& $compiler -O2 -Wall -Wextra -Werror -fPIE -pie `
    (Join-Path $scriptDirectory 'localvd-drain.c') -o $drainOutput
if ($LASTEXITCODE -ne 0) { throw 'Failed to build localvd-drain.' }

Invoke-Adb shell "rm -rf $stageDirectory && mkdir -p $stageDirectory"
Invoke-Adb push (Join-Path $scriptDirectory 'local-display.sh') "$stageDirectory/local-display.sh"
Invoke-Adb push (Join-Path $scriptDirectory 'service.sh') "$stageDirectory/service.sh"
Invoke-Adb push $drainOutput "$stageDirectory/localvd-drain"
Invoke-Adb push $ScrcpyServerPath "$stageDirectory/scrcpy-server"

$installCommand = @"
set -e
test -d $moduleDirectory
if test -x $moduleDirectory/local-display.sh; then
  PIKMIN_LOCAL_DISPLAY_DIR=$moduleDirectory $moduleDirectory/local-display.sh stop || true
fi
cp $stageDirectory/local-display.sh $moduleDirectory/local-display.sh
cp $stageDirectory/service.sh $moduleDirectory/service.sh
cp $stageDirectory/localvd-drain $moduleDirectory/localvd-drain
cp $stageDirectory/scrcpy-server $moduleDirectory/scrcpy-server
chmod 755 $moduleDirectory/local-display.sh $moduleDirectory/service.sh $moduleDirectory/localvd-drain
chmod 644 $moduleDirectory/scrcpy-server
if grep -q ^LOCAL_DISPLAY= $moduleDirectory/config; then
  sed -i "s/^LOCAL_DISPLAY=.*/LOCAL_DISPLAY=1/" $moduleDirectory/config
else
  echo LOCAL_DISPLAY=1 >> $moduleDirectory/config
fi
rm -rf $stageDirectory
PIKMIN_LOCAL_DISPLAY_DIR=$moduleDirectory $moduleDirectory/local-display.sh start-daemon
"@ -replace "`r", ''
Invoke-Root $installCommand

$healthy = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    Start-Sleep -Seconds 2
    & $AdbPath -s $Serial shell `
        "su -c 'PIKMIN_LOCAL_DISPLAY_DIR=$moduleDirectory $moduleDirectory/local-display.sh status'"
    if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
}
if (-not $healthy) { throw 'Local display did not become healthy within 90 seconds.' }
Write-Host "Installed autonomous local display on $Serial."
