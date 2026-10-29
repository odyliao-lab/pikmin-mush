param(
    [Parameter(Mandatory=$true)][string]$NdkRoot,
    [ValidateSet('arm64-v8a','x86_64')][string]$Abi = 'arm64-v8a',
    [string]$OutputPath = ''
)
$ErrorActionPreference = 'Stop'
$target = if ($Abi -eq 'x86_64') { 'x86_64-linux-android26-clang.cmd' } else { 'aarch64-linux-android26-clang.cmd' }
$compiler = Join-Path $NdkRoot "toolchains/llvm/prebuilt/windows-x86_64/bin/$target"
if (-not $OutputPath) { $OutputPath = Join-Path $PSScriptRoot 'bin/popup-probe' }
New-Item -ItemType Directory -Force (Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))) | Out-Null
& $compiler -O2 -Wall -Wextra -Werror (Join-Path $PSScriptRoot 'popup-probe.c') -o $OutputPath
if ($LASTEXITCODE -ne 0) { throw 'popup-probe build failed' }
