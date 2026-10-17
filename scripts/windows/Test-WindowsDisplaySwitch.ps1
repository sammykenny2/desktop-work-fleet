<#
.SYNOPSIS
    Check that Work Fleet survives the display change a closed-lid sign-in makes, with an isolated probe package.
.DESCRIPTION
    On 2026-10-14 the 0.2.1 sign-in launch started while Windows still used a laptop's closed internal panel as the
    primary display next to an external one; when Windows turned the panel off, the WPF render thread failed (ADR-045).
    This test repeats that change without a reboot. It switches Windows to "Extend" with DisplaySwitch.exe, starts a
    copy of build/WorkFleet-VERSION-x64.msix under the probe identity app.workfleet.displayprobe.e2e (signed with the
    same locally trusted certificate), waits for its desktop scenes to be inside Explorer, then alternates "Second screen
    only" and "Extend" for -Cycles rounds while checking that Explorer answers. Passes when the probe logs no fatal
    error and Explorer never stops answering for 5 seconds or reports a hang. It needs two connected displays (a
    laptop's lid open, since Windows does not extend to a closed lid's panel on request) and changes the display layout of the signed-in session, so other windows move while it runs; the layout named by
    -Final is restored at the end. It refuses to start while another Work Fleet is running, because the same display
    change would reach that one too. The probe package, its data and any probe crash dump are removed; host.log is kept
    under build/windows/display-probe.
.PARAMETER PackagePath
    Signed MSIX to copy. Defaults to build/WorkFleet-VERSION-x64.msix.
.PARAMETER SdkBin
    Directory containing MakeAppx.exe and SignTool.exe, or auto-detect Windows SDK.
.PARAMETER Cycles
    Rounds of "Second screen only" then "Extend" after the probe starts. Defaults to 3.
.PARAMETER SwitchAfter
    Seconds after the probe logs its start to make the first change, while its scenes may still be starting (the
    2026-10-14 sign-in failed 12.6 seconds after start). Defaults to 0: wait until the scenes have settled in Explorer.
.PARAMETER Lid
    Make the first change by closing the laptop lid within 3 minutes instead of DisplaySwitch, as at that sign-in; no
    further rounds follow.
.PARAMETER Final
    DisplaySwitch layout to leave Windows in: external (second screen only, a closed laptop on an external display),
    internal, extend or clone. Defaults to external.
.EXAMPLE
    .\scripts\windows\Build-WindowsPackage.ps1 -SkipRestore -LocalTestSign; .\scripts\windows\Test-WindowsDisplaySwitch.ps1
#>
[CmdletBinding()]
param([string]$PackagePath, [string]$SdkBin, [ValidateRange(1, 20)][int]$Cycles = 3,
    [ValidateRange(0, 60)][double]$SwitchAfter = 0, [switch]$Lid,
    [ValidateSet('external', 'internal', 'extend', 'clone')][string]$Final = 'external')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ProbeName = 'app.workfleet.displayprobe.e2e'
$DisplaySwitch = Join-Path $env:SystemRoot 'System32\DisplaySwitch.exe'
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
Add-Type -Namespace WorkFleetProbe -Name Displays -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindowW(string className, string title);
[DllImport("user32.dll")] public static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out IntPtr result);
[DllImport("user32.dll")] public static extern bool IsHungAppWindow(IntPtr window);
public delegate bool EnumCallback(IntPtr window, IntPtr parameter);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
[DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumCallback callback, IntPtr parameter);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
public delegate bool MonitorCallback(IntPtr monitor, IntPtr dc, IntPtr rect, IntPtr data);
[DllImport("user32.dll")] public static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorCallback callback, IntPtr data);
[StructLayout(LayoutKind.Sequential)] public struct NativeRect { public int Left, Top, Right, Bottom; }
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] public struct MonitorInfo
{ public int Size; public NativeRect Monitor, Work; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device; }
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);
// SMTO_ABORTIFHUNG: a window whose thread is hung fails at once instead of after the timeout.
public static bool Answers(string className) {
    var window = FindWindowW(className, null); IntPtr result;
    return window != IntPtr.Zero && SendMessageTimeoutW(window, 0, IntPtr.Zero, IntPtr.Zero, 0x2, 2000, out result) != IntPtr.Zero && !IsHungAppWindow(window);
}
public static string[] Current() {
    var values = new System.Collections.Generic.List<string>();
    EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (monitor, dc, rect, data) => {
        var info = new MonitorInfo { Size = Marshal.SizeOf(typeof(MonitorInfo)), Device = "" };
        if (GetMonitorInfoW(monitor, ref info)) values.Add(string.Format("{0}{1} {2},{3} {4}x{5}", info.Device, (info.Flags & 1) != 0 ? " primary" : "",
            info.Monitor.Left, info.Monitor.Top, info.Monitor.Right - info.Monitor.Left, info.Monitor.Bottom - info.Monitor.Top));
        return true;
    }, IntPtr.Zero);
    return values.ToArray();
}
// Windows of this process whose parent belongs to another process: scenes inside Explorer, as CrashGuard counts them.
public static int Attached(uint process) {
    var count = 0;
    EnumWindows((top, _) => {
        uint owner; GetWindowThreadProcessId(top, out owner);
        if (owner != process) EnumChildWindows(top, (child, __) => { uint value; GetWindowThreadProcessId(child, out value); if (value == process) count++; return true; }, IntPtr.Zero);
        return true;
    }, IntPtr.Zero);
    return count;
}
'@
function Switch-Display([string]$Mode, [int]$Expected) {
    & $DisplaySwitch "/$Mode"
    $Deadline = (Get-Date).AddSeconds(20)
    while ($Expected -and (Get-Date) -lt $Deadline -and @([WorkFleetProbe.Displays]::Current()).Count -ne $Expected) { Start-Sleep -Milliseconds 250 }
    $Now = @([WorkFleetProbe.Displays]::Current())
    if ($Expected -and $Now.Count -ne $Expected) { throw "DisplaySwitch /$Mode left $($Now.Count) display(s), expected $Expected; this test needs two connected displays, and Windows keeps a closed laptop lid's panel off." }
    Write-Output ("{0:HH:mm:ss.fff} /{1}: {2}" -f (Get-Date), $Mode, ($Now -join '; '))
}

$Others = @(Get-Process -Name WorkFleet -ErrorAction SilentlyContinue | Where-Object { $_.Path -notlike "*\$ProbeName*" })
if ($Others.Count -gt 0) { throw 'Quit the running Work Fleet from its tray menu first: this test changes the display layout, which would reach it too.' }
$MakeAppx = Find-SdkTool 'MakeAppx.exe'; $SignTool = Find-SdkTool 'SignTool.exe'
$Version = & node (Join-Path $ProjectRoot 'scripts/platform-version.mjs') --platform windows
if ($LASTEXITCODE -ne 0) { throw 'Could not read the Windows version.' }
if (-not $PackagePath) { $PackagePath = Join-Path $ProjectRoot "build/WorkFleet-$Version-x64.msix" }
$Package = (Resolve-Path -LiteralPath $PackagePath).ProviderPath
if ((Get-AuthenticodeSignature -LiteralPath $Package).Status -ne 'Valid') { throw 'The source MSIX must be signed and trusted; run Build-WindowsPackage.ps1 -LocalTestSign first.' }
$Work = Join-Path $ProjectRoot 'build/windows/display-probe'
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
$Manifest.Package.Identity.Name = $ProbeName; $Manifest.Package.Properties.DisplayName = 'Work Fleet display probe'
$Manifest.Save($ManifestPath)
$ProbePackage = Join-Path $Work "display-probe-$Version.msix"
& $MakeAppx pack /d $Unpacked /p $ProbePackage /o /h SHA256 > (Join-Path $Work 'pack.log')
if ($LASTEXITCODE -ne 0) { throw 'MakeAppx pack failed.' }
& $SignTool sign /sha1 $Certificate[0].Thumbprint /s My /fd SHA256 /q $ProbePackage
if ($LASTEXITCODE -ne 0) { throw 'Signing failed.' }

Remove-Probe
$Started = Get-Date
$Log = $null; $Text = ''
try {
    Write-Output ("{0:HH:mm:ss.fff} before: {1}" -f (Get-Date), (@([WorkFleetProbe.Displays]::Current()) -join '; '))
    # Start the way the 2026-10-14 sign-in did: two displays, then lose one while the scenes are inside Explorer.
    Switch-Display 'extend' 2
    Add-AppxPackage -Path $ProbePackage
    $Installed = Get-AppxPackage -Name $ProbeName
    $Data = Join-Path $env:LOCALAPPDATA "Packages\$($Installed.PackageFamilyName)\LocalCache\Local\WorkFleet"
    New-Item -ItemType Directory -Path $Data -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $Data 'host-preferences.json'), '{"version":1,"startAtLogin":false,"closeToTray":true,"openMainAtLogin":false,"language":"en"}')
    $Log = Join-Path $Data 'host.log'
    function Read-Log { if (Test-Path -LiteralPath $Log) { [IO.File]::ReadAllText($Log) } else { '' } }
    Start-Process "shell:AppsFolder\$($Installed.PackageFamilyName)!WorkFleet"

    $Deadline = (Get-Date).AddSeconds(90); $ProbeId = 0; $Scenes = 0; $Stable = 0; $Switch = $null
    while ((Get-Date) -lt $Deadline -and $Stable -lt 12 -and -not ($Switch -and (Get-Date) -ge $Switch)) {
        Start-Sleep -Milliseconds 100
        if (-not $ProbeId -and (Read-Log) -match 'start version=\S+ distribution=msix pid=(\d+)') {
            $ProbeId = [int]$Matches[1]; if ($SwitchAfter -gt 0) { $Switch = (Get-Date).AddSeconds($SwitchAfter) }
        }
        if (-not $ProbeId) { continue }
        $Now = [WorkFleetProbe.Displays]::Attached([uint32]$ProbeId)
        if ($Now -ge 4 -and $Now -eq $Scenes -and -not $Switch) { $Stable++ } else { $Stable = 0 }
        $Scenes = $Now
    }
    $Text = Read-Log
    if ($Switch -and (Get-Date) -ge $Switch) { Write-Output "Probe $ProbeId at $SwitchAfter s after start: $Scenes scene window(s) inside Explorer so far" }
    else {
        if ($Text -notmatch 'displays at start 2 display\(s\)') { throw "The probe did not start on two displays:`n$Text" }
        if ($Stable -lt 12) { throw "The probe's scenes did not settle inside Explorer ($Scenes window(s)):`n$Text" }
        Write-Output "Probe $ProbeId started with $Scenes scene window(s) inside Explorer"
    }

    $Checks = 0; $Unanswered = 0; $Longest = [TimeSpan]::Zero
    function Watch-Explorer([int]$Seconds) {
        $Until = (Get-Date).AddSeconds($Seconds); $Since = $null
        while ((Get-Date) -lt $Until) {
            $script:Checks++
            if ([WorkFleetProbe.Displays]::Answers('Progman') -and [WorkFleetProbe.Displays]::Answers('Shell_TrayWnd')) { $Since = $null }
            else {
                $script:Unanswered++; if (-not $Since) { $Since = Get-Date }
                if ((Get-Date) - $Since -gt $script:Longest) { $script:Longest = (Get-Date) - $Since }
            }
            if ((Read-Log) -match 'fatal ') { return $true }
            Start-Sleep -Milliseconds 250
        }
        return $false
    }
    $Failed = $false; $Remaining = $Cycles
    if ($Lid) {
        Write-Output ("{0:HH:mm:ss.fff} close the laptop lid now" -f (Get-Date))
        $Until = (Get-Date).AddMinutes(3)
        while ((Get-Date) -lt $Until -and @([WorkFleetProbe.Displays]::Current()).Count -ne 1) { Start-Sleep -Milliseconds 100 }
        if (@([WorkFleetProbe.Displays]::Current()).Count -ne 1) { throw 'The lid was not closed within 3 minutes.' }
        Write-Output ("{0:HH:mm:ss.fff} lid: {1}" -f (Get-Date), (@([WorkFleetProbe.Displays]::Current()) -join '; '))
        $Failed = Watch-Explorer 30; $Remaining = 0
    }
    for ($Cycle = 1; $Cycle -le $Remaining -and -not $Failed; $Cycle++) {
        Switch-Display 'external' 1
        $Failed = Watch-Explorer 20
        if ($Failed) { break }
        Switch-Display 'extend' 2
        $Failed = Watch-Explorer 20
    }
    # Windows holds a crashed probe until its report (and any LocalDumps dump) is written; Explorer must answer meanwhile.
    if ($Failed) { $Until = (Get-Date).AddSeconds(90); while ((Get-Date) -lt $Until -and (Get-Process -Id $ProbeId -ErrorAction SilentlyContinue)) { $null = Watch-Explorer 1 } }
    $Text = Read-Log
    $Hangs = @(Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Windows Error Reporting'; StartTime = $Started } -ErrorAction SilentlyContinue |
        Where-Object { $_.Message -match 'AppHang' -and $_.Message -match 'explorer\.exe' })
    $Explorer = "Explorer missed $Unanswered of $Checks checks, longest $([math]::Round($Longest.TotalSeconds, 1)) s, $($Hangs.Count) hang report(s)"
    if ($Hangs.Count -gt 0 -or $Longest.TotalSeconds -ge 5) { throw "Explorer stopped answering during the display changes. $Explorer.`n$Text" }
    if ($Failed) {
        $Fatal = if ($Text -match '(fatal \S+ uptime=\S+ detached=\d+ attachedLeft=\d+)\s+(\S+ HRESULT=0x[0-9A-F]+)') { "$($Matches[1]) $($Matches[2])" } else { 'fatal error' }
        throw "The probe failed after a display change ($Fatal); $Explorer.`n$Text"
    }
    $Rounds = if ($Lid) { 'a lid close' } else { "$Cycles rounds of second-screen-only and extend" }
    Write-Output "PASS display switch: the probe stayed up through $Rounds; $Explorer"
} finally {
    if ($Log -and (Test-Path -LiteralPath $Log)) { Copy-Item -LiteralPath $Log -Destination (Join-Path $Work 'host.log') -Force }
    try { Switch-Display $Final 0 } catch { Write-Warning "Could not restore the $Final display layout: $_" }
    Remove-Probe
    # LocalDumps (docs/testing.md) writes a probe dump beside real ones; keep only real ones.
    foreach ($Id in [regex]::Matches($Text, 'start version=\S+ distribution=msix pid=(\d+)') | ForEach-Object { $_.Groups[1].Value }) {
        foreach ($Folder in @((Join-Path $env:LOCALAPPDATA 'CrashDumps'), (Join-Path $env:LOCALAPPDATA "Packages\$ProbeName*"))) {
            Get-ChildItem -Path $Folder -Filter "WorkFleet.exe.$Id.dmp" -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
                Write-Output "Probe crash dump: $($_.FullName) ($([math]::Round($_.Length / 1MB)) MB), removed"; Remove-Item -LiteralPath $_.FullName -Force
            }
        }
    }
}
