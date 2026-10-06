<#
.SYNOPSIS
    Build the local Windows native management/editor app and optional probes.
.DESCRIPTION
    Requires npm dependencies, .NET 8 SDK and Windows. Builds local bundled assets,
    restores locked official NuGet dependencies, and retains third-party licenses.
    No application server, signing, installation or publication is performed.
.PARAMETER Configuration
    Debug or Release; defaults to Release.
.PARAMETER IncludeTests
    Also build the native core and real WPF/WebView2 integration probes.
.PARAMETER SkipRestore
    Use already restored packages without network access.
.EXAMPLE
    .\scripts\windows\Build-WindowsApp.ps1 -Configuration Debug -IncludeTests
#>
[CmdletBinding()]
param(
    [ValidateSet('Debug', 'Release')][string]$Configuration = 'Release',
    [switch]$IncludeTests,
    [switch]$SkipRestore
)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$SavedEnvironment = @{}
foreach ($Name in @('DOTNET_CLI_HOME', 'NUGET_PACKAGES', 'DOTNET_CLI_TELEMETRY_OPTOUT')) {
    $SavedEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
}
Push-Location $ProjectRoot
try {
    $env:DOTNET_CLI_HOME = Join-Path $ProjectRoot 'build/dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $ProjectRoot 'build/nuget-packages'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    # Config/public.json beside the app also carries the Windows Desktop client secret when .env has one.
    & node scripts/build-web.mjs --platform windows
    if ($LASTEXITCODE -ne 0) { throw 'Web asset build failed.' }
    $Projects = @('src/native/windows/app/WorkFleet.Windows.csproj')
    if ($IncludeTests) {
        $Projects += 'tests/native/windows/core/WorkFleet.Windows.Core.Tests.csproj'
        $Projects += 'tests/native/windows/ui/WorkFleet.Windows.Ui.Tests.csproj'
    }
    foreach ($Project in $Projects) {
        if (-not $SkipRestore) {
            & dotnet restore $Project --locked-mode --source https://api.nuget.org/v3/index.json
            if ($LASTEXITCODE -ne 0) { throw "Locked restore failed: $Project" }
        }
        & dotnet build $Project --configuration $Configuration --no-restore
        if ($LASTEXITCODE -ne 0) { throw "Native build failed: $Project" }
    }
    Write-Output "Windows app: src/native/windows/app/bin/$Configuration/net8.0-windows10.0.19041.0/WorkFleet.exe"
} finally {
    Pop-Location
    foreach ($Name in $SavedEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($Name, $SavedEnvironment[$Name], 'Process')
    }
}
