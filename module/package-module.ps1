[CmdletBinding()]
param(
    [string]$BuildRoot = '',
    [string]$OutputPath = '',
    [string]$GameVersion = '149.0',
    [int]$GameVersionCode = 1784082813
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $BuildRoot) {
    $BuildRoot = Join-Path $scriptDirectory '..\build_zygisk\dual-abi'
}
if (-not $OutputPath) {
    $OutputPath = Join-Path $scriptDirectory 'pikmin_hunter.zip'
}

$templatePath = Join-Path $scriptDirectory 'template\magisk_module'
$packageRoot = Join-Path $BuildRoot 'package'
$zygiskRoot = Join-Path $BuildRoot 'zygisk'
$arm64Source = Join-Path $zygiskRoot 'arm64-v8a.so'
$x64Source = Join-Path $zygiskRoot 'x86_64.so'

foreach ($requiredPath in @(
        $templatePath,
        $arm64Source,
        $x64Source
    )) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required package input not found: $requiredPath"
    }
}

if (Test-Path -LiteralPath $packageRoot) {
    $resolvedBuildRoot = (Resolve-Path -LiteralPath $BuildRoot).Path
    $resolvedPackageRoot = (Resolve-Path -LiteralPath $packageRoot).Path
    if (-not $resolvedPackageRoot.StartsWith(
            $resolvedBuildRoot + [IO.Path]::DirectorySeparatorChar,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw "Package staging path escaped the build root: $resolvedPackageRoot"
    }
    Remove-Item -LiteralPath $resolvedPackageRoot -Recurse -Force
}

New-Item -ItemType Directory -Path $packageRoot | Out-Null
Copy-Item -Path (Join-Path $templatePath '*') -Destination $packageRoot -Recurse -Force
New-Item -ItemType Directory -Path (Join-Path $packageRoot 'zygisk') -Force | Out-Null
Copy-Item -LiteralPath $arm64Source `
    -Destination (Join-Path $packageRoot 'zygisk\arm64-v8a.so') -Force
Copy-Item -LiteralPath $x64Source `
    -Destination (Join-Path $packageRoot 'zygisk\x86_64.so') -Force

$moduleProp = @(
    'id=zygisk_pikmin_hunter'
    'name=Pikmin Hunter'
    "version=v$GameVersion-r1"
    "versionCode=$GameVersionCode"
    'author=odyliao-lab'
    "description=Pikmin Bloom $GameVersion fail-closed mushroom capture and GPS override"
) -join "`n"
[IO.File]::WriteAllText(
    (Join-Path $packageRoot 'module.prop'),
    $moduleProp + "`n",
    [Text.UTF8Encoding]::new($false)
)

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
& tar.exe -a -cf $resolvedOutput -C $packageRoot META-INF module.prop zygisk
if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Magisk module archive: $resolvedOutput"
}
$archiveEntries = @(& tar.exe -tf $resolvedOutput)
if ($LASTEXITCODE -ne 0 -or
    $archiveEntries -match '^(\\|\.\\|\./)' -or
    $archiveEntries -match '\\' -or
    $archiveEntries -notcontains 'META-INF/com/google/android/update-binary' -or
    $archiveEntries -notcontains 'zygisk/arm64-v8a.so') {
    throw "Magisk module archive has a non-portable layout: $resolvedOutput"
}
Copy-Item -LiteralPath $arm64Source `
    -Destination (Join-Path $scriptDirectory 'arm64-v8a.so') -Force

Get-FileHash -LiteralPath $resolvedOutput, (Join-Path $scriptDirectory 'arm64-v8a.so') `
    -Algorithm SHA256
