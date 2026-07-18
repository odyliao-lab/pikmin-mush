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
    if (-not $State) { return $null }
    $candidate = Get-Process -Id $State.pid -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.ProcessName -eq 'scrcpy') { return $candidate }
    return $null
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
    Clear-DeviceDisplay
    if ($state) {
        $managedProcess = Get-ManagedProcess $state
        if ($managedProcess) { Stop-Process -Id $managedProcess.Id -ErrorAction SilentlyContinue }
        Start-Sleep -Seconds 2
        Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
        if ($state.mode -eq 'virtual') {
            Invoke-Adb shell am start --display 0 -n "$packageName/$activityName" | Out-Null
        } else {
            Invoke-Adb shell input keyevent KEYCODE_WAKEUP | Out-Null
        }
    }
    Show-Status
    exit
}

if (-not (Test-Path -LiteralPath $ScrcpyPath)) { throw "scrcpy not found: $ScrcpyPath" }
$oldState = Read-State
if (Get-ManagedProcess $oldState) {
    throw "Headless session already running (PID $($oldState.pid)). Stop it first."
}

Clear-DeviceDisplay

$displaysBefore = (Invoke-Adb shell cmd display get-displays) -join "`n"
$existingDisplayIds = @([regex]::Matches($displaysBefore, 'Display id (\d+):[^\r\n]*scrcpy') |
    ForEach-Object { [int]$_.Groups[1].Value })

$scrcpyArguments = @('--serial', $script:deviceSerial, '--stay-awake', '--no-audio')
if ($Mode -eq 'virtual') {
    $scrcpyArguments += @(
        '--new-display=720x1600/320', "--start-app=$packageName", '--keep-active',
        '--max-fps=1', '--video-bit-rate=100K', '--window-x=-2000', '--window-y=-2000',
        '--window-width=64', '--window-height=64', '--window-title=PikminHeadlessDisplay'
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
    startedAt = (Get-Date).ToString('o')
} | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding utf8

Write-Host "Saved headless session state to $statePath."
Show-Status
