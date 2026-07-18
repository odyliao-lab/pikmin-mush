[CmdletBinding()]
param(
    [ValidateSet('start', 'run', 'once', 'status', 'stop', 'shutdown')]
    [string]$Action = 'status',
    [string]$ConfigPath,
    [string]$Serial,
    [ValidateSet('', 'virtual', 'screen-off')]
    [string]$Mode = ''
)

$ErrorActionPreference = 'Stop'
$packageName = 'com.nianticlabs.pikmin'
$activityName = 'com.nianticproject.ichigo.IchigoUnityPlayerActivity'
$agentModule = '/data/adb/modules/pikmin_scanner_agent'
$displayFile = "$agentModule/game.display"
$headlessScript = Join-Path $PSScriptRoot 'headless-agent.ps1'

$config = if ($ConfigPath) {
    Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
} else { $null }

function Get-ConfigValue([string]$Name, $Default) {
    if ($config -and $config.PSObject.Properties.Name -contains $Name) {
        return $config.$Name
    }
    return $Default
}

$adbPath = [string](Get-ConfigValue 'adbPath' 'C:\Program Files\Netease\MuMuPlayer\nx_main\adb.exe')
$scrcpyPath = [string](Get-ConfigValue 'scrcpyPath' "$env:LOCALAPPDATA\CodexTools\scrcpy-v4.1\scrcpy.exe")
$effectiveMode = if ($Mode) { $Mode } else { [string](Get-ConfigValue 'mode' 'virtual') }
$pollSeconds = [int](Get-ConfigValue 'pollSeconds' 10)
$gameResumeGraceSeconds = [int](Get-ConfigValue 'gameResumeGraceSeconds' 45)
$recoveryCooldownSeconds = [int](Get-ConfigValue 'recoveryCooldownSeconds' 20)
$tsvStaleWarningSeconds = [int](Get-ConfigValue 'tsvStaleWarningSeconds' 900)
$maxRecoveryAttempts = [int](Get-ConfigValue 'maxRecoveryAttempts' 20)
$logMaxBytes = [long](Get-ConfigValue 'logMaxBytes' 5242880)

if (-not (Test-Path -LiteralPath $adbPath)) { throw "adb not found: $adbPath" }
if ($effectiveMode -notin @('virtual', 'screen-off')) { throw "Invalid mode: $effectiveMode" }

function Resolve-DeviceSerial {
    if ($Serial) { return $Serial }
    $configuredSerial = [string](Get-ConfigValue 'serial' '')
    if ($configuredSerial -and $configuredSerial -ne 'ANDROID_ADB_SERIAL') { return $configuredSerial }
    $devices = @(& $adbPath devices | Select-String '^([^\s]+)\s+device$' |
        ForEach-Object { $_.Matches[0].Groups[1].Value })
    if ($devices.Count -ne 1) {
        throw "Expected one connected ADB device or an explicit serial; found $($devices.Count)."
    }
    return $devices[0]
}

$deviceSerial = Resolve-DeviceSerial
$safeSerial = $deviceSerial -replace '[^A-Za-z0-9_.-]', '_'
$stateDirectory = Join-Path $env:LOCALAPPDATA "CodexTools\pikmin-supervisor\$safeSerial"
$headlessStatePath = Join-Path $env:LOCALAPPDATA "CodexTools\pikmin-headless\$safeSerial\state.json"
$statePath = Join-Path $stateDirectory 'state.json'
$logPath = Join-Path $stateDirectory 'supervisor.log'
$logBackupPath = Join-Path $stateDirectory 'supervisor.log.1'
$stopRequestPath = Join-Path $stateDirectory 'stop.request'
New-Item -ItemType Directory -Path $stateDirectory -Force | Out-Null

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    try { return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json }
    catch { return $null }
}

function Write-Log([string]$Level, [string]$Message) {
    if ((Test-Path -LiteralPath $logPath) -and
        (Get-Item -LiteralPath $logPath).Length -ge $logMaxBytes) {
        Move-Item -LiteralPath $logPath -Destination $logBackupPath -Force
    }
    $line = "$(Get-Date -Format o) [$Level] $Message"
    Add-Content -LiteralPath $logPath -Value $line -Encoding utf8
    if ($Action -in @('run', 'once')) { Write-Host $line }
}

function Invoke-Adb {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & $adbPath -s $deviceSerial @Arguments 2>&1 }
    finally { $ErrorActionPreference = $oldPreference }
    if ($LASTEXITCODE -ne 0) {
        throw "adb failed: $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Invoke-AdbRoot([string]$Command) {
    $oldPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { $output = & $adbPath -s $deviceSerial shell "su -c '$Command'" 2>&1 }
    finally { $ErrorActionPreference = $oldPreference }
    if ($LASTEXITCODE -ne 0) {
        throw "root adb failed: $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Get-ProcessByNameAndId($ProcessId, [string]$Name) {
    if (-not $ProcessId) { return $null }
    $candidate = Get-Process -Id ([int]$ProcessId) -ErrorAction SilentlyContinue
    if ($candidate -and $candidate.ProcessName -eq $Name) { return $candidate }
    return $null
}

function Get-SupervisorProcess($State) {
    if (-not $State -or -not $State.supervisorPid) { return $null }
    $candidate = Get-Process -Id ([int]$State.supervisorPid) -ErrorAction SilentlyContinue
    if (-not $candidate -or $candidate.ProcessName -notin @('powershell', 'pwsh')) { return $null }
    try {
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($candidate.Id)").CommandLine
        if ($commandLine -notmatch [regex]::Escape($PSCommandPath) -or $commandLine -notmatch '\brun\b') {
            return $null
        }
    } catch { return $null }
    return $candidate
}

function Save-State($Snapshot) {
    $temporaryPath = "$statePath.tmp"
    $Snapshot | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporaryPath -Encoding utf8
    Move-Item -LiteralPath $temporaryPath -Destination $statePath -Force
}

function Show-State {
    $state = Read-JsonFile $statePath
    if (-not $state) {
        Write-Host "No Supervisor state for $deviceSerial."
        return
    }
    $state | Format-List status,lastCheck,supervisorPid,serial,mode,adbConnected,
        headlessRunning,displayId,displayPresent,gamePid,gameResumed,agentPid,agentAlive,
        tsvBytes,lastTsvGrowthAt,recoveryAttempts,lastRecovery,lastError
}

function Invoke-Headless([ValidateSet('start', 'stop')][string]$HeadlessAction) {
    $arguments = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $headlessScript,
        $HeadlessAction, '-Mode', $effectiveMode, '-Serial', $deviceSerial,
        '-AdbPath', $adbPath, '-ScrcpyPath', $scrcpyPath
    )
    $output = & powershell.exe @arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "headless $HeadlessAction failed: $($output -join [Environment]::NewLine)"
    }
    Write-Log 'INFO' "headless $HeadlessAction completed"
}

function Get-DeviceSnapshot {
    $snapshot = [ordered]@{
        adbConnected = $false
        headlessRunning = $false
        displayId = $null
        displayPresent = $false
        gamePid = $null
        gameResumed = $false
        agentPid = $null
        agentAlive = $false
        tsvBytes = 0L
    }
    try {
        $snapshot.adbConnected = ((Invoke-Adb get-state | Out-String).Trim() -eq 'device')
    } catch { return [pscustomobject]$snapshot }
    if (-not $snapshot.adbConnected) { return [pscustomobject]$snapshot }

    $headlessState = Read-JsonFile $headlessStatePath
    $scrcpy = if ($headlessState) {
        Get-ProcessByNameAndId $headlessState.pid 'scrcpy'
    } else { $null }
    $snapshot.headlessRunning = [bool]$scrcpy
    if ($headlessState -and $headlessState.displayId -ne $null) {
        $snapshot.displayId = [int]$headlessState.displayId
    }

    $displayOutput = (Invoke-Adb shell cmd display get-displays) -join "`n"
    if ($effectiveMode -eq 'virtual' -and $snapshot.displayId -ne $null) {
        $snapshot.displayPresent = $displayOutput -match
            "Display id $($snapshot.displayId):[^\r\n]*scrcpy"
        $deviceDisplay = (Invoke-AdbRoot "cat $displayFile 2>/dev/null || true" | Out-String).Trim()
        if ($deviceDisplay -ne $snapshot.displayId.ToString()) { $snapshot.displayPresent = $false }
    } else {
        $snapshot.displayPresent = ($effectiveMode -eq 'screen-off' -and $snapshot.headlessRunning)
    }

    $snapshot.gamePid = (Invoke-Adb shell pidof $packageName | Out-String).Trim()
    $activities = (Invoke-Adb shell dumpsys activity activities) -join "`n"
    $resumedLines = $activities -split "`r?`n" |
        Where-Object { $_ -match 'topResumedActivity|ResumedActivity:' }
    $snapshot.gameResumed = [bool]($resumedLines -match [regex]::Escape($packageName))

    $agentCommand = 'p=$(cat /data/adb/modules/pikmin_scanner_agent/agent.pid 2>/dev/null); echo PID:$p; if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then echo ALIVE:1; else echo ALIVE:0; fi'
    $agentStatus = (Invoke-AdbRoot $agentCommand) -join "`n"
    if ($agentStatus -match 'PID:([0-9]+)') { $snapshot.agentPid = $Matches[1] }
    $snapshot.agentAlive = $agentStatus -match 'ALIVE:1'

    $sizeCommand = 'stat -c %s /data/user/0/com.nianticlabs.pikmin/files/mushrooms.tsv 2>/dev/null || echo 0'
    $sizeText = (Invoke-AdbRoot $sizeCommand | Out-String).Trim()
    if ($sizeText -match '^\d+$') { $snapshot.tsvBytes = [long]$sizeText }
    return [pscustomobject]$snapshot
}

$runtime = [ordered]@{
    lastTsvBytes = 0L
    lastTsvGrowthAt = $null
    gameNotResumedSince = $null
    recoveryAttempts = 0
    lastRecoveryAt = $null
    lastRecovery = ''
    lastError = ''
}

$previousState = Read-JsonFile $statePath
if ($previousState) {
    if ($previousState.tsvBytes) { $runtime.lastTsvBytes = [long]$previousState.tsvBytes }
    if ($previousState.lastTsvGrowthAt) { $runtime.lastTsvGrowthAt = [datetime]$previousState.lastTsvGrowthAt }
}
if (-not $runtime.lastTsvGrowthAt) { $runtime.lastTsvGrowthAt = Get-Date }

function Can-Recover {
    if ($runtime.recoveryAttempts -ge $maxRecoveryAttempts) { return $false }
    if (-not $runtime.lastRecoveryAt) { return $true }
    return ((Get-Date) - $runtime.lastRecoveryAt).TotalSeconds -ge $recoveryCooldownSeconds
}

function Record-Recovery([string]$Description) {
    $runtime.recoveryAttempts++
    $runtime.lastRecoveryAt = Get-Date
    $runtime.lastRecovery = $Description
    Write-Log 'WARN' "recovery $($runtime.recoveryAttempts)/${maxRecoveryAttempts}: $Description"
}

function Write-Snapshot($Device, [string]$Status) {
    $age = [int]((Get-Date) - $runtime.lastTsvGrowthAt).TotalSeconds
    Save-State ([pscustomobject][ordered]@{
        status = $Status
        lastCheck = (Get-Date).ToString('o')
        supervisorPid = $PID
        serial = $deviceSerial
        mode = $effectiveMode
        adbConnected = $Device.adbConnected
        headlessRunning = $Device.headlessRunning
        displayId = $Device.displayId
        displayPresent = $Device.displayPresent
        gamePid = $Device.gamePid
        gameResumed = $Device.gameResumed
        agentPid = $Device.agentPid
        agentAlive = $Device.agentAlive
        tsvBytes = $Device.tsvBytes
        lastTsvGrowthAt = $runtime.lastTsvGrowthAt.ToString('o')
        tsvStaleSeconds = $age
        recoveryAttempts = $runtime.recoveryAttempts
        lastRecovery = $runtime.lastRecovery
        lastError = $runtime.lastError
    })
}

function Invoke-HealthPass {
    $device = Get-DeviceSnapshot
    if (-not $device.adbConnected) {
        $runtime.lastError = 'ADB device offline'
        Write-Snapshot $device 'offline'
        return
    }

    if ($device.tsvBytes -gt $runtime.lastTsvBytes) {
        $runtime.lastTsvBytes = $device.tsvBytes
        $runtime.lastTsvGrowthAt = Get-Date
    }

    $headlessHealthy = $device.headlessRunning -and $device.displayPresent
    if (-not $headlessHealthy -and (Can-Recover)) {
        Record-Recovery 'rebuild headless display session'
        try {
            Invoke-Headless stop
            Invoke-Headless start
            $device = Get-DeviceSnapshot
        } catch {
            $runtime.lastError = $_.Exception.Message
            Write-Log 'ERROR' $runtime.lastError
        }
    }

    if (-not $device.agentAlive -and (Can-Recover)) {
        Record-Recovery 'restart dead phone Agent'
        try {
            Invoke-AdbRoot "rm -f $agentModule/agent.pid && sh $agentModule/service.sh" | Out-Null
            Start-Sleep -Seconds 3
            $device = Get-DeviceSnapshot
        } catch {
            $runtime.lastError = $_.Exception.Message
            Write-Log 'ERROR' $runtime.lastError
        }
    }

    if ($device.gameResumed) {
        $runtime.gameNotResumedSince = $null
    } else {
        if (-not $runtime.gameNotResumedSince) { $runtime.gameNotResumedSince = Get-Date }
        $notResumedFor = ((Get-Date) - $runtime.gameNotResumedSince).TotalSeconds
        if ($notResumedFor -ge $gameResumeGraceSeconds -and (Can-Recover)) {
            Record-Recovery 'resume Pikmin activity on managed display'
            try {
                if ($effectiveMode -eq 'virtual' -and $device.displayId -ne $null) {
                    Invoke-Adb shell am start --display $device.displayId -n "$packageName/$activityName" | Out-Null
                } else {
                    Invoke-Adb shell am start -n "$packageName/$activityName" | Out-Null
                }
                $runtime.gameNotResumedSince = Get-Date
            } catch {
                $runtime.lastError = $_.Exception.Message
                Write-Log 'ERROR' $runtime.lastError
            }
        }
    }

    $stale = ((Get-Date) - $runtime.lastTsvGrowthAt).TotalSeconds -ge $tsvStaleWarningSeconds
    $healthy = $device.headlessRunning -and $device.displayPresent -and
        $device.gameResumed -and $device.agentAlive
    $status = if ($healthy -and -not $stale) { 'healthy' } else { 'degraded' }
    if ($stale) { $runtime.lastError = "TSV has not grown for at least $tsvStaleWarningSeconds seconds" }
    elseif ($healthy) { $runtime.lastError = '' }
    Write-Snapshot $device $status
}

if ($Action -eq 'status') { Show-State; exit }

if ($Action -in @('stop', 'shutdown')) {
    $state = Read-JsonFile $statePath
    $supervisor = Get-SupervisorProcess $state
    if ($supervisor) {
        Set-Content -LiteralPath $stopRequestPath -Value $Action -Encoding ascii
        $supervisor.WaitForExit(20000) | Out-Null
        if (-not $supervisor.HasExited) {
            Stop-Process -Id $supervisor.Id -ErrorAction SilentlyContinue
        }
    } elseif ($Action -eq 'shutdown') {
        Invoke-Headless stop
    }
    Show-State
    exit
}

if ($Action -eq 'start') {
    $state = Read-JsonFile $statePath
    if (Get-SupervisorProcess $state) { throw "Supervisor is already running (PID $($state.supervisorPid))." }
    Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue
    $launchArguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", 'run')
    if ($ConfigPath) { $launchArguments += @('-ConfigPath', "`"$ConfigPath`"") }
    $launchArguments += @('-Serial', $deviceSerial, '-Mode', $effectiveMode)
    $process = Start-Process -FilePath 'powershell.exe' -ArgumentList $launchArguments `
        -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(12)
    do {
        Start-Sleep -Milliseconds 250
        $state = Read-JsonFile $statePath
    } while ((Get-Date) -lt $deadline -and
        (-not $state -or [int]$state.supervisorPid -ne $process.Id))
    if (-not $state -or [int]$state.supervisorPid -ne $process.Id) {
        throw "Supervisor PID $($process.Id) did not publish state. See $logPath"
    }
    Show-State
    exit
}

$mutexName = "Local\PikminSupervisor_$safeSerial"
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
if (-not $mutex.WaitOne(0)) { throw "Another Supervisor run loop already owns $deviceSerial." }
try {
    Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue
    Write-Log 'INFO' "Supervisor started pid=$PID serial=$deviceSerial mode=$effectiveMode"
    do {
        try { Invoke-HealthPass }
        catch {
            $runtime.lastError = $_.Exception.Message
            Write-Log 'ERROR' $runtime.lastError
            $fallback = [pscustomobject]@{
                adbConnected=$false; headlessRunning=$false; displayId=$null; displayPresent=$false
                gamePid=$null; gameResumed=$false; agentPid=$null; agentAlive=$false; tsvBytes=0L
            }
            Write-Snapshot $fallback 'degraded'
        }
        if ($Action -eq 'once') { break }
        $waited = 0
        while ($waited -lt $pollSeconds -and -not (Test-Path -LiteralPath $stopRequestPath)) {
            Start-Sleep -Seconds 1
            $waited++
        }
    } while (-not (Test-Path -LiteralPath $stopRequestPath))

    if (Test-Path -LiteralPath $stopRequestPath) {
        $request = (Get-Content -LiteralPath $stopRequestPath -Raw).Trim()
        if ($request -eq 'shutdown') { Invoke-Headless stop }
        Remove-Item -LiteralPath $stopRequestPath -Force -ErrorAction SilentlyContinue
    }
    $finalDevice = Get-DeviceSnapshot
    Write-Snapshot $finalDevice 'stopped'
    Write-Log 'INFO' 'Supervisor stopped'
} finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
