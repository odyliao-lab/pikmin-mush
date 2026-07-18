[CmdletBinding()]
param(
    [ValidateSet('install', 'uninstall')]
    [string]$Action = 'install',
    [Parameter(Mandatory = $true)]
    [string]$Serial,
    [ValidateSet('virtual', 'screen-off')]
    [string]$Mode = 'virtual',
    [string]$ConfigPath
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

$argumentParts = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$supervisorPath`"",
    'start', '-Serial', $Serial, '-Mode', $Mode
)
if ($ConfigPath) {
    $resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
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
