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
$supervisorTaskName = "Pikmin Scanner Supervisor - $safeSerial"
$supervisorStatePath = Join-Path $env:LOCALAPPDATA "CodexTools\pikmin-supervisor\$safeSerial\state.json"
$compiler = Join-Path $NdkPath `
    'toolchains\llvm\prebuilt\windows-x86_64\bin\aarch64-linux-android28-clang.cmd'
$drainOutput = Join-Path $env:TEMP "pikmin-localvd-drain-$safeSerial"

foreach ($path in @($AdbPath, $ScrcpyServerPath, $compiler,
        (Join-Path $scriptDirectory 'local-display.sh'),
        (Join-Path $scriptDirectory 'localvd-drain.c'),
        (Join-Path $scriptDirectory 'agent.sh'),
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

function Get-HeadlessScrcpyProcess {
    $serialPattern = '(?i)(?:^|\s)"?--serial(?:=|\s+)"?' +
        [regex]::Escape($Serial) + '"?(?=\s|$)'
    $markerPattern = '(?i)(?:^|\s)"?--window-title=' +
        [regex]::Escape("PikminHeadless-$safeSerial") + '"?(?=\s|$)'
    try {
        $scrcpyProcesses = @(Get-CimInstance Win32_Process -Filter "Name='scrcpy.exe'" `
            -ErrorAction Stop)
    } catch {
        throw 'Cannot inspect Windows scrcpy processes; refusing to risk a second display owner.'
    }
    foreach ($process in $scrcpyProcesses) {
        $commandLine = [string]$process.CommandLine
        if ($commandLine -notmatch $serialPattern) { continue }
        $isMarkedSession = $commandLine -match $markerPattern -or
            $commandLine -match '(?i)--window-title=PikminHeadlessDisplay(?:"|\s|$)'
        $isLegacyVirtual = $commandLine -match '(?i)--new-display=720x1600/320' -and
            $commandLine -match '(?i)--start-app=com\.nianticlabs\.pikmin'
        $isLegacyScreenOff = $commandLine -match '(?i)--turn-screen-off' -and
            $commandLine -match '(?i)--no-window'
        if ($isMarkedSession -or $isLegacyVirtual -or $isLegacyScreenOff) { return $process }
    }
    return $null
}

$state = (& $AdbPath -s $Serial get-state 2>$null | Out-String).Trim()
if ($state -ne 'device') { throw "ADB device is not ready: $Serial" }
$abi = (& $AdbPath -s $Serial shell getprop ro.product.cpu.abi | Out-String).Trim()
if ($abi -ne 'arm64-v8a') { throw "This installer currently supports arm64-v8a, found: $abi" }
$rootId = (& $AdbPath -s $Serial shell su -c id | Out-String).Trim()
if ($rootId -notmatch 'uid=0') { throw 'Root access is unavailable.' }

$scheduledTaskCommand = Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue
if ($scheduledTaskCommand) {
    $existingTask = Get-ScheduledTask -TaskName $supervisorTaskName -ErrorAction SilentlyContinue
    if ($existingTask) {
        throw "Windows Supervisor task still exists: $supervisorTaskName. Uninstall it before enabling the on-device display owner."
    }
}
if (Test-Path -LiteralPath $supervisorStatePath) {
    try {
        $supervisorState = Get-Content -LiteralPath $supervisorStatePath -Raw | ConvertFrom-Json
    } catch { $supervisorState = $null }
    $supervisorProcess = if ($supervisorState -and $supervisorState.supervisorPid) {
        Get-Process -Id ([int]$supervisorState.supervisorPid) -ErrorAction SilentlyContinue
    } else { $null }
    if ($supervisorProcess -and $supervisorProcess.ProcessName -in @('powershell', 'pwsh')) {
        try {
            $commandLine = (Get-CimInstance Win32_Process -Filter `
                "ProcessId=$($supervisorProcess.Id)" -ErrorAction Stop).CommandLine
        } catch {
            throw "Cannot verify recorded Supervisor PID $($supervisorProcess.Id); stop it before installation."
        }
        if ($commandLine -match 'supervisor\.ps1') {
            throw "Windows Supervisor is still running for ${Serial} (PID $($supervisorProcess.Id)). Stop it before installation."
        }
    }
}
$headlessProcess = Get-HeadlessScrcpyProcess
if ($headlessProcess) {
    throw "Windows headless scrcpy is still running for ${Serial} (PID $($headlessProcess.ProcessId)). Stop it before installation."
}

& $compiler -O2 -Wall -Wextra -Werror -fPIE -pie `
    (Join-Path $scriptDirectory 'localvd-drain.c') -o $drainOutput
if ($LASTEXITCODE -ne 0) { throw 'Failed to build localvd-drain.' }

Invoke-Adb shell "rm -rf $stageDirectory && mkdir -p $stageDirectory"
Invoke-Adb push (Join-Path $scriptDirectory 'local-display.sh') "$stageDirectory/local-display.sh"
Invoke-Adb push (Join-Path $scriptDirectory 'service.sh') "$stageDirectory/service.sh"
Invoke-Adb push (Join-Path $scriptDirectory 'agent.sh') "$stageDirectory/agent.sh"
Invoke-Adb push $drainOutput "$stageDirectory/localvd-drain"
Invoke-Adb push $ScrcpyServerPath "$stageDirectory/scrcpy-server"

$installCommand = @"
set -e
test -d $moduleDirectory
chmod 755 $stageDirectory/local-display.sh $stageDirectory/localvd-drain
PIKMIN_LOCAL_DISPLAY_DIR=$stageDirectory $stageDirectory/local-display.sh stop
agent_pid=`$(cat $moduleDirectory/agent.pid 2>/dev/null || true)
if test -n "`$agent_pid" && kill -0 "`$agent_pid" 2>/dev/null &&
    grep -Fq "$moduleDirectory/agent.sh" /proc/`$agent_pid/cmdline 2>/dev/null; then
  kill "`$agent_pid" 2>/dev/null || true
  attempt=0
  while kill -0 "`$agent_pid" 2>/dev/null && test "`$attempt" -lt 50; do
    sleep 0.1
    attempt=`$((attempt + 1))
  done
  if kill -0 "`$agent_pid" 2>/dev/null &&
      grep -Fq "$moduleDirectory/agent.sh" /proc/`$agent_pid/cmdline 2>/dev/null; then
    kill -9 "`$agent_pid" 2>/dev/null || true
    attempt=0
    while kill -0 "`$agent_pid" 2>/dev/null && test "`$attempt" -lt 20; do
      sleep 0.1
      attempt=`$((attempt + 1))
    done
    if kill -0 "`$agent_pid" 2>/dev/null &&
        grep -Fq "$moduleDirectory/agent.sh" /proc/`$agent_pid/cmdline 2>/dev/null; then
      echo "Agent did not stop: `$agent_pid" >&2
      exit 1
    fi
  fi
fi
rm -f $moduleDirectory/agent.pid
cp $stageDirectory/local-display.sh $moduleDirectory/local-display.sh
cp $stageDirectory/service.sh $moduleDirectory/service.sh
cp $stageDirectory/agent.sh $moduleDirectory/agent.sh
cp $stageDirectory/localvd-drain $moduleDirectory/localvd-drain
cp $stageDirectory/scrcpy-server $moduleDirectory/scrcpy-server
chmod 755 $moduleDirectory/local-display.sh $moduleDirectory/service.sh $moduleDirectory/agent.sh $moduleDirectory/localvd-drain
chmod 644 $moduleDirectory/scrcpy-server
if grep -q ^LOCAL_DISPLAY= $moduleDirectory/config; then
  sed -i "s/^LOCAL_DISPLAY=.*/LOCAL_DISPLAY=1/" $moduleDirectory/config
else
  echo LOCAL_DISPLAY=1 >> $moduleDirectory/config
fi
rm -rf $stageDirectory
sh $moduleDirectory/service.sh
"@ -replace "`r", ''
$rollbackCommand = @"
rollback_failed=0
if test -f $moduleDirectory/config; then
  if grep -q ^LOCAL_DISPLAY= $moduleDirectory/config; then
    sed -i "s/^LOCAL_DISPLAY=.*/LOCAL_DISPLAY=0/" $moduleDirectory/config
  else
    echo LOCAL_DISPLAY=0 >> $moduleDirectory/config
  fi
fi
manager=$moduleDirectory/local-display.sh
if test -x $stageDirectory/local-display.sh; then manager=$stageDirectory/local-display.sh; fi
if test -x "`$manager"; then
  PIKMIN_LOCAL_DISPLAY_DIR=`$(dirname "`$manager") "`$manager" stop || rollback_failed=1
else
  rollback_failed=1
fi
rm -f $moduleDirectory/game.display
old_agent_still_alive=0
agent_pid=`$(cat $moduleDirectory/agent.pid 2>/dev/null || true)
if test -n "`$agent_pid" && kill -0 "`$agent_pid" 2>/dev/null &&
    grep -Fq "$moduleDirectory/agent.sh" /proc/`$agent_pid/cmdline 2>/dev/null; then
  kill "`$agent_pid" 2>/dev/null || true
  attempt=0
  while kill -0 "`$agent_pid" 2>/dev/null && test "`$attempt" -lt 50; do
    sleep 0.1
    attempt=`$((attempt + 1))
  done
  if kill -0 "`$agent_pid" 2>/dev/null &&
      grep -Fq "$moduleDirectory/agent.sh" /proc/`$agent_pid/cmdline 2>/dev/null; then
    kill -9 "`$agent_pid" 2>/dev/null || true
    sleep 1
    if kill -0 "`$agent_pid" 2>/dev/null &&
        grep -Fq "$moduleDirectory/agent.sh" /proc/`$agent_pid/cmdline 2>/dev/null; then
      rollback_failed=1
      old_agent_still_alive=1
    fi
  fi
fi
am start --display 0 -n com.nianticlabs.pikmin/com.nianticproject.ichigo.IchigoUnityPlayerActivity >/dev/null 2>&1 || true
if test "`$old_agent_still_alive" -eq 0 && test -x $moduleDirectory/agent.sh; then
  rm -f $moduleDirectory/agent.pid
  nohup $moduleDirectory/agent.sh >>$moduleDirectory/agent.log 2>&1 &
  new_agent_pid=`$!
  echo "`$new_agent_pid" >$moduleDirectory/agent.pid
  sleep 1
  if ! kill -0 "`$new_agent_pid" 2>/dev/null ||
      ! grep -Fq "$moduleDirectory/agent.sh" /proc/`$new_agent_pid/cmdline 2>/dev/null; then
    rollback_failed=1
  fi
elif test "`$old_agent_still_alive" -eq 0; then
  rollback_failed=1
fi
rm -rf $stageDirectory
exit "`$rollback_failed"
"@ -replace "`r", ''

$mutationStarted = $false
try {
    $mutationStarted = $true
    Invoke-Root $installCommand

    $healthy = $false
    for ($attempt = 0; $attempt -lt 45; $attempt++) {
        Start-Sleep -Seconds 2
        & $AdbPath -s $Serial shell `
            "su -c 'PIKMIN_LOCAL_DISPLAY_DIR=$moduleDirectory $moduleDirectory/local-display.sh status'"
        if ($LASTEXITCODE -eq 0) { $healthy = $true; break }
    }
    if (-not $healthy) { throw 'Local display did not become healthy within 90 seconds.' }
} catch {
    $installError = $_
    if ($mutationStarted) {
        try {
            Invoke-Root $rollbackCommand
            Write-Warning 'Installation failed; rolled back to LOCAL_DISPLAY=0 and restarted the Agent on display 0.'
        } catch {
            Write-Warning "Installation rollback also failed: $($_.Exception.Message)"
        }
    }
    throw $installError
}
Write-Host "Installed autonomous local display on $Serial."
