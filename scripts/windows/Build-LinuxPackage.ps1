<#
.SYNOPSIS
    Build Linux tar.gz and DEB using the existing Linux Docker engine.
.DESCRIPTION
    Bundles Linux sources/assets, then runs dpkg-deb in an Ubuntu build container.
    Mounts only build/linux and the packaging script. No runtime, GUI tests, service
    ports, installation, signing or publication. Existing output is preserved.
.PARAMETER Release
    Require final public config and build version 1.0.0; default is 1.0.0~preview.
.PARAMETER SkipWebBuild
    Use already-built build/app assets.
.PARAMETER DockerImage
    Linux image containing bash, dpkg-deb and coreutils. A digest may be supplied.
.EXAMPLE
    .\scripts\windows\Build-LinuxPackage.ps1 -SkipWebBuild
#>
[CmdletBinding()]
param([switch]$Release, [switch]$SkipWebBuild, [string]$DockerImage = 'ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $ProjectRoot
try {
    if ($Release) { & node scripts/check-config.mjs --platform linux; if ($LASTEXITCODE -ne 0) { throw 'Release settings are incomplete.' } }
    if (-not $SkipWebBuild) { & npm run build; if ($LASTEXITCODE -ne 0) { throw 'Web build failed.' } }
    & node scripts/generate-linux-package.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Linux assets packaging failed.' }
    & python -B scripts/package-linux.py
    if ($LASTEXITCODE -ne 0) { throw 'Linux archive failed.' }
    $LinuxOutput = Join-Path $ProjectRoot 'build/linux'
    $Metadata = Get-Content -LiteralPath (Join-Path $LinuxOutput 'work-fleet-1.0.0/package.json') -Raw | ConvertFrom-Json
    $PublicConfig = Get-Content -LiteralPath (Join-Path $LinuxOutput 'work-fleet-1.0.0/Config/public.json') -Raw | ConvertFrom-Json
    $Script = Join-Path $ProjectRoot 'scripts/linux/package-deb.sh'
    $Arguments = @('run', '--rm', '--network', 'none', '--mount', "type=bind,source=$LinuxOutput,target=/workspace/build/linux", '--mount', "type=bind,source=$Script,target=/workspace/scripts/package-deb.sh,readonly", $DockerImage, 'bash', '/workspace/scripts/package-deb.sh', '--source', '/workspace/build/linux/work-fleet-1.0.0', '--output', '/workspace/build/linux', '--app-id', $Metadata.appId)
    if ($PublicConfig.release.supportEmail) { $Arguments += @('--maintainer-email', $PublicConfig.release.supportEmail) }
    if ($Release) { $Arguments += '--release' }
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Linux DEB build failed; a Linux Docker engine and an available build image are required.' }
    $Version = if ($Release) { '1.0.0' } else { '1.0.0~preview' }
    Write-Output "Linux package: $(Join-Path $LinuxOutput "work-fleet_${Version}_all.deb")"
} finally { Pop-Location }
