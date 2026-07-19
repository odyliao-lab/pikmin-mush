[CmdletBinding()]
param(
    [string]$NdkPath = "$env:LOCALAPPDATA\CodexTools\android-ndk\android-ndk-r27d",
    [string]$CmakePath = "$env:LOCALAPPDATA\CodexTools\android-build-tools\cmake\data\bin\cmake.exe",
    [string]$NinjaPath = "$env:LOCALAPPDATA\CodexTools\android-build-tools\bin\ninja.exe",
    [string]$BuildRoot = ''
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $BuildRoot) { $BuildRoot = Join-Path $scriptDirectory '..\build_zygisk\dual-abi' }
$sourcePath = Join-Path $scriptDirectory 'cpp'
$toolchainPath = Join-Path $NdkPath 'build\cmake\android.toolchain.cmake'

foreach ($requiredPath in @($CmakePath, $NinjaPath, $toolchainPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required build tool not found: $requiredPath"
    }
}

$targets = @(
    @{ Abi = 'arm64-v8a'; OutputName = 'arm64-v8a.so' },
    @{ Abi = 'x86_64'; OutputName = 'x86_64.so' }
)

foreach ($target in $targets) {
    $buildPath = Join-Path $BuildRoot $target.Abi
    & $CmakePath -G Ninja `
        "-DCMAKE_MAKE_PROGRAM=$NinjaPath" `
        "-DCMAKE_TOOLCHAIN_FILE=$toolchainPath" `
        "-DANDROID_ABI=$($target.Abi)" `
        -DANDROID_PLATFORM=android-28 `
        -DMODULE_NAME=pikmin_hunter `
        -DCMAKE_BUILD_TYPE=Release `
        -S $sourcePath -B $buildPath
    if ($LASTEXITCODE -ne 0) { throw "CMake configure failed for $($target.Abi)." }

    & $CmakePath --build $buildPath
    if ($LASTEXITCODE -ne 0) { throw "Build failed for $($target.Abi)." }

    $zygiskOutput = Join-Path $BuildRoot 'zygisk'
    New-Item -ItemType Directory -Path $zygiskOutput -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $buildPath 'libpikmin_hunter.so') `
        -Destination (Join-Path $zygiskOutput $target.OutputName) -Force
}

Get-ChildItem -LiteralPath (Join-Path $BuildRoot 'zygisk') | Select-Object Name, Length
