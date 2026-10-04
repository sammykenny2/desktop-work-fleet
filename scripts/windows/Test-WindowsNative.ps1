<#
.SYNOPSIS
    Run real Windows persistence, IPC and WPF/WebView2 UI probes with isolated data.
.DESCRIPTION
    First builds Debug app and probes. WebView2 needs a Windows user session and
    installed Evergreen Runtime. Probe windows are offscreen and do not activate.
    Synthetic databases/screenshots stay in a new build/native-checks-* directory.
    A restricted agent execution environment can prevent WebView2 startup; this is
    a failure, not a passing or automatically skipped test.
.PARAMETER SkipRestore
    Use previously restored dependencies without network access.
.EXAMPLE
    .\scripts\windows\Test-WindowsNative.ps1 -SkipRestore
#>
[CmdletBinding()]
param([switch]$SkipRestore)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Push-Location $ProjectRoot
$PreviousNativeTest = $env:WORK_FLEET_NATIVE_TEST
try {
    & "$PSScriptRoot/Build-WindowsApp.ps1" -Configuration Debug -IncludeTests -SkipRestore:$SkipRestore
    $ProbeRoot = Join-Path $ProjectRoot ('build/native-checks-' + [guid]::NewGuid().ToString())
    & dotnet tests/native/windows-core/bin/Debug/net8.0-windows/WorkFleet.Windows.Core.Tests.dll (Join-Path $ProbeRoot 'core')
    if ($LASTEXITCODE -ne 0) { throw 'Windows native core probe failed.' }
    $env:WORK_FLEET_NATIVE_TEST = '1'
    & node --test tests/native-storage.test.js
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript/native bridge tests failed.' }
    & dotnet tests/native/windows-ui/bin/Debug/net8.0-windows/WorkFleet.Windows.Ui.Tests.dll (Join-Path $ProbeRoot 'ui')
    if ($LASTEXITCODE -ne 0) { throw 'Windows WPF/WebView2 UI probe failed.' }
    Write-Output "Native checks passed; synthetic evidence: $ProbeRoot"
} finally {
    $env:WORK_FLEET_NATIVE_TEST = $PreviousNativeTest
    Pop-Location
}
