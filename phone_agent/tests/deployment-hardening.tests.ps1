$ErrorActionPreference = 'Stop'

$phoneAgentDirectory = Split-Path -Parent $PSScriptRoot
$installerPath = Join-Path $phoneAgentDirectory 'install-local-display.ps1'
$displayManagerPath = Join-Path $phoneAgentDirectory 'local-display.sh'
$installer = Get-Content -LiteralPath $installerPath -Raw
$displayManager = Get-Content -LiteralPath $displayManagerPath -Raw

$tokens = $null
$parseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
    $installerPath, [ref]$tokens, [ref]$parseErrors) > $null
if ($parseErrors.Count -ne 0) {
    throw "Installer has PowerShell parse errors: $($parseErrors -join '; ')"
}

function Assert-Contains {
    param([string]$Text, [string]$Pattern, [string]$Failure)
    if ($Text -notmatch $Pattern) { throw $Failure }
}

Assert-Contains $installer '\[switch\]\$RecoverStaleInstall' `
    'Installer is missing the explicit stale-lock recovery switch.'
Assert-Contains $installer "pikmin-local-display-install\.lock" `
    'Installer is missing the phone-side install lock.'
Assert-Contains $installer 'kill -0 "`\$lock_pid"[\s\S]*?/proc/`\$lock_pid/cmdline' `
    'Stale recovery does not verify the recorded phone process identity.'
Assert-Contains $installer 'echo `\$`\$ > \$installLockDirectory/pid' `
    'Remote installer PID is not published in the lock.'
Assert-Contains $installer 'finally\s*\{[\s\S]*?Invoke-Root \$releaseLockCommand' `
    'Install lock is not released from a finally block.'
Assert-Contains $installer 'cat \$installLockDirectory/owner[\s\S]*?= "\$installId"[\s\S]*?rm -rf \$installLockDirectory' `
    'Lock release is not guarded by the unique owner id.'

$acquireIndex = $installer.IndexOf('Invoke-Root $acquireLockCommand')
$compileIndex = $installer.IndexOf('& $compiler -O2')
$pushIndex = $installer.IndexOf('Invoke-Adb push')
if ($acquireIndex -lt 0 -or $compileIndex -lt 0 -or $pushIndex -lt 0 -or
    $acquireIndex -gt $compileIndex -or $acquireIndex -gt $pushIndex) {
    throw 'Install lock must be acquired before compilation and the first staged push.'
}

$displayWriteIndex = $displayManager.LastIndexOf('echo "$display_id" > "$DISPLAY_FILE"')
$forceStopIndex = $displayManager.LastIndexOf('am force-stop "$PACKAGE"')
$displayStartIndex = $displayManager.LastIndexOf('am start --display "$display_id"')
if ($displayWriteIndex -lt 0 -or $forceStopIndex -lt 0 -or $displayStartIndex -lt 0 -or
    $displayWriteIndex -gt $forceStopIndex -or $forceStopIndex -gt $displayStartIndex) {
    throw 'A rebuilt display must be published, then force-stop and relaunch Pikmin on that display.'
}

Write-Host 'Deployment hardening regression tests passed.'
