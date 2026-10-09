<#
.SYNOPSIS
    Check local signing option guards and a signed Windows preview package.
.DESCRIPTION
    Reads an existing MSIX, its companion public CER and Windows trust stores.
    Unsigned preview inspection must be explicitly requested; it validates package
    contents without claiming installation readiness or trusted signing.
    Does not build, install, create certificates or change trust settings.
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
    $ExpectedVersion = & node (Join-Path $ProjectRoot 'scripts/platform-version.mjs') --platform windows
    if ($LASTEXITCODE -ne 0 -or $Manifest.Package.Identity.Version -cne "$ExpectedVersion.0") { throw 'Package version differs from the Windows version record.' }
    foreach ($Entry in $Archive.Entries) {
        if ($Entry.Name -like '.env*' -or [IO.Path]::GetExtension($Entry.Name) -in @('.pfx', '.p12', '.pem', '.key', '.jks')) { throw 'Environment or private-key file in package.' }
    }
} finally { $Archive.Dispose() }
Write-Output 'PASS final MSIX x64 identity/version and Windows.Desktop installation floor 22000, MaxVersionTested 26200'
if ($Unsigned) {
    Write-Output 'PASS unsigned preview contents only; installation and trusted signing remain unverified'
} else {
    $PublicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path (Split-Path -Parent $Package) 'WorkFleet-preview.cer'))
    try {
        if ($PublicCertificate.Thumbprint -ne $Certificate.Thumbprint -or $PublicCertificate.HasPrivateKey) { throw 'Companion CER must match the signer and contain no private key.' }
    } finally { $PublicCertificate.Dispose() }
    Write-Output 'PASS actual MSIX signature, machine trust, publisher and public-only CER'
}
