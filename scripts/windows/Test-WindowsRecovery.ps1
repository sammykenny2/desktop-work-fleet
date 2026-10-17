<#
.SYNOPSIS
    Prove end to end that a sign-in crash leaves Explorer first, with an isolated probe package.
.DESCRIPTION
    Takes the locally signed build/WorkFleet-VERSION-x64.msix (Build-WindowsPackage.ps1 -LocalTestSign) and installs a
    copy under the probe identity app.workfleet.crashprobe.e2e, signed with the same locally trusted certificate.
    crash-probe.txt in its data directory makes this identity (ADR-045; no other reads it) start as a sign-in launch and,
    once its desktop scenes are inside Explorer, fail the way the 0.2.0 sign-in launch did: a render-thread failure.
    Passes when the probe took every window out of Explorer before Windows reported the crash, Explorer kept answering
    and reported no hang, and no instance reopened: the user turned the sign-in reopen off on 2026-10-14. Then removes
    the probe package, its data and its crash dump; host.log is kept under build/windows/crash-probe. The installed Work
    Fleet package, its data and its certificate trust are never touched. The probe's empty desktop scenes exist briefly.
.PARAMETER PackagePath
    Signed MSIX to copy. Defaults to build/WorkFleet-VERSION-x64.msix.
.PARAMETER SdkBin
    Directory containing MakeAppx.exe and SignTool.exe, or auto-detect Windows SDK.
.EXAMPLE
    .\scripts\windows\Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign; .\scripts\windows\Test-WindowsRecovery.ps1
#>
[CmdletBinding()]
param([string]$PackagePath, [string]$SdkBin)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProbeName = 'app.workfleet.crashprobe.e2e'
function Find-SdkTool([string]$Name) {
    if ($SdkBin) { $Tool = Join-Path $SdkBin $Name; if (Test-Path -LiteralPath $Tool -PathType Leaf) { return $Tool }; throw "Missing SDK tool: $Tool" }
    $OnPath = Get-Command $Name -ErrorAction SilentlyContinue; if ($OnPath) { return $OnPath.Source }
    $Root = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits/10/bin'
    foreach ($Version in Get-ChildItem -LiteralPath $Root -Directory | Where-Object { $_.Name -match '^\d+\.\d+\.\d+\.\d+$' } | Sort-Object { [version]$_.Name } -Descending) {
        $Tool = Join-Path $Version.FullName "x64/$Name"; if (Test-Path -LiteralPath $Tool -PathType Leaf) { return $Tool }
    }
    throw "Windows SDK $Name is required. Set -SdkBin to its directory."
}
function Get-ProbeProcess { @(Get-Process -Name WorkFleet -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "*\$ProbeName*" }) }
function Remove-Probe {
    Get-ProbeProcess | Stop-Process -Force -ErrorAction SilentlyContinue
    Get-AppxPackage -Name $ProbeName | Remove-AppxPackage
}
Add-Type -Namespace WorkFleetProbe -Name Shell -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string className, string title);
[DllImport("user32.dll")] public static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
[DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr window);
// SMTO_ABORTIFHUNG: a window whose thread is hung fails at once instead of after the timeout.
public static bool Answers(string className) {
    var window = FindWindowW(className, null); IntPtr result;
    return window != IntPtr.Zero && SendMessageTimeoutW(window, 0, IntPtr.Zero, IntPtr.Zero, 0x2, 2000, out result) != IntPtr.Zero && !IsHungAppWindow(window);
}
'@
$MakeAppx = Find-SdkTool 'MakeAppx.exe'; $SignTool = Find-SdkTool 'SignTool.exe'
$Version = & node (Join-Path $ProjectRoot 'scripts/platform-version.mjs') --platform windows
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Windows version.' }
if (-not $PackagePath) { $PackagePath = Join-Path $ProjectRoot "build/WorkFleet-$Version-x64.msix" }
$Package = (Resolve-Path -LiteralPath $PackagePath).ProviderPath
if ((Get-AuthenticodeSignature -LiteralPath $Package).Status -ne 'Valid') { throw 'The source MSIX must be signed and trusted; run Build-WindowsPackage.ps1 -LocalTestSign first.' }
$Work = Join-Path $ProjectRoot 'build/windows/crash-probe'
if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
$Unpacked = Join-Path $Work 'unpacked'
New-Item -ItemType Directory -Path $Unpacked -Force | Out-Null
& $MakeAppx unpack /p $Package /d $Unpacked /nv /o > (Join-Path $Work 'unpack.log')
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx unpack failed.' }
foreach ($Generated in @('AppxSignature.p7x', 'AppxBlockMap.xml', '[Content_Types].xml')) { Remove-Item -LiteralPath (Join-Path $Unpacked $Generated) -Force -ErrorAction SilentlyContinue }
$ManifestPath = Join-Path $Unpacked 'AppxManifest.xml'
[xml]$Manifest = Get-Content -LiteralPath $ManifestPath -Raw
$Publisher = $Manifest.Package.Identity.Publisher
$Certificate = @(Get-ChildItem -LiteralPath Cert:\CurrentUser\My -CodeSigningCert | Where-Object {
    $_.HasPrivateKey -and $_.Subject -ceq $Publisher -and $_.NotAfter -gt (Get-Date) -and (Test-Path -LiteralPath (Join-Path 'Cert:\LocalMachine\TrustedPeople' $_.Thumbprint))
})
if ($Certificate.Count -ne 1) { throw "Needs exactly one trusted signing certificate for '$Publisher', as Build-WindowsPackage -LocalTestSign does." }
$Manifest.Package.Identity.Name = $ProbeName; $Manifest.Package.Properties.DisplayName = 'Work Fleet crash probe'
$Manifest.Save($ManifestPath)
$ProbePackage = Join-Path $Work "crash-probe-$Version.msix"
& $MakeAppx pack /d $Unpacked /p $ProbePackage /o /h SHA256 > (Join-Path $Work 'pack.log')
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx pack failed.' }
& $SignTool sign /sha1 $Certificate[0].Thumbprint /s My /fd SHA256 /q $ProbePackage
if ($LASTEXITCODE -ne 0) { throw 'Signing failed.' }

Remove-Probe
$Started = Get-Date
$FirstId = $null; $Log = $null
try {
    Add-AppxPackage -Path $ProbePackage
    $Installed = Get-AppxPackage -Name $ProbeName
    $Data = Join-Path $env:LOCALAPPDATA "Packages\$($Installed.PackageFamilyName)\LocalCache\Local\WorkFleet"
    New-Item -ItemType Directory -Path $Data -Force | Out-Null
    # No sign-in task for the probe; crash-probe.txt makes this identity act as a sign-in launch that loses its renderer once.
    [IO.File]::WriteAllText((Join-Path $Data 'host-preferences.json'), '{"version":1,"startAtLogin":false,"closeToTray":true,"openMainAtLogin":false,"language":"en"}')
    [IO.File]::WriteAllText((Join-Path $Data 'crash-probe.txt'), 'render-thread')
    $Log = Join-Path $Data 'host.log'
    function Read-Log { if (Test-Path -LiteralPath $Log) { [IO.File]::ReadAllText($Log) } else { '' } }
    Start-Process "shell:AppsFolder\$($Installed.PackageFamilyName)!WorkFleet"

    $Deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $Deadline -and (Read-Log) -notmatch 'fatal ui') { Start-Sleep -Milliseconds 250 }
    $Text = Read-Log
    if ($Text -notmatch 'start version=\S+ distribution=msix pid=(\d+) launchedAtLogin=True restarted=False') { throw "The probe did not start as a sign-in launch:`n$Text" }
    $FirstId = [int]$Matches[1]
    if ($Text -notmatch 'fatal ui uptime=\S+ detached=(\d+) attachedLeft=0') { throw "The probe did not take its windows out of Explorer before failing:`n$Text" }
    $Detached = [int]$Matches[1]
    if ($Detached -lt 1) { throw "The probe had no scene inside Explorer when it failed:`n$Text" }

    # While Windows reports the crash, Explorer must keep answering.
    $Checks = 0; $Unanswered = 0
    $Deadline = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $Deadline) {
        $Checks++
        if (-not [WorkFleetProbe.Shell]::Answers('Progman') -or -not [WorkFleetProbe.Shell]::Answers('Shell_TrayWnd')) { $Unanswered++ }
        if (-not (Get-Process -Id $FirstId -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
    if (Get-Process -Id $FirstId -ErrorAction SilentlyContinue) { throw "The failed probe $FirstId did not end within 2 minutes." }

    # The reopen is off: a failed sign-in launch stays gone, so the user can tell it failed.
    Start-Sleep -Seconds 10
    $Text = Read-Log
    if ($Text -match 'reopening hidden once|restarted=True') { throw "The probe reopened itself although the reopen is off:`n$Text" }
    if (Test-Path -LiteralPath (Join-Path $Data 'restart.json')) { throw 'The probe left a restart marker although the reopen is off.' }
    $Running = @(Get-ProbeProcess)
    if ($Running.Count -ne 0) { throw "Expected no probe instance after the failure; found $($Running.Id -join ', ')." }
    $Hangs = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Windows Error Reporting'; StartTime = $Started } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'AppHang' -and $_.Message -match 'explorer\.exe' })
    if ($Unanswered -gt 0 -or $Hangs.Count -gt 0) { throw "Explorer stopped answering $Unanswered of $Checks checks and reported $($Hangs.Count) hangs during the crash." }
    Write-Output "PASS sign-in crash: $Detached scene windows left Explorer before the report, Explorer answered $Checks checks, no instance reopened"
} finally {
    if ($Log -and (Test-Path -LiteralPath $Log)) { Copy-Item -LiteralPath $Log -Destination (Join-Path $Work 'host.log') -Force }
    Remove-Probe
    # LocalDumps (docs/testing.md) writes the probe's dump beside real ones; keep only real ones.
    if ($FirstId) {
        foreach ($Folder in @((Join-Path $env:LOCALAPPDATA 'CrashDumps'), (Join-Path $env:LOCALAPPDATA "Packages\$ProbeName*"))) {
            Get-ChildItem -Path $Folder -Filter "WorkFleet.exe.$FirstId.dmp" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Output "Probe crash dump: $($_.FullName) ($([math]::Round($_.Length / 1MB)) MB), removed"; Remove-Item -LiteralPath $_.FullName -Force
            }
        }
    }
}
