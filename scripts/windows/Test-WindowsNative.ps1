<#
.SYNOPSIS
    Run real Windows persistence, IPC and WPF/WebView2 UI probes with isolated data.
.DESCRIPTION
    First builds Debug app and probes. WebView2 needs a Windows user session and
    installed Evergreen Runtime. Main probe windows are offscreen; surface/formation
    probes show synthetic papers in owned windows on an uncovered desktop area. Shortcut/tray cases
    request activation only for owned windows and never inject global input.
    Synthetic databases/screenshots stay in a new build/native-checks-* directory.
    Each probe data folder stores the display language "en" before a window opens,
    so the English assertions hold whatever the Windows display language is.
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
    $DebugAssembly = [IO.File]::ReadAllBytes((Join-Path $ProjectRoot 'src/native/windows/app/bin/Debug/net10.0-windows10.0.19041.0/WorkFleet.dll'))
    if (-not ([Text.Encoding]::Unicode.GetString($DebugAssembly).Contains('remote-debugging') -or
        [Text.Encoding]::Unicode.GetString($DebugAssembly, 1, $DebugAssembly.Length - 1).Contains('remote-debugging'))) {
        throw 'Debug WorkFleet.dll lacks the WebView debugging string; the Release package scan would check nothing.'
    }
    $ProbeRoot = Join-Path $ProjectRoot ('build/native-checks-' + [guid]::NewGuid().ToString())
    $UiProbe = Join-Path $ProjectRoot 'tests/native/windows/ui/bin/Debug/net10.0-windows10.0.19041.0/WorkFleet.Windows.Ui.Tests.exe'
    & $UiProbe --shell-topology
    if ($LASTEXITCODE -ne 0) { throw 'Windows Explorer topology regression failed.' }
    & dotnet tests/native/windows/core/bin/Debug/net10.0-windows/WorkFleet.Windows.Core.Tests.dll (Join-Path $ProbeRoot 'core')
    if ($LASTEXITCODE -ne 0) { throw 'Windows native core probe failed.' }
    $env:WORK_FLEET_NATIVE_TEST = '1'
    & node --test tests/native-storage.test.js
    if ($LASTEXITCODE -ne 0) { throw 'JavaScript/native bridge tests failed.' }
    & $UiProbe (Join-Path $ProbeRoot 'ui')
    if ($LASTEXITCODE -ne 0) { throw 'Windows WPF/WebView2 UI probe failed.' }
    & $UiProbe --composition (Join-Path $ProbeRoot 'composition')
    if ($LASTEXITCODE -ne 0) { throw 'Windows desktop-surface probe failed.' }
    & $UiProbe --platform
    if ($LASTEXITCODE -ne 0) { throw 'Windows native display/shortcut probe failed.' }
    & $UiProbe --app-data (Join-Path $ProbeRoot 'app-data')
    if ($LASTEXITCODE -ne 0) { throw 'Windows app data directory probe failed.' }
    & $UiProbe --wallpaper (Join-Path $ProbeRoot 'wallpaper')
    if ($LASTEXITCODE -ne 0) { throw 'Windows Explorer wallpaper-layer probe failed.' }
    & $UiProbe --host-check (Join-Path $ProbeRoot 'host')
    if ($LASTEXITCODE -ne 0) { throw 'Windows Explorer-style attached scene probe failed.' }
    & $UiProbe --formation (Join-Path $ProbeRoot 'formation')
    if ($LASTEXITCODE -ne 0) { throw 'Windows owner formation pixel regression failed.' }
    & $UiProbe --diagnostics (Join-Path $ProbeRoot 'diagnostics')
    if ($LASTEXITCODE -ne 0) { throw 'Windows Debug WebView diagnostics probe failed.' }
    & $UiProbe --host-shell (Join-Path $ProbeRoot 'host-shell')
    if ($LASTEXITCODE -ne 0) { throw 'Windows startup settings and main window placement probe failed.' }
    & $UiProbe --crash-guard (Join-Path $ProbeRoot 'crash-guard')
    if ($LASTEXITCODE -ne 0) { throw 'Windows fatal-error guard probe failed.' }
    & $UiProbe --sign-in-hold (Join-Path $ProbeRoot 'sign-in-hold')
    if ($LASTEXITCODE -ne 0) { throw 'Windows sign-in scene hold probe failed.' }
    & $UiProbe --grid-area (Join-Path $ProbeRoot 'grid-area')
    if ($LASTEXITCODE -ne 0) { throw 'Windows group regions on a grown work area probe failed.' }
    & $UiProbe --adjust-overlay (Join-Path $ProbeRoot 'adjust-overlay')
    if ($LASTEXITCODE -ne 0) { throw 'Windows initial adjust toolbar and controls regression failed.' }
    & $UiProbe --scene-growth
    if ($LASTEXITCODE -ne 0) { throw 'Windows scene growth past its creation size regression failed.' }
    & $UiProbe --reference-dpi (Join-Path $ProbeRoot 'reference-dpi')
    if ($LASTEXITCODE -ne 0) { throw 'Windows reference DPI after a display change regression failed.' }
    Write-Output "Native checks passed; synthetic evidence: $ProbeRoot"
} finally {
    $env:WORK_FLEET_NATIVE_TEST = $PreviousNativeTest
    $env:WORK_FLEET_WEBVIEW_DEBUG_PORT = $PreviousDebugPort
    Pop-Location
}
