[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'status')]
    [string]$Action = 'status',

    [ValidateSet('virtual', 'screen-off')]
    [string]$Mode = 'virtual',

    [string]$Serial,
    [string]$AdbPath = 'C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe',
    [string]$ScrcpyPath = "$env:LOCALAPPDATA\CodexTools\scrcpy-v4.1\scrcpy.exe"
)

$ErrorActionPreference = 'Stop'
$packageName = 'com.nianticlabs.pikmin'
$activityName = 'com.nianticproject.ichigo.IchigoUnityPlayerActivity'
$displayFile = '/data/adb/modules/pikmin_scanner_agent/game.display'
$identityScript = Join-Path $PSScriptRoot 'windows-process-identity.ps1'
if (-not (Test-Path -LiteralPath $identityScript)) { throw "identity helper not found: $identityScript" }
. $identityScript

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & $AdbPath -s $script:deviceSerial @Arguments 2>&1 }
    finally { $ErrorActionPreference = $oldErrorActionPreference }
    if ($LASTEXITCODE -ne 0) {
        throw "adb failed: $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Invoke-AdbRoot([string]$Command) {
    $oldErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & $AdbPath -s $script:deviceSerial shell "su -c '$Command'" 2>&1 }
    finally { $ErrorActionPreference = $oldErrorActionPreference }
    if ($LASTEXITCODE -ne 0) {
        throw "root adb failed: $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Resolve-DeviceSerial {
    if ($Serial) { return $Serial }
    $devices = & $AdbPath devices | Select-String '^([^\s]+)\s+device$' |
        ForEach-Object { $_.Matches[0].Groups[1].Value }
    if ($devices.Count -ne 1) {
        throw "Expected exactly one connected ADB device; found $($devices.Count). Pass -Serial explicitly."
    }
    return $devices[0]
}

function Clear-DeviceDisplay {
    Invoke-AdbRoot "rm -f $displayFile" | Out-Null
}

function Set-DeviceDisplay([int]$DisplayId) {
    Write-Host "Configuring device display $DisplayId..."
    Invoke-AdbRoot "echo $DisplayId > $displayFile && chmod 600 $displayFile" | Out-Null
    $savedDisplayId = (Invoke-AdbRoot "cat $displayFile" | Out-String).Trim()
    if ($savedDisplayId -ne $DisplayId.ToString()) {
        throw "Failed to verify device display id (expected $DisplayId, got '$savedDisplayId')."
    }
}

function Read-State {
    if (Test-Path -LiteralPath $statePath) {
        return Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    }
    return $null
}

function Get-ManagedProcess($State) {
    if (-not $State -or -not $State.pid -or $State.serial -ne $script:deviceSerial) { return $null }
    $candidate = Get-Process -Id ([int]$State.pid) -ErrorAction SilentlyContinue
    if (-not $candidate -or $candidate.ProcessName -ne 'scrcpy') { return $null }
    try {
        $commandLine = (Get-CimInstance Win32_Process -Filter `
            "ProcessId=$($candidate.Id)" -ErrorAction Stop).CommandLine
    } catch { return $null }
    $marker = if ($State.marker) { [string]$State.marker } else { '' }
    $legacyMode = if ($State.marker) { '' } else { [string]$State.mode }
    if (-not (Test-PikminHeadlessCommandLine -CommandLine $commandLine `
            -Serial $script:deviceSerial -Marker $marker -LegacyMode $legacyMode)) {
        return $null
    }
    return $candidate
}

function Assert-OnDeviceDisplayDisabled {
    $module = '/data/adb/modules/pikmin_scanner_agent'
    $ownerStatus = (Invoke-AdbRoot @"
if test -f $module/config; then . $module/config; fi; echo LOCAL=`${LOCAL_DISPLAY:-0}; daemon_pid=`$(cat /data/local/tmp/pikmin-local-display-runtime/daemon.pid 2>/dev/null || true); if test -n "`$daemon_pid" && kill -0 "`$daemon_pid" 2>/dev/null && grep -Fq "local-display.sh daemon" /proc/`$daemon_pid/cmdline 2>/dev/null; then echo DAEMON=1; else echo DAEMON=0; fi; if test -x $module/local-display.sh && $module/local-display.sh status >/dev/null 2>&1; then echo DISPLAY=1; else echo DISPLAY=0; fi
"@) -join "`n"
    if ($ownerStatus -match '(?m)^(LOCAL|DAEMON|DISPLAY)=1\s*$') {
        throw 'On-device display ownership is still enabled or running. Set LOCAL_DISPLAY=0 and stop the local display daemon before starting Windows headless mode.'
    }
}

function Show-Status {
    $state = Read-State
    $process = Get-ManagedProcess $state
    $displays = (Invoke-Adb shell cmd display get-displays) -join "`n"
    $resumed = (Invoke-Adb shell dumpsys activity activities) |
        Select-String 'topResumedActivity|ResumedActivity:' | ForEach-Object Line
    [pscustomobject]@{
        Running = [bool]$process
        Mode = if ($state) { $state.mode } else { $null }
        ProcessId = if ($process) { $process.Id } else { $null }
        DisplayId = if ($state) { $state.displayId } else { $null }
        Device = $script:deviceSerial
        VirtualDisplayPresent = $displays -match 'Display id [1-9][0-9]*:.*scrcpy'
        GameResumed = [bool]($resumed -match [regex]::Escape($packageName))
    } | Format-List
}

if (-not (Test-Path -LiteralPath $AdbPath)) { throw "adb not found: $AdbPath" }
$script:deviceSerial = Resolve-DeviceSerial
Invoke-Adb get-state | Out-Null
$safeSerial = $script:deviceSerial -replace '[^A-Za-z0-9_.-]', '_'
$sessionMarker = "PikminHeadless-$safeSerial"
$stateDirectory = Join-Path $env:LOCALAPPDATA "CodexTools\pikmin-headless\$safeSerial"
$statePath = Join-Path $stateDirectory 'state.json'
$legacyStatePath = Join-Path $env:LOCALAPPDATA 'CodexTools\pikmin-headless\state.json'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null
if (-not (Test-Path -LiteralPath $statePath) -and (Test-Path -LiteralPath $legacyStatePath)) {
    $legacyState = Get-Content -LiteralPath $legacyStatePath -Raw | ConvertFrom-Json
    if ($legacyState.serial -eq $script:deviceSerial) {
        Move-Item -LiteralPath $legacyStatePath -Destination $statePath
    }
}

if ($Action -eq 'status') {
    Show-Status
    exit
}

if ($Action -eq 'stop') {
    $state = Read-State
    if ($state) {
        $managedProcess = Get-ManagedProcess $state
        $statePidProcess = if ($state.pid) {
            Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
        } else { $null }
        if (-not $managedProcess -and $statePidProcess -and
            $statePidProcess.ProcessName -eq 'scrcpy') {
            throw "State PID $($state.pid) is a live scrcpy process, but serial/session identity could not be verified. State was preserved; inspect the process manually."
        }
        if ($managedProcess) {
            Clear-DeviceDisplay
            Stop-Process -Id $managedProcess.Id -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            if ($state.mode -eq 'virtual') {
                Invoke-Adb shell am start --display 0 -n "$packageName/$activityName" | Out-Null
            } else {
                Invoke-Adb shell input keyevent KEYCODE_WAKEUP | Out-Null
            }
        }
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
    }
    Show-Status
    exit
}

if (-not (Test-Path -LiteralPath $ScrcpyPath)) { throw "scrcpy not found: $ScrcpyPath" }
Assert-OnDeviceDisplayDisabled
$oldState = Read-State
if (Get-ManagedProcess $oldState) {
    throw "Headless session already running (PID $($oldState.pid)). Stop it first."
}

Clear-DeviceDisplay

$displaysBefore = (Invoke-Adb shell cmd display get-displays) -join "`n"
$existingDisplayIds = @([regex]::Matches($displaysBefore, 'Display id (\d+):[^\r\n]*scrcpy') |
    ForEach-Object { [int]$_.Groups[1].Value })

$scrcpyArguments = @(
    '--serial', $script:deviceSerial, '--stay-awake', '--no-audio',
    "--window-title=$sessionMarker"
)
if ($Mode -eq 'virtual') {
    $scrcpyArguments += @(
        '--new-display=720x1600/320', "--start-app=$packageName", '--keep-active',
        '--max-fps=1', '--video-bit-rate=100K', '--window-x=-2000', '--window-y=-2000',
        '--window-width=64', '--window-height=64'
    )
} else {
    $scrcpyArguments += @('--turn-screen-off', '--no-window', '--max-size=640', '--max-fps=2')
}

$process = Start-Process -FilePath $ScrcpyPath -ArgumentList $scrcpyArguments `
    -WindowStyle Hidden -PassThru

$displayId = $null
if ($Mode -eq 'virtual') {
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline -and -not $process.HasExited) {
        Start-Sleep -Milliseconds 250
        $displayOutput = (Invoke-Adb shell cmd display get-displays) -join "`n"
        $newDisplayIds = @([regex]::Matches($displayOutput, 'Display id (\d+):[^\r\n]*scrcpy') |
            ForEach-Object { [int]$_.Groups[1].Value } |
            Where-Object { $_ -notin $existingDisplayIds })
        if ($newDisplayIds.Count -eq 1) {
            $displayId = $newDisplayIds[0]
            break
        }
    }
    if ($null -eq $displayId) {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        throw 'scrcpy did not create exactly one new virtual display.'
    }
    Write-Host "scrcpy created display $displayId (PID $($process.Id))."
    try {
        Set-DeviceDisplay $displayId
    } catch {
        Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
        Clear-DeviceDisplay
        throw
    }
}

[pscustomobject]@{
    pid = $process.Id
    mode = $Mode
    displayId = $displayId
    serial = $script:deviceSerial
    marker = $sessionMarker
    startedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

Write-Host "Saved headless session state to $statePath."
Show-Status
