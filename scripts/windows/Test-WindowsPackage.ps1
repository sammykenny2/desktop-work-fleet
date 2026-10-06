<#
.SYNOPSIS
    Check local signing option guards and a signed Windows preview package.
.DESCRIPTION
    Reads an existing MSIX, its companion public CER and Windows trust stores.
    Does not build, install, create certificates or change trust settings.
.PARAMETER PackagePath
    Path to an MSIX produced by Build-WindowsPackage.ps1 -LocalTestSign.
.EXAMPLE
    .\scripts\windows\Test-WindowsPackage.ps1 -PackagePath build/windows/package-ID/WorkFleet-VERSION-x64.msix
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string]$PackagePath)
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
if ($Signature.Status -ne 'Valid' -or -not $Signature.SignerCertificate) { throw "MSIX signature is not trusted and valid: $($Signature.Status)" }
$Certificate = $Signature.SignerCertificate
if (-not (Test-Path -LiteralPath (Join-Path 'Cert:\LocalMachine\TrustedPeople' $Certificate.Thumbprint))) { throw 'Local test certificate is not trusted in LocalMachine/TrustedPeople.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$Archive = [System.IO.Compression.ZipFile]::OpenRead($Package)
try {
    if (-not $Archive.GetEntry('AppxSignature.p7x')) { throw 'MSIX signature entry is missing.' }
    $Reader = [System.IO.StreamReader]::new($Archive.GetEntry('AppxManifest.xml').Open())
    try { [xml]$Manifest = $Reader.ReadToEnd() } finally { $Reader.Dispose() }
    if ($Manifest.Package.Identity.Publisher -cne $Certificate.Subject) { throw 'Package publisher and signing certificate subject differ.' }
    if ($Manifest.Package.Identity.ProcessorArchitecture -ne 'x64') { throw 'Expected Windows x64 package.' }
    foreach ($Entry in $Archive.Entries) {
        if ($Entry.Name -like '.env*' -or [IO.Path]::GetExtension($Entry.Name) -in @('.pfx', '.p12', '.pem', '.key', '.jks')) { throw 'Environment or private-key file in package.' }
    }
} finally { $Archive.Dispose() }
$PublicCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new((Join-Path (Split-Path -Parent $Package) 'WorkFleet-preview.cer'))
try {
    if ($PublicCertificate.Thumbprint -ne $Certificate.Thumbprint -or $PublicCertificate.HasPrivateKey) { throw 'Companion CER must match the signer and contain no private key.' }
} finally { $PublicCertificate.Dispose() }
Write-Output 'PASS actual MSIX signature, machine trust, publisher, x64 manifest and public-only CER'
