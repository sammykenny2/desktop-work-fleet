<#
.SYNOPSIS
    Run real Windows persistence, IPC and WPF/WebView2 UI probes with isolated data.
.DESCRIPTION
    First builds Debug app and probes. WebView2 needs a Windows user session and
    installed Evergreen Runtime. Probe windows are offscreen; shortcut/tray cases
    request activation only for owned windows and never inject global input.
    Synthetic databases/screenshots stay in a new build/native-checks-* directory.
    A restricted agent execution environment can prevent WebView2 startup; this is
    a failure, not a passing or automatically skipped test. A positive foreground
    grant is explicitly skipped when Windows declines it; rejection checks still run.
    The Debug diagnostics probe opts into a loopback WebView2 debugging port on an
    OS-chosen free port and isolated data, then closes it.
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
$PreviousDebugPort = $env:WORK_FLEET_WEBVIEW_DEBUG_PORT
try {
    # Probes own the WebView debugging port; a shell value would open CDP in every probe.
    Remove-Item Env:WORK_FLEET_WEBVIEW_DEBUG_PORT -ErrorAction SilentlyContinue
    & "$PSScriptRoot/Build-WindowsApp.ps1" -Configuration Debug -IncludeTests -SkipRestore:$SkipRestore
    # Keep the Release package scan meaningful: the same UTF-16 search must find the Debug path.
    $DebugAssembly = [IO.File]::ReadAllBytes((Join-Path $ProjectRoot 'src/native/windows/app/bin/Debug/net8.0-windows10.0.19041.0/WorkFleet.dll'))
    if (-not ([Text.Encoding]::Unicode.GetString($DebugAssembly).Contains('remote-debugging') -or
        [Text.Encoding]::Unicode.GetString($DebugAssembly, 1, $DebugAssembly.Length - 1).Contains('remote-debugging'))) {
        throw 'Debug WorkFleet.dll lacks the WebView debugging string; the Release package scan would check nothing.'
    }
    $ProbeRoot = Join-Path $ProjectRoot ('build/native-checks-' + [guid]::NewGuid().ToString())
    & dotnet tests/native/windows/core/bin/Debug/net8.0-windows/WorkFleet.Windows.Core.Tests.dll (Join-Path $ProbeRoot 'core')
    if ($LASTEXITCODE -ne 0) { throw 'Windows native core probe failed.' }
    $env:WORK_FLEET_NATIVE_TEST = '1'
    & node --test tests/native-storage.test.js
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript/native bridge tests failed.' }
    $UiProbe = Join-Path $ProjectRoot 'tests/native/windows/ui/bin/Debug/net8.0-windows10.0.19041.0/WorkFleet.Windows.Ui.Tests.exe'
    & $UiProbe (Join-Path $ProbeRoot 'ui')
    if ($LASTEXITCODE -ne 0) { throw 'Windows WPF/WebView2 UI probe failed.' }
    & $UiProbe --composition (Join-Path $ProbeRoot 'composition')
    if ($LASTEXITCODE -ne 0) { throw 'Windows desktop-surface probe failed.' }
    & $UiProbe --platform
    if ($LASTEXITCODE -ne 0) { throw 'Windows native display/shortcut probe failed.' }
    & $UiProbe --wallpaper (Join-Path $ProbeRoot 'wallpaper')
    if ($LASTEXITCODE -ne 0) { throw 'Windows Explorer wallpaper-layer probe failed.' }
    & $UiProbe --host-check (Join-Path $ProbeRoot 'host')
    if ($LASTEXITCODE -ne 0) { throw 'Windows Explorer-style attached scene probe failed.' }
    & $UiProbe --diagnostics (Join-Path $ProbeRoot 'diagnostics')
    if ($LASTEXITCODE -ne 0) { throw 'Windows Debug WebView diagnostics probe failed.' }
    Write-Output "Native checks passed; synthetic evidence: $ProbeRoot"
} finally {
    $env:WORK_FLEET_NATIVE_TEST = $PreviousNativeTest
    $env:WORK_FLEET_WEBVIEW_DEBUG_PORT = $PreviousDebugPort
    Pop-Location
}
