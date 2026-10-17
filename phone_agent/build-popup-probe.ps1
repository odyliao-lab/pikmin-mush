param([Parameter(Mandatory=$true)][string]$NdkRoot)
$ErrorActionPreference = 'Stop'
$compiler = Join-Path $NdkRoot 'toolchains/llvm/prebuilt/windows-x86_64/bin/aarch64-linux-android26-clang.cmd'
New-Item -ItemType Directory -Force (Join-Path $PSScriptRoot 'bin') | Out-Null
& $compiler -O2 -Wall -Wextra -Werror (Join-Path $PSScriptRoot 'popup-probe.c') -o (Join-Path $PSScriptRoot 'bin/popup-probe')
if ($LASTEXITCODE -ne 0) { throw 'popup-probe build failed' }
