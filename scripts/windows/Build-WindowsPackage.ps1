<#
.SYNOPSIS
    Build an x64 MSIX and portable ZIP from the native Windows application.
.DESCRIPTION
    Uses .NET 10, Windows SDK MakeAppx and public .env settings. Produces a
    self-contained app bundling the .NET 10 Desktop runtime. WebView2 is required
    separately; an installed .NET Desktop runtime is not required.
    File names use the version in src/native/windows/Directory.Build.props.
    Release files go directly in build/; build/windows/package is the work
    directory and is replaced on every run.
    Optional signing uses an existing certificate; no certificate installation,
    trust changes, tests or store upload are performed.
.PARAMETER Release
    Require final public package and Google/contact configuration.
.PARAMETER SkipRestore
    Use dependencies and win-x64 self-contained runtime packs already restored
    to build/nuget-packages by a previous package build.
.PARAMETER CertificateThumbprint
    SHA-1 thumbprint of an existing CurrentUser/My code-signing certificate.
.PARAMETER LocalTestSign
    Sign a preview using an existing certificate already trusted by this machine.
    If no thumbprint is supplied, require one matching trusted signing certificate.
    Exports its public CER, never creates certificates or changes trust.
.PARAMETER TimestampUrl
    HTTPS RFC3161 timestamp service; required for signing outside LocalTestSign.
.PARAMETER SdkBin
    Directory containing MakeAppx.exe and SignTool.exe, or auto-detect Windows SDK.
.PARAMETER UpdateSummary
    Plain-text release summary (at most 500 characters) written into build/work-fleet-update.json, the
    in-app update manifest (ADR-044) that a GitHub release carries beside the MSIX.
.EXAMPLE
    .\scripts\windows\Build-WindowsPackage.ps1 -SkipRestore
.EXAMPLE
    .\scripts\windows\Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign
#>
[CmdletBinding()]
param([switch]$Release, [switch]$SkipRestore, [string]$CertificateThumbprint, [switch]$LocalTestSign, [string]$TimestampUrl, [string]$SdkBin, [string]$UpdateSummary = '')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
function Write-Checksum([string]$Path) {
    $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$Path.sha256", "$Hash  $(Split-Path -Leaf $Path)`n")
}
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
if ($UpdateSummary.Length -gt 500) { throw 'UpdateSummary must be at most 500 characters.' }
if ($LocalTestSign -and $Release) { throw 'LocalTestSign is for preview packages; it cannot be combined with Release.' }
if ($LocalTestSign -and $TimestampUrl) { throw 'LocalTestSign does not use a timestamp service. Use CertificateThumbprint and TimestampUrl for distribution signing.' }
if ($CertificateThumbprint -and $CertificateThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Invalid certificate thumbprint.' }
if ([Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne [Runtime.InteropServices.Architecture]::X64) { throw 'This package entry builds Windows x64; run on an x64 Windows build machine.' }
$MakeAppx = Find-SdkTool 'MakeAppx.exe'
$SignTool = $null
if ($CertificateThumbprint -or $LocalTestSign) {
    if (-not $LocalTestSign) {
        $TimestampUri = [uri]$TimestampUrl
        if (-not $TimestampUri -or -not $TimestampUri.IsAbsoluteUri -or $TimestampUri.Scheme -ne 'https' -or $TimestampUri.UserInfo) { throw 'Signing requires an HTTPS -TimestampUrl without credentials.' }
    }
    $SignTool = Find-SdkTool 'SignTool.exe'
}
Push-Location $ProjectRoot
$PreviousDotnetHome = $env:DOTNET_CLI_HOME; $PreviousNuget = $env:NUGET_PACKAGES; $PreviousTelemetry = $env:DOTNET_CLI_TELEMETRY_OPTOUT
try {
    if ($Release) { & node scripts/check-config.mjs --platform windows; if ($LASTEXITCODE -ne 0) { throw 'Release settings are incomplete.' } }
    $PackageVersion = & node scripts/platform-version.mjs --platform windows
    if ($LASTEXITCODE -ne 0) { throw 'Could not read the Windows version from src/native/windows/Directory.Build.props.' }
    & "$PSScriptRoot/Build-WindowsApp.ps1" -Configuration Release -SelfContained -SkipRestore:$SkipRestore
    $env:DOTNET_CLI_HOME = Join-Path $ProjectRoot 'build/dotnet-home'; $env:NUGET_PACKAGES = Join-Path $ProjectRoot 'build/nuget-packages'; $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $Work = Join-Path $ProjectRoot 'build/windows/package'
    if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
    $Stage = Join-Path $Work 'content'
    New-Item -ItemType Directory -Path $Stage -Force | Out-Null
    & dotnet publish src/native/windows/app/WorkFleet.Windows.csproj --configuration Release --no-restore --runtime win-x64 --self-contained true --output $Stage -p:PlatformTarget=x64
    if ($LASTEXITCODE -ne 0) { throw 'Windows publish failed.' }
    # The WebView debugging port is Debug-only; its argument is a UTF-16 IL string at either byte alignment.
    $AppAssembly = [IO.File]::ReadAllBytes((Join-Path $Stage 'WorkFleet.dll'))
    if ([Text.Encoding]::Unicode.GetString($AppAssembly).Contains('remote-debugging') -or
        [Text.Encoding]::Unicode.GetString($AppAssembly, 1, $AppAssembly.Length - 1).Contains('remote-debugging')) {
        throw 'Release WorkFleet.dll contains the Debug-only WebView debugging path.'
    }
    $RuntimeLicenseDirectory = Join-Path $Stage 'Licenses/dotnet'
    New-Item -ItemType Directory -Path $RuntimeLicenseDirectory -Force | Out-Null
    $RuntimeOptions = (Get-Content -LiteralPath (Join-Path $Stage 'WorkFleet.runtimeconfig.json') -Raw | ConvertFrom-Json).runtimeOptions
    foreach ($RuntimePackage in @(
        @{ Framework = 'Microsoft.NETCore.App'; Package = 'microsoft.netcore.app.runtime.win-x64'; Notice = 'core-runtime.nuspec' },
        @{ Framework = 'Microsoft.WindowsDesktop.App'; Package = 'microsoft.windowsdesktop.app.runtime.win-x64'; Notice = 'desktop-runtime.nuspec' }
    )) {
        $IncludedRuntime = @($RuntimeOptions.includedFrameworks | Where-Object name -CEQ $RuntimePackage.Framework)
        if ($IncludedRuntime.Count -ne 1) { throw "Missing bundled runtime metadata: $($RuntimePackage.Framework)" }
        $RuntimePackageDirectory = Join-Path $env:NUGET_PACKAGES "$($RuntimePackage.Package)/$($IncludedRuntime[0].version)"
        Copy-Item -LiteralPath (Join-Path $RuntimePackageDirectory "$($RuntimePackage.Package).nuspec") -Destination (Join-Path $RuntimeLicenseDirectory $RuntimePackage.Notice)
        if ($RuntimePackage.Framework -eq 'Microsoft.NETCore.App') {
            foreach ($Notice in @('LICENSE.TXT', 'THIRD-PARTY-NOTICES.TXT')) {
                Copy-Item -LiteralPath (Join-Path $RuntimePackageDirectory $Notice) -Destination $RuntimeLicenseDirectory
            }
        }
    }
    Copy-Item -LiteralPath (Join-Path $ProjectRoot 'LICENSE'), (Join-Path $ProjectRoot 'THIRD-PARTY-NOTICES.md') -Destination $Stage
    & node scripts/generate-windows-manifest.mjs --stage $Stage
    if ($LASTEXITCODE -ne 0) { throw 'Package manifest generation failed.' }
    $LocalCertificate = $null
    if ($LocalTestSign) {
        [xml]$Manifest = Get-Content -LiteralPath (Join-Path $Stage 'AppxManifest.xml') -Raw
        $Publisher = $Manifest.Package.Identity.Publisher
        $SigningCertificates = @(Get-ChildItem -LiteralPath Cert:\CurrentUser\My -CodeSigningCert | Where-Object {
            $_.HasPrivateKey -and $_.Subject -ceq $Publisher -and $_.NotBefore -le (Get-Date) -and $_.NotAfter -gt (Get-Date) -and
            (Test-Path -LiteralPath (Join-Path 'Cert:\LocalMachine\TrustedPeople' $_.Thumbprint)) -and
            (-not $CertificateThumbprint -or $_.Thumbprint -eq $CertificateThumbprint)
        })
        if ($SigningCertificates.Count -ne 1) {
            throw "LocalTestSign requires one valid CurrentUser/My signing certificate matching '$Publisher', already in LocalMachine/TrustedPeople. Found $($SigningCertificates.Count); use CertificateThumbprint to select an existing certificate. No trust settings were changed."
        }
        $LocalCertificate = $SigningCertificates[0]
        $CertificateThumbprint = $LocalCertificate.Thumbprint
    }
    $Msix = Join-Path $Work "WorkFleet-$PackageVersion-x64.msix"
    $PackagingLog = Join-Path $Work 'makeappx.log'
    & $MakeAppx pack /d $Stage /p $Msix /h SHA256 > $PackagingLog
    if ($LASTEXITCODE -ne 0) {
        Get-Content -LiteralPath $PackagingLog -Tail 20
        throw "MSIX packaging failed. Details: $PackagingLog"
    }
    if ($CertificateThumbprint) {
        $SigningArguments = @('sign', '/sha1', $CertificateThumbprint, '/s', 'My', '/fd', 'SHA256')
        if (-not $LocalTestSign) { $SigningArguments += @('/tr', $TimestampUrl, '/td', 'SHA256') }
        & $SignTool @SigningArguments $Msix
        if ($LASTEXITCODE -ne 0) { throw 'Package signing failed; check certificate subject against the configured Publisher.' }
        if ($LocalTestSign) {
            & $SignTool verify /pa /v $Msix
            if ($LASTEXITCODE -ne 0) { throw 'Local test signature is not valid or trusted on this machine.' }
            $PublicCertificate = Join-Path $Work 'WorkFleet-preview.cer'
            Export-Certificate -Cert $LocalCertificate -FilePath $PublicCertificate -Type CERT | Out-Null
        }
    }
    $Zip = Join-Path $Work "WorkFleet-$PackageVersion-x64.zip"
    $PublishedFiles = Get-ChildItem -LiteralPath $Stage -Force | Select-Object -ExpandProperty FullName
    Compress-Archive -LiteralPath $PublishedFiles -DestinationPath $Zip
    Write-Checksum $Msix; Write-Checksum $Zip
    # ADR-044: the release's update manifest names this exact MSIX by size and SHA-256 for the in-app updater.
    $UpdateManifest = Join-Path $Work 'work-fleet-update.json'
    $MsixFile = Get-Item -LiteralPath $Msix
    $Update = [ordered]@{ schemaVersion = 1; platform = 'windows'; version = $PackageVersion; tag = "windows-v$PackageVersion"; summary = $UpdateSummary
        assets = @([ordered]@{ arch = 'x64'; name = $MsixFile.Name; size = $MsixFile.Length; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $Msix).Hash.ToLowerInvariant() }) }
    [IO.File]::WriteAllText($UpdateManifest, ($Update | ConvertTo-Json -Depth 4) + "`n", [Text.UTF8Encoding]::new($false))
    # Only a completely built and signed set replaces the release files in build/.
    $Delivery = Join-Path $ProjectRoot 'build'
    $Delivered = @($Msix, "$Msix.sha256", $Zip, "$Zip.sha256", $UpdateManifest)
    if ($LocalTestSign) { $Delivered += $PublicCertificate }
    Move-Item -LiteralPath $Delivered -Destination $Delivery -Force
    $Msix = Join-Path $Delivery (Split-Path -Leaf $Msix); $Zip = Join-Path $Delivery (Split-Path -Leaf $Zip)
    if ($LocalTestSign) { $PublicCertificate = Join-Path $Delivery 'WorkFleet-preview.cer' }
    Write-Output "MSIX: $Msix"
    Write-Output "Portable ZIP: $Zip"
    Write-Output "Update manifest: $(Join-Path $Delivery 'work-fleet-update.json')"
    if ($LocalTestSign) { Write-Output "Locally trusted signed MSIX; public certificate: $PublicCertificate" }
    Write-Output 'Includes the .NET 10 Desktop runtime; WebView2 is required separately.'
    if (-not $CertificateThumbprint) { Write-Output 'MSIX is unsigned. Installation needs a trusted signature.' }
} finally {
    Pop-Location
    $env:DOTNET_CLI_HOME = $PreviousDotnetHome; $env:NUGET_PACKAGES = $PreviousNuget; $env:DOTNET_CLI_TELEMETRY_OPTOUT = $PreviousTelemetry
}
