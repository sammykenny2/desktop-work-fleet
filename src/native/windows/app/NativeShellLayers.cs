using System.Runtime.InteropServices;

namespace WorkFleet.Windows;

/// <summary>Explorer hosts only; never substitutes an arbitrary bottom window for wallpaper.</summary>
public sealed record NativeShellLayers(IntPtr Desktop, IntPtr Wallpaper, IntPtr Shell)
{
  public bool Changed => FindWindowW("Progman", null) != Shell
    || Desktop != IntPtr.Zero && !IsWindow(Desktop)
    || Wallpaper != IntPtr.Zero && !IsWindow(Wallpaper);

  public static NativeShellLayers Discover()
  {
    var shell = FindWindowW("Progman", null);
    if (shell == IntPtr.Zero) return new(IntPtr.Zero, IntPtr.Zero, shell);
    GetWindowThreadProcessId(shell, out var explorer);
    var hosts = FindHosts(shell, explorer);
    if (hosts.Wallpaper != IntPtr.Zero) return hosts;
    // Explorer's private desktop protocol. Bounded requests, no registry or wallpaper changes.
    // New Explorer uses a WorkerW child; older Explorer uses a sibling behind the icon host.
    foreach (var request in new[] { (W: 13, L: 0), (W: 13, L: 1), (W: 0, L: 0) })
    {
      SendMessageTimeoutW(shell, 0x052C, new IntPtr(request.W), new IntPtr(request.L), 3, 250, out _);
      hosts = FindHosts(shell, explorer);
      if (hosts.Wallpaper != IntPtr.Zero) break;
    }
    return hosts;
  }

  private static NativeShellLayers FindHosts(IntPtr shell, uint explorer)
  {
    var desktop = IntPtr.Zero;
    EnumWindows((window, _) =>
    {
      GetWindowThreadProcessId(window, out var process);
      if (process != explorer || FindWindowExW(window, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero) return true;
      desktop = window; return false;
    }, IntPtr.Zero);
    if (desktop == IntPtr.Zero) return new(desktop, IntPtr.Zero, shell);
    var icons = FindWindowExW(desktop, IntPtr.Zero, "SHELLDLL_DefView", null);
    bool BelowIcons(IntPtr window)
    {
      for (var sibling = GetWindow(icons, 2); sibling != IntPtr.Zero; sibling = GetWindow(sibling, 2))
        if (sibling == window) return true;
      return false;
    }
    bool Suitable(IntPtr window)
    {
      if (window == IntPtr.Zero || !IsWindowVisible(window)) return false;
      GetWindowThreadProcessId(window, out var process);
      return process == explorer && FindWindowExW(window, IntPtr.Zero, "SHELLDLL_DefView", null) == IntPtr.Zero;
    }
    // Modern shell: the wallpaper surface is below DefView inside the same desktop host.
    for (var child = FindWindowExW(desktop, IntPtr.Zero, "WorkerW", null); child != IntPtr.Zero;
      child = FindWindowExW(desktop, child, "WorkerW", null))
      if (Suitable(child) && BelowIcons(child)) return new(desktop, child, shell);
    // Classic shell: search only WorkerW siblings after the icon host in native Z order.
    for (var sibling = FindWindowExW(IntPtr.Zero, desktop, "WorkerW", null); sibling != IntPtr.Zero;
      sibling = FindWindowExW(IntPtr.Zero, sibling, "WorkerW", null))
      if (Suitable(sibling)) return new(desktop, sibling, shell);
    return new(desktop, IntPtr.Zero, shell);
  }

  private delegate bool EnumCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowW(string name, string? title);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string name, string? title);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint relationship);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SendMessageTimeoutW(IntPtr window, uint message,
    IntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
