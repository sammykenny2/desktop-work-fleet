<#
.SYNOPSIS
    List the Explorer desktop host windows used by the wallpaper and desktop layers.
.DESCRIPTION
    Read-only diagnostic for ADR-030. Prints the OS version, then every top-level
    Progman/WorkerW window with its SHELLDLL_DefView/WorkerW children, including
    each window's DPI and whether it is PerMonitorV2-aware. Use it when the
    wallpaper layer falls back or attaches to the wrong host after a Windows
    update. It does not send Explorer messages, create hosts or change windows.
.EXAMPLE
    .\scripts\windows\Get-ShellLayerInventory.ps1
#>
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
[Environment]::OSVersion.Version.ToString()
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class FleetShellInventory {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p,IntPtr after,string c,string title);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll")] static extern IntPtr GetWindowDpiAwarenessContext(IntPtr h);
 [DllImport("user32.dll")] static extern bool AreDpiAwarenessContextsEqual(IntPtr a,IntPtr b);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr h);
 public static string Describe(IntPtr h) { var s=new StringBuilder(128); GetClassName(h,s,s.Capacity); return h+" "+s+" dpi="+GetDpiForWindow(h)+" PMv2="+AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(h),new IntPtr(-4)); }
 public static string Read() { var s=new StringBuilder(); EnumWindows((h,p)=>{var c=new StringBuilder(128); GetClassName(h,c,c.Capacity); if(c.ToString()=="Progman"||c.ToString()=="WorkerW"){s.AppendLine(Describe(h)); foreach(var childClass in new[]{"SHELLDLL_DefView","WorkerW"}) { var child=IntPtr.Zero; while((child=FindWindowEx(h,child,childClass,null))!=IntPtr.Zero) s.AppendLine("  child "+Describe(child)); }}return true;},IntPtr.Zero); return s.ToString(); }
}
'@
[FleetShellInventory]::Read()
