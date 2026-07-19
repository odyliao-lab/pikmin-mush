[CmdletBinding()]
param(
    [ValidateSet('install', 'uninstall')]
    [string]$Action = 'install',
    [Parameter(Mandatory = $true)]
    [string]$Serial,
    [ValidateSet('virtual', 'screen-off')]
    [string]$Mode = 'virtual',
    [string]$ConfigPath,
    [string]$AdbPath = 'C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe'
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$supervisorPath = Join-Path $scriptDirectory 'supervisor.ps1'
$safeSerial = $Serial -replace '[^A-Za-z0-9_.-]', '_'
$taskName = "Pikmin Scanner Supervisor - $safeSerial"

if ($Action -eq 'uninstall') {
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($existing) {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
        Write-Host "Removed scheduled task: $taskName"
    } else {
        Write-Host "Scheduled task does not exist: $taskName"
    }
    exit
}

if (-not (Test-Path -LiteralPath $supervisorPath)) {
    throw "Supervisor script not found: $supervisorPath"
}
if ($ConfigPath) {
    $resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
    $taskConfig = Get-Content -LiteralPath $resolvedConfig -Raw | ConvertFrom-Json
    if (-not $PSBoundParameters.ContainsKey('AdbPath') -and $taskConfig.adbPath) {
        $AdbPath = [string]$taskConfig.adbPath
    }
}
if (-not (Test-Path -LiteralPath $AdbPath)) { throw "adb not found: $AdbPath" }
$deviceState = (& $AdbPath -s $Serial get-state 2>$null | Out-String).Trim()
if ($deviceState -ne 'device') { throw "ADB device is not ready: $Serial" }
$ownerCheck = "if test -f /data/adb/modules/pikmin_scanner_agent/config; then . /data/adb/modules/pikmin_scanner_agent/config; fi; echo LOCAL=`${LOCAL_DISPLAY:-0}; daemon_pid=`$(cat /data/local/tmp/pikmin-local-display-runtime/daemon.pid 2>/dev/null || true); if test -n `"`$daemon_pid`" && kill -0 `"`$daemon_pid`" 2>/dev/null && grep -Fq `"local-display.sh daemon`" /proc/`$daemon_pid/cmdline 2>/dev/null; then echo DAEMON=1; else echo DAEMON=0; fi; if test -x /data/adb/modules/pikmin_scanner_agent/local-display.sh && /data/adb/modules/pikmin_scanner_agent/local-display.sh status >/dev/null 2>&1; then echo DISPLAY=1; else echo DISPLAY=0; fi"
$ownerStatus = & $AdbPath -s $Serial shell "su -c '$ownerCheck'" 2>&1
if ($LASTEXITCODE -ne 0) { throw "Cannot verify on-device display ownership for ${Serial}: $($ownerStatus -join ' ')" }
if (($ownerStatus -join "`n") -match '(?m)^(LOCAL|DAEMON|DISPLAY)=1\s*$') {
    throw 'On-device display ownership is still enabled or running. Disable LOCAL_DISPLAY and stop its daemon before installing Windows Supervisor.'
}

$argumentParts = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$supervisorPath`"",
    'start', '-Serial', $Serial, '-Mode', $Mode
)
if ($ConfigPath) {
    $argumentParts += @('-ConfigPath', "`"$resolvedConfig`"")
}

$taskAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($argumentParts -join ' ')
$taskTrigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([timespan]::Zero)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $taskTrigger `
    -Settings $taskSettings -Principal $principal -Force | Out-Null
Write-Host "Installed scheduled task: $taskName"
Write-Host "It will start the Supervisor after $env:USERNAME logs in."
