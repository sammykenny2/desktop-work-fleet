<#
.SYNOPSIS
    Verify private MSIX data and uninstall using an isolated storage-probe package.
.DESCRIPTION
    Uses already built Release UI probes and build/windows/package/content,
    the Windows SDK and an existing trusted
    local signing certificate. Installs and removes only a unique test package;
    never starts, uninstalls or writes data for the real Work Fleet package.
    Evidence and exported-file fixtures remain under build. No UAC or new trust.
.PARAMETER CertificateThumbprint
    Thumbprint of an existing CurrentUser/My certificate trusted on this machine.
.EXAMPLE
    .\scripts\windows\Test-WindowsAppData.ps1 -CertificateThumbprint YOUR_THUMBPRINT
#>
[CmdletBinding()]
param([Parameter(Mandatory)][ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$CertificateThumbprint)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProbeRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot ('build/storage-probe-' + [guid]::NewGuid().ToString('N'))))
$BuildRoot = [IO.Path]::GetFullPath((Join-Path $ProjectRoot 'build'))
if (-not $ProbeRoot.StartsWith($BuildRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Probe directory escaped build.' }
$Stage = Join-Path $ProbeRoot 'content'
$PackageName = 'app.workfleet.storageprobe.' + [guid]::NewGuid().ToString('N').Substring(0, 20)
$SdkVersions = Get-ChildItem -LiteralPath (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin') -Directory |
    Where-Object { $_.Name -match '^10\.\d+\.\d+\.\d+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'x64/makeappx.exe')) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'x64/signtool.exe')) } |
    Sort-Object { [version]$_.Name } -Descending
if (-not $SdkVersions) { throw 'Windows SDK MakeAppx and SignTool are required.' }
$Sdk = Join-Path $SdkVersions[0].FullName 'x64'
$ProbeBin = Join-Path $ProjectRoot 'tests/native/windows/ui/bin/Release/net8.0-windows10.0.19041.0'
$Certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$CertificateThumbprint"
if (-not $Certificate.HasPrivateKey -or $Certificate.NotAfter -le (Get-Date) -or
    -not (Test-Path -LiteralPath "Cert:\LocalMachine\TrustedPeople\$CertificateThumbprint")) { throw 'Use an existing valid, trusted local signing certificate.' }
if ($Certificate.Subject -cne 'CN=Work Fleet Preview') { throw 'Probe publisher does not match certificate.' }
New-Item -ItemType Directory -Path $Stage | Out-Null
Get-ChildItem -LiteralPath $ProbeBin -File | Where-Object { $_.Extension -in '.dll', '.json' -or $_.Name -eq 'WorkFleet.Windows.Ui.Tests.exe' } |
    Copy-Item -Destination $Stage
Copy-Item -LiteralPath (Join-Path $ProjectRoot 'build/windows/package/content/PackageAssets') -Destination $Stage -Recurse
[xml]$Manifest = [IO.File]::ReadAllText((Join-Path $ProjectRoot 'build/windows/package/content/AppxManifest.xml'))
$Manifest.Package.Identity.SetAttribute('Name', $PackageName)
$Manifest.Package.Identity.SetAttribute('Version', '1.0.0.0')
$Manifest.Package.Properties.DisplayName = 'Work Fleet storage probe'
$Manifest.Package.Applications.Application.SetAttribute('Id', 'Probe')
$Manifest.Package.Applications.Application.SetAttribute('Executable', 'WorkFleet.Windows.Ui.Tests.exe')
$Manifest.Package.Applications.Application.VisualElements.SetAttribute('DisplayName', 'Work Fleet storage probe')
[IO.File]::WriteAllText((Join-Path $Stage 'AppxManifest.xml'), $Manifest.OuterXml, [Text.UTF8Encoding]::new($false))
$Msix = Join-Path $ProbeRoot 'storage-probe.msix'
$PackOutput = & (Join-Path $Sdk 'makeappx.exe') pack /d $Stage /p $Msix /o
if ($LASTEXITCODE -ne 0) { $PackOutput | Write-Output; throw 'Probe packaging failed.' }
& (Join-Path $Sdk 'signtool.exe') sign /fd SHA256 /sha1 $CertificateThumbprint $Msix | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Probe signing failed.' }
$Export = Join-Path $ProbeRoot 'exported-backup.txt'
[IO.File]::WriteAllText($Export, 'user export outside package data')
$Installed = $null
try {
    if (Get-AppxPackage -Name $PackageName) { throw 'Unique probe package already exists.' }
    Add-AppxPackage -Path $Msix
    $Installed = Get-AppxPackage -Name $PackageName
    if ($Installed.Name -cne $PackageName -or -not $PackageName.StartsWith('app.workfleet.storageprobe.')) { throw 'Unexpected installed package; do not remove it.' }
    $Output = Join-Path $ProbeRoot 'packaged'
    Invoke-CommandInDesktopPackage -PackageFamilyName $Installed.PackageFamilyName -AppId Probe -Command (Join-Path $Installed.InstallLocation 'WorkFleet.Windows.Ui.Tests.exe') -Args "--app-data `"$Output`""
    $Report = Join-Path $Output 'app-data.json'
    $Deadline = (Get-Date).AddSeconds(30)
    while (-not (Test-Path -LiteralPath $Report) -and (Get-Date) -lt $Deadline) { Start-Sleep -Milliseconds 100 }
    if (-not (Test-Path -LiteralPath $Report)) { throw 'Packaged probe did not complete.' }
    $State = [IO.File]::ReadAllText($Report) | ConvertFrom-Json
    $PrivateRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA ('Packages/' + $Installed.PackageFamilyName)))
    $Directory = [IO.Path]::GetFullPath($State.directory)
    if (-not $State.packaged -or -not $Directory.StartsWith($PrivateRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package did not resolve its private data.' }
    $Marker = Join-Path $Directory 'storage-probe.txt'
    if (-not (Test-Path -LiteralPath $Marker)) { throw 'Private data marker missing.' }
    Write-Output "PASS explicit package data: $Directory"
} finally {
    if ($Installed -and $Installed.Name -ceq $PackageName -and $PackageName.StartsWith('app.workfleet.storageprobe.')) {
        Write-Output "Remove isolated probe only: $($Installed.PackageFullName)"
        Remove-AppxPackage -Package $Installed.PackageFullName
    }
}
if (Test-Path -LiteralPath $Marker) { throw 'Uninstall left the private data marker.' }
if ([IO.File]::ReadAllText($Export) -cne 'user export outside package data') { throw 'Uninstall altered an external export.' }
Write-Output "PASS uninstall cleared private data and retained external export; evidence: $ProbeRoot"
