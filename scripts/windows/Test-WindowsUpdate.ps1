<#
.SYNOPSIS
    Prove the in-app MSIX update end to end with an isolated probe package.
.DESCRIPTION
    Takes the locally signed build/WorkFleet-VERSION-x64.msix (Build-WindowsPackage.ps1 -LocalTestSign) and makes two
    copies under the probe identity app.workfleet.updateprobe.e2e: VERSION and the next patch version, both signed with
    the same locally trusted certificate. Installs the first, gives it a local feed folder instead of GitHub
    (ADR-044; only this identity reads one) and lets it download, verify and install the second, which closes it.
    Passes when Windows reports the newer version, then removes the probe package and its data.
    The installed Work Fleet package, its data and its certificate trust are never touched. The probe window and an
    empty desktop scene appear briefly; another running Work Fleet keeps its own global shortcuts.
.PARAMETER PackagePath
    Signed MSIX to copy. Defaults to build/WorkFleet-VERSION-x64.msix.
.PARAMETER SdkBin
    Directory containing MakeAppx.exe and SignTool.exe, or auto-detect Windows SDK.
.EXAMPLE
    .\scripts\windows\Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign; .\scripts\windows\Test-WindowsUpdate.ps1
#>
[CmdletBinding()]
param([string]$PackagePath, [string]$SdkBin)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProbeName = 'app.workfleet.updateprobe.e2e'
function Find-SdkTool([string]$Name) {
    if ($SdkBin) { $Tool = Join-Path $SdkBin $Name; if (Test-Path -LiteralPath $Tool -PathType Leaf) { return $Tool }; throw "Missing SDK tool: $Tool" }
    $OnPath = Get-Command $Name -ErrorAction SilentlyContinue; if ($OnPath) { return $OnPath.Source }
    $Root = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    foreach ($Version in Get-ChildItem -LiteralPath $Root -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending) {
        $Tool = Join-Path $Version.FullName "x64/$Name"; if (Test-Path -LiteralPath $Tool -PathType Leaf) { return $Tool }
    }
    throw "Windows SDK $Name is required. Set -SdkBin to its directory."
}
function Remove-Probe {
    Get-Process -Name WorkFleet -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*\$ProbeName*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-AppxPackage -Name $ProbeName | Remove-AppxPackage
}
$MakeAppx = Find-SdkTool 'MakeAppx.exe'; $SignTool = Find-SdkTool 'SignTool.exe'
$Version = & node (Join-Path $ProjectRoot 'scripts/platform-version.mjs') --platform windows
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Windows version.' }
if (-not $PackagePath) { $PackagePath = Join-Path $ProjectRoot "build/WorkFleet-$Version-x64.msix" }
$Package = (Resolve-Path -LiteralPath $PackagePath).ProviderPath
if ((Get-AuthenticodeSignature -LiteralPath $Package).Status -ne 'Valid') { throw 'The source MSIX must be signed and trusted; run Build-WindowsPackage.ps1 -LocalTestSign first.' }
$Parts = $Version.Split('.'); $Next = "$($Parts[0]).$($Parts[1]).$([int]$Parts[2] + 1)"
$Work = Join-Path $ProjectRoot 'build/windows/update-probe'
if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
$Unpacked = Join-Path $Work 'unpacked'; $Feed = Join-Path $Work 'feed'
New-Item -ItemType Directory -Path $Unpacked, $Feed -Force | Out-Null
& $MakeAppx unpack /p $Package /d $Unpacked /nv /o > (Join-Path $Work 'unpack.log')
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx unpack failed.' }
foreach ($Generated in @('AppxSignature.p7x', 'AppxBlockMap.xml', '[Content_Types].xml')) { Remove-Item -LiteralPath (Join-Path $Unpacked $Generated) -Force -ErrorAction SilentlyContinue }
$ManifestPath = Join-Path $Unpacked 'AppxManifest.xml'
[xml]$Original = Get-Content -LiteralPath $ManifestPath -Raw
$Publisher = $Original.Package.Identity.Publisher
$Certificate = @(Get-ChildItem -LiteralPath Cert:\CurrentUser\My -CodeSigningCert | Where-Object {
    $_.HasPrivateKey -and $_.Subject -ceq $Publisher -and $_.NotAfter -gt (Get-Date) -and (Test-Path -LiteralPath (Join-Path 'Cert:\LocalMachine\TrustedPeople' $_.Thumbprint))
})
if ($Certificate.Count -ne 1) { throw "Needs exactly one trusted signing certificate for '$Publisher', as Build-WindowsPackage -LocalTestSign does." }
function New-ProbePackage([string]$PackageVersion, [string]$Destination) {
    [xml]$Manifest = $Original.OuterXml
    $Manifest.Package.Identity.Name = $ProbeName; $Manifest.Package.Identity.Version = "$PackageVersion.0"
    $Manifest.Package.Properties.DisplayName = 'Work Fleet update probe'
    $Manifest.Save($ManifestPath)
    & $MakeAppx pack /d $Unpacked /p $Destination /o /h SHA256 > (Join-Path $Work 'pack.log')
    if ($LASTEXITCODE -ne 0) { throw "MakeAppx pack failed for $PackageVersion." }
    & $SignTool sign /sha1 $Certificate[0].Thumbprint /s My /fd SHA256 /q $Destination
    if ($LASTEXITCODE -ne 0) { throw "Signing failed for $PackageVersion." }
}
$First = Join-Path $Work "probe-$Version.msix"; $SecondName = "WorkFleet-$Next-x64.msix"; $Second = Join-Path $Feed $SecondName
New-ProbePackage $Version $First
New-ProbePackage $Next $Second
# The same shapes the updater reads from GitHub: a public Atom feed and the release's work-fleet-update.json.
$Size = (Get-Item -LiteralPath $Second).Length; $Sha = (Get-FileHash -Algorithm SHA256 -LiteralPath $Second).Hash.ToLowerInvariant()
$Update = [ordered]@{ schemaVersion = 1; platform = 'windows'; version = $Next; tag = "windows-v$Next"; summary = 'update probe'
    assets = @([ordered]@{ arch = 'x64'; name = $SecondName; size = $Size; sha256 = $Sha }) }
$UpdatePath = Join-Path $Feed 'work-fleet-update.json'
[IO.File]::WriteAllText($UpdatePath, ($Update | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new($false))
$ProbeRepository = (Get-Content -LiteralPath (Join-Path $Unpacked 'Config/public.json') -Raw | ConvertFrom-Json).update.repository
$ReleasePage = "https://github.com/$ProbeRepository/releases/tag/windows-v$Next"
$ReleaseAtom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="' + [Security.SecurityElement]::Escape($ReleasePage) + '" /></entry></feed>'
[IO.File]::WriteAllText((Join-Path $Feed 'releases.atom'), $ReleaseAtom, [Text.UTF8Encoding]::new($false))

Remove-Probe
try {
    Add-AppxPackage -Path $First
    $Installed = Get-AppxPackage -Name $ProbeName
    if ($Installed.Version -ne "$Version.0") { throw "Probe installed as $($Installed.Version)." }
    $Data = Join-Path $env:LOCALAPPDATA "Packages\$($Installed.PackageFamilyName)\LocalCache\Local\WorkFleet"
    New-Item -ItemType Directory -Path $Data -Force | Out-Null
    # No sign-in task for the probe; the feed file makes this identity download and install the next version once ready.
    [IO.File]::WriteAllText((Join-Path $Data 'host-preferences.json'), '{"version":1,"startAtLogin":false,"closeToTray":true,"openMainAtLogin":false}')
    [IO.File]::WriteAllText((Join-Path $Data 'update-probe.txt'), $Feed)
    Start-Process "shell:AppsFolder\$($Installed.PackageFamilyName)!WorkFleet"
    $Deadline = (Get-Date).AddMinutes(4); $Result = Join-Path $Data 'update-probe-result.txt'
    while ((Get-Date) -lt $Deadline) {
        $Now = Get-AppxPackage -Name $ProbeName
        if ($Now.Version -eq "$Next.0") { break }
        if (Test-Path -LiteralPath $Result) { throw "Probe reported: $(Get-Content -LiteralPath $Result -Raw)" }
        Start-Sleep -Seconds 2
    }
    if ((Get-AppxPackage -Name $ProbeName).Version -ne "$Next.0") { throw 'Timed out waiting for the probe to install its update.' }
    Write-Output "PASS in-app update installed $ProbeName $Version -> $Next after saving and closing"
} finally {
    Remove-Probe
}
