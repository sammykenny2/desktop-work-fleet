<#
.SYNOPSIS
    Check local signing option guards and a signed Windows preview package.
.DESCRIPTION
    Reads an existing MSIX, its companion public CER and Windows trust stores.
    Unsigned preview inspection must be explicitly requested; it validates package
    contents without claiming installation readiness or trusted signing.
    Does not build, install, create certificates or change trust settings.
    Requires bundled .NET 10/WPF files and self-contained win-x64 runtime metadata.
.PARAMETER PackagePath
    Path to an MSIX produced by Build-WindowsPackage.ps1 -LocalTestSign.
.PARAMETER Unsigned
    Inspect an unsigned preview MSIX built without a signing certificate.
.EXAMPLE
    .\scripts\windows\Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix
.EXAMPLE
    .\scripts\windows\Test-WindowsPackage.ps1 -PackagePath build/WorkFleet-VERSION-x64.msix -Unsigned
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$PackagePath, [switch]$Unsigned)
$ErrorActionPreference = 'Stop'
$BuildScript = Join-Path $PSScriptRoot 'Build-WindowsPackage.ps1'
$InvalidOptions = @(
    @{ Inputs = @{LocalTestSign = $true; Release = $true}; Expected = 'cannot be combined with Release' },
    @{ Inputs = @{LocalTestSign = $true; TimestampUrl = 'https://example.com/timestamp'}; Expected = 'does not use a timestamp' },
    @{ Inputs = @{LocalTestSign = $true; CertificateThumbprint = 'invalid'}; Expected = 'Invalid certificate thumbprint' },
    @{ Inputs = @{CertificateThumbprint = ('0' * 40); TimestampUrl = 'http://example.com/timestamp'}; Expected = 'HTTPS -TimestampUrl' }
)
foreach ($Case in $InvalidOptions) {
    $Inputs = $Case.Inputs
    $Rejected = $false
    try { & $BuildScript @Inputs | Out-Null }
    catch { $Rejected = $_.Exception.Message.Contains($Case.Expected) }
    if (-not $Rejected) { throw "Signing option guard did not reject: $($Case.Expected)" }
}
Write-Output 'PASS four invalid signing option combinations rejected before building'
$Package = (Resolve-Path -LiteralPath $PackagePath).ProviderPath
$Signature = Get-AuthenticodeSignature -LiteralPath $Package
if ($Unsigned) {
    if ($Signature.Status -ne 'NotSigned') { throw "Expected an unsigned preview MSIX: $($Signature.Status)" }
} else {
    if ($Signature.Status -ne 'Valid' -or -not $Signature.SignerCertificate) { throw "MSIX signature is not trusted and valid: $($Signature.Status)" }
    $Certificate = $Signature.SignerCertificate
    if (-not (Test-Path -LiteralPath (Join-Path 'Cert:\LocalMachine\TrustedPeople' $Certificate.Thumbprint))) { throw 'Local test certificate is not trusted in LocalMachine/TrustedPeople.' }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [System.IO.Compression.ZipFile]::OpenRead($Package)
try {
    if ($Unsigned) {
        if ($Archive.GetEntry('AppxSignature.p7x')) { throw 'Unsigned preview contains a signature entry.' }
    } elseif (-not $Archive.GetEntry('AppxSignature.p7x')) { throw 'MSIX signature entry is missing.' }
    $Reader = [System.IO.StreamReader]::new($Archive.GetEntry('AppxManifest.xml').Open())
    try { [xml]$Manifest = $Reader.ReadToEnd() } finally { $Reader.Dispose() }
    if (-not $Unsigned -and $Manifest.Package.Identity.Publisher -cne $Certificate.Subject) { throw 'Package publisher and signing certificate subject differ.' }
    if ($Manifest.Package.Identity.ProcessorArchitecture -ne 'x64') { throw 'Expected Windows x64 package.' }
    $Family = @($Manifest.Package.Dependencies.TargetDeviceFamily)
    if ($Family.Count -ne 1 -or $Family[0].Name -cne 'Windows.Desktop' -or
        $Family[0].MinVersion -cne '10.0.22000.0' -or $Family[0].MaxVersionTested -cne '10.0.26200.0') {
        throw 'Expected Windows.Desktop MinVersion=10.0.22000.0 and MaxVersionTested=10.0.26200.0.'
    }
    $ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    [xml]$WindowsBuild = Get-Content -LiteralPath (Join-Path $ProjectRoot 'src/native/windows/Directory.Build.props') -Raw
    $ExpectedRuntimeVersion = $WindowsBuild.Project.PropertyGroup.WindowsRuntimeVersion
    if ($ExpectedRuntimeVersion -cnotmatch '^10\.0\.\d+$') { throw 'Expected a pinned .NET 10 runtime version.' }
    $ExpectedVersion = & node (Join-Path $ProjectRoot 'scripts/platform-version.mjs') --platform windows
    if ($LASTEXITCODE -ne 0 -or $Manifest.Package.Identity.Version -cne "$ExpectedVersion.0") { throw 'Package version differs from the Windows version record.' }
    # ADR-044: when the package has its update manifest beside it, the manifest must name exactly this file.
    $UpdateManifest = Join-Path (Split-Path -Parent $Package) 'work-fleet-update.json'
    if (Test-Path -LiteralPath $UpdateManifest) {
        $Update = Get-Content -LiteralPath $UpdateManifest -Raw | ConvertFrom-Json
        $Asset = @($Update.assets)
        if ($Update.schemaVersion -ne 1 -or $Update.platform -cne 'windows' -or $Update.version -cne $ExpectedVersion -or $Update.tag -cne "windows-v$ExpectedVersion" -or
            $Asset.Count -ne 1 -or $Asset[0].arch -cne 'x64' -or $Asset[0].name -cne (Split-Path -Leaf $Package) -or $Asset[0].size -ne (Get-Item -LiteralPath $Package).Length -or
            $Asset[0].sha256 -cne (Get-FileHash -Algorithm SHA256 -LiteralPath $Package).Hash.ToLowerInvariant()) {
            throw 'work-fleet-update.json does not describe this package.'
        }
        Write-Output 'PASS update manifest matches the package version, size and SHA-256'
    }
    # ADR-043: one sign-in StartupTask, disabled in the manifest and enabled by the app from its own preference.
    $Startup = @($Manifest.GetElementsByTagName('StartupTask', 'http://schemas.microsoft.com/appx/manifest/uap/windows10/5'))
    if ($Startup.Count -ne 1 -or $Startup[0].TaskId -cne 'WorkFleetStartup' -or $Startup[0].Enabled -cne 'false' -or
        $Startup[0].ParentNode.Category -cne 'windows.startupTask' -or $Startup[0].ParentNode.Executable -cne 'WorkFleet.exe') {
        throw 'Expected one disabled WorkFleetStartup sign-in task for WorkFleet.exe.'
    }
    foreach ($Entry in $Archive.Entries) {
        if ($Entry.Name -like '.env*' -or [IO.Path]::GetExtension($Entry.Name) -in @('.pfx', '.p12', '.pem', '.key', '.jks')) { throw 'Environment or private-key file in package.' }
    }
    foreach ($RequiredFile in @('WorkFleet.runtimeconfig.json', 'WorkFleet.deps.json', 'hostfxr.dll', 'hostpolicy.dll',
        'coreclr.dll', 'System.Private.CoreLib.dll', 'PresentationFramework.dll', 'PresentationCore.dll',
        'WindowsBase.dll', 'wpfgfx_cor3.dll', 'PresentationNative_cor3.dll')) {
        $BundledFile = $Archive.GetEntry($RequiredFile)
        if (-not $BundledFile -or $BundledFile.Length -eq 0) { throw "Missing bundled .NET/WPF file: $RequiredFile" }
    }
    $Reader = [System.IO.StreamReader]::new($Archive.GetEntry('WorkFleet.runtimeconfig.json').Open())
    try { $RuntimeOptions = ($Reader.ReadToEnd() | ConvertFrom-Json).runtimeOptions } finally { $Reader.Dispose() }
    if ($RuntimeOptions.tfm -cne 'net10.0' -or $RuntimeOptions.framework -or $RuntimeOptions.frameworks) {
        throw 'Expected self-contained .NET 10 runtime metadata without shared framework requirements.'
    }
    $IncludedFrameworks = @($RuntimeOptions.includedFrameworks)
    if ($IncludedFrameworks.Count -ne 2) { throw 'Expected bundled .NET 10 Core and Windows Desktop frameworks.' }
    foreach ($FrameworkName in @('Microsoft.NETCore.App', 'Microsoft.WindowsDesktop.App')) {
        $Included = @($IncludedFrameworks | Where-Object name -CEQ $FrameworkName)
        if ($Included.Count -ne 1 -or $Included[0].version -cne $ExpectedRuntimeVersion) {
            throw 'Expected bundled .NET 10 Core and Windows Desktop frameworks.'
        }
    }
    $Reader = [System.IO.StreamReader]::new($Archive.GetEntry('WorkFleet.deps.json').Open())
    try { $RuntimeTarget = ($Reader.ReadToEnd() | ConvertFrom-Json).runtimeTarget.name } finally { $Reader.Dispose() }
    if ($RuntimeTarget -cne '.NETCoreApp,Version=v10.0/win-x64') { throw 'Expected self-contained win-x64 dependency target.' }
    foreach ($RuntimeNotice in @('Licenses/dotnet/LICENSE.TXT', 'Licenses/dotnet/THIRD-PARTY-NOTICES.TXT',
        'Licenses/dotnet/core-runtime.nuspec', 'Licenses/dotnet/desktop-runtime.nuspec',
        'Licenses/dotnet-desktop-LICENSE.txt', 'Licenses/dotnet-wpf-NOTICES.txt', 'Licenses/dotnet-winforms-NOTICES.txt')) {
        $BundledNotice = $Archive.GetEntry($RuntimeNotice)
        if (-not $BundledNotice -or $BundledNotice.Length -eq 0) { throw "Missing bundled runtime notice: $RuntimeNotice" }
    }
} finally { $Archive.Dispose() }
Write-Output 'PASS final MSIX x64 identity/version and Windows.Desktop installation floor 22000, MaxVersionTested 26200'
Write-Output 'PASS bundled .NET 10/WPF runtime files and self-contained win-x64 runtime metadata'
Write-Output 'PASS bundled runtime licenses, incorporated notices and package provenance'
if ($Unsigned) {
    Write-Output 'PASS unsigned preview contents only; installation and trusted signing remain unverified'
} else {
    $PublicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path (Split-Path -Parent $Package) 'WorkFleet-preview.cer'))
    try {
        if ($PublicCertificate.Thumbprint -ne $Certificate.Thumbprint -or $PublicCertificate.HasPrivateKey) { throw 'Companion CER must match the signer and contain no private key.' }
    } finally { $PublicCertificate.Dispose() }
    Write-Output 'PASS actual MSIX signature, machine trust, publisher and public-only CER'
}
