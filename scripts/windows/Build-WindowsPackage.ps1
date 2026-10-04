<#
.SYNOPSIS
    Build an x64 MSIX and portable ZIP from the native Windows application.
.DESCRIPTION
    Uses .NET 8, Windows SDK MakeAppx and public .env settings. Produces a
    framework-dependent app requiring .NET 8 Desktop and WebView2 runtimes.
    Optional signing uses an existing certificate; no certificate installation,
    trust changes, tests or store upload are performed.
.PARAMETER Release
    Require final public package and Google/contact configuration.
.PARAMETER SkipRestore
    Use dependencies already restored to build/nuget-packages.
.PARAMETER CertificateThumbprint
    SHA-1 thumbprint of an existing CurrentUser/My code-signing certificate.
.PARAMETER TimestampUrl
    HTTPS RFC3161 timestamp service; required when signing.
.PARAMETER SdkBin
    Directory containing MakeAppx.exe and SignTool.exe, or auto-detect Windows SDK.
.EXAMPLE
    .\scripts\windows\Build-WindowsPackage.ps1 -SkipRestore
#>
[CmdletBinding()]
param([switch]$Release, [switch]$SkipRestore, [string]$CertificateThumbprint, [string]$TimestampUrl, [string]$SdkBin)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Find-SdkTool([string]$Name) {
    if ($SdkBin) {
        $Tool = Join-Path $SdkBin $Name
        if (Test-Path -LiteralPath $Tool -PathType Leaf) { return $Tool }
        throw "Missing SDK tool: $Tool"
    }
    $OnPath = Get-Command $Name -ErrorAction SilentlyContinue
    if ($OnPath) { return $OnPath.Source }
    $Root = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    if (Test-Path -LiteralPath $Root) {
        $Versions = Get-ChildItem -LiteralPath $Root -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending
        foreach ($Version in $Versions) {
            foreach ($Cpu in @('x64', 'x86')) {
                $Tool = Join-Path $Version.FullName "$Cpu/$Name"
                if (Test-Path -LiteralPath $Tool -PathType Leaf) { return $Tool }
            }
        }
    }
    throw "Windows SDK $Name is required. Set -SdkBin to its directory."
}
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) { throw 'This package entry builds Windows x64; run on an x64 Windows build machine.' }
$MakeAppx = Find-SdkTool 'MakeAppx.exe'
$SignTool = $null
if ($CertificateThumbprint) {
    if ($CertificateThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid certificate thumbprint.' }
    $TimestampUri = [uri]$TimestampUrl
    if (-not $TimestampUri.IsAbsoluteUri -or $TimestampUri.Scheme -ne 'https' -or $TimestampUri.UserInfo) { throw 'Signing requires an HTTPS -TimestampUrl without credentials.' }
    $SignTool = Find-SdkTool 'SignTool.exe'
}
Push-Location $ProjectRoot
$PreviousDotnetHome = $env:DOTNET_CLI_HOME; $PreviousNuget = $env:NUGET_PACKAGES; $PreviousTelemetry = $env:DOTNET_CLI_TELEMETRY_OPTOUT
try {
    if ($Release) { & node scripts/check-config.mjs --platform windows; if ($LASTEXITCODE -ne 0) { throw 'Release settings are incomplete.' } }
    & "$PSScriptRoot/Build-WindowsApp.ps1" -Configuration Release -SkipRestore:$SkipRestore
    $env:DOTNET_CLI_HOME = Join-Path $ProjectRoot 'build/dotnet-home'; $env:NUGET_PACKAGES = Join-Path $ProjectRoot 'build/nuget-packages'; $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $Output = Join-Path $ProjectRoot ('build/windows/package-' + [guid]::NewGuid().ToString('N'))
    $Stage = Join-Path $Output 'content'
    New-Item -ItemType Directory -Path $Stage -Force | Out-Null
    & dotnet publish src/native/windows/WorkFleet.Windows.csproj --configuration Release --no-restore --self-contained false --output $Stage -p:PlatformTarget=x64
    if ($LASTEXITCODE -ne 0) { throw 'Windows publish failed.' }
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE'), (Join-Path $ProjectRoot 'THIRD-PARTY-NOTICES.md') -Destination $Stage
    & node scripts/generate-windows-manifest.mjs --stage $Stage
    if ($LASTEXITCODE -ne 0) { throw 'Package manifest generation failed.' }
    $Msix = Join-Path $Output 'WorkFleet-1.0.0-x64.msix'
    $PackagingLog = Join-Path $Output 'makeappx.log'
    & $MakeAppx pack /d $Stage /p $Msix /h SHA256 > $PackagingLog
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath $PackagingLog -Tail 20
        throw "MSIX packaging failed. Details: $PackagingLog"
    }
    if ($CertificateThumbprint) {
        & $SignTool sign /sha1 $CertificateThumbprint /s My /fd SHA256 /tr $TimestampUrl /td SHA256 $Msix
        if ($LASTEXITCODE -ne 0) { throw 'Package signing failed; check certificate subject against the configured Publisher.' }
    }
    $Zip = Join-Path $Output 'WorkFleet-1.0.0-x64.zip'
    $PublishedFiles = Get-ChildItem -LiteralPath $Stage -Force | Select-Object -ExpandProperty FullName
    Compress-Archive -LiteralPath $PublishedFiles -DestinationPath $Zip
    Write-Output "MSIX: $Msix"
    Write-Output "Portable ZIP: $Zip"
    if (-not $CertificateThumbprint) { Write-Output 'MSIX is unsigned. Installation needs a trusted signature. .NET 8 Desktop and WebView2 are required.' }
} finally {
    Pop-Location
    $env:DOTNET_CLI_HOME = $PreviousDotnetHome; $env:NUGET_PACKAGES = $PreviousNuget; $env:DOTNET_CLI_TELEMETRY_OPTOUT = $PreviousTelemetry
}
