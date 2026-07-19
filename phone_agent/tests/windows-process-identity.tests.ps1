$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path -Parent $PSScriptRoot) 'windows-process-identity.ps1')

$serial = 'PHONE_A'
$otherSerial = 'PHONE_B'
$marker = 'PikminHeadless-PHONE_A'
$current = 'scrcpy.exe --serial PHONE_A --stay-awake --no-audio ' +
    '--window-title=PikminHeadless-PHONE_A --new-display=720x1600/320'
$legacyVirtual = 'scrcpy.exe --serial PHONE_A --stay-awake --no-audio ' +
    '--new-display=720x1600/320 --start-app=com.nianticlabs.pikmin --keep-active ' +
    '--max-fps=1 --video-bit-rate=100K --window-x=-2000 --window-y=-2000 ' +
    '--window-width=64 --window-height=64 --window-title=PikminHeadlessDisplay'
$legacyScreenOff = 'scrcpy.exe --serial PHONE_A --stay-awake --no-audio ' +
    '--turn-screen-off --no-window --max-size=640 --max-fps=2'

$cases = @(
    @{ Name = 'current marker'; Line = $current; Marker = $marker; Mode = '' },
    @{ Name = 'legacy virtual'; Line = $legacyVirtual; Marker = ''; Mode = 'virtual' },
    @{ Name = 'legacy screen-off'; Line = $legacyScreenOff; Marker = ''; Mode = 'screen-off' }
)

foreach ($case in $cases) {
    if (-not (Test-PikminHeadlessCommandLine -CommandLine $case.Line -Serial $serial `
            -Marker $case.Marker -LegacyMode $case.Mode)) {
        throw "Expected identity match: $($case.Name)"
    }
    if (Test-PikminHeadlessCommandLine -CommandLine $case.Line -Serial $otherSerial `
            -Marker $case.Marker -LegacyMode $case.Mode) {
        throw "Accepted another phone serial: $($case.Name)"
    }
}

$incompleteScreenOff = 'scrcpy.exe --serial PHONE_A --stay-awake --no-audio ' +
    '--turn-screen-off --no-window --max-size=640'
if (Test-PikminHeadlessCommandLine -CommandLine $incompleteScreenOff -Serial $serial `
        -LegacyMode 'screen-off') {
    throw 'Accepted incomplete legacy screen-off identity.'
}

Write-Host 'Windows process identity regression tests passed.'
