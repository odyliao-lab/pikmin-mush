[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path $PSScriptRoot 'pikmin_scanner_agent.zip')
)

$ErrorActionPreference = 'Stop'
$stage = Join-Path $env:TEMP ('pikmin-scanner-agent-' + [guid]::NewGuid().ToString('N'))
$meta = Join-Path $PSScriptRoot '..\module\template\magisk_module\META-INF'
$files = @('action.sh', 'agent.sh', 'control.sh', 'customize.sh', 'local-display.sh',
    'module.prop', 'service.sh', 'uninstall.sh')

try {
    New-Item -ItemType Directory -Path $stage | Out-Null
    Copy-Item -LiteralPath $meta -Destination (Join-Path $stage 'META-INF') -Recurse -Force
    foreach ($file in $files) {
        $source = Join-Path $PSScriptRoot $file
        if (-not (Test-Path -LiteralPath $source)) { throw "Missing module input: $source" }
        Copy-Item -LiteralPath $source -Destination (Join-Path $stage $file) -Force
    }
    $output = [IO.Path]::GetFullPath($OutputPath)
    Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
    & tar.exe -a -cf $output -C $stage META-INF action.sh agent.sh control.sh customize.sh local-display.sh module.prop service.sh uninstall.sh
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create Magisk module archive.' }
    $entries = @(& tar.exe -tf $output)
    if ($LASTEXITCODE -ne 0 -or $entries -match '^(\\|\.\\|\./)' -or $entries -match '\\' -or
        $entries -notcontains 'META-INF/com/google/android/update-binary' -or $entries -notcontains 'agent.sh') {
        throw "Non-portable Magisk archive: $output"
    }
    Get-FileHash -LiteralPath $output -Algorithm SHA256
}
finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}
