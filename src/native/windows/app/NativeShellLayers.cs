using System.Runtime.InteropServices;

namespace WorkFleet.Windows;

/// <summary>Explorer hosts only; never substitutes an arbitrary bottom window for wallpaper.</summary>
public sealed record NativeShellLayers(IntPtr Desktop, IntPtr Wallpaper, IntPtr Shell)
{
  public bool Changed => HasChanged(NativeWindows.Instance);

  internal bool HasChanged(IShellWindows windows) => windows.Progman != Shell
    || Desktop != IntPtr.Zero && !windows.Alive(Desktop)
    || Wallpaper != IntPtr.Zero && !windows.Alive(Wallpaper);

  public static NativeShellLayers Discover() => Discover(NativeWindows.Instance);

  internal static NativeShellLayers Discover(IShellWindows windows)
  {
    var shell = windows.Progman;
    if (shell == IntPtr.Zero) return new(IntPtr.Zero, IntPtr.Zero, shell);
    var explorer = windows.Process(shell);
    var hosts = FindHosts(shell, explorer, windows);
    if (hosts.Wallpaper != IntPtr.Zero) return hosts;
    // Explorer's private desktop protocol. Bounded requests, no registry or wallpaper changes.
    // New Explorer uses a WorkerW child; older Explorer uses a sibling behind the icon host.
    foreach (var request in new[] { (W: 13, L: 0), (W: 13, L: 1), (W: 0, L: 0) })
    {
      windows.RequestWallpaper(shell, request.W, request.L);
      hosts = FindHosts(shell, explorer, windows);
      if (hosts.Wallpaper != IntPtr.Zero) break;
    }
    return hosts;
  }

  private static NativeShellLayers FindHosts(IntPtr shell, uint explorer, IShellWindows windows)
  {
    var desktop = IntPtr.Zero;
    foreach (var window in windows.TopLevel())
    {
      if (windows.Process(window) != explorer || windows.FindChild(window, IntPtr.Zero, "SHELLDLL_DefView") == IntPtr.Zero) continue;
      desktop = window; break;
    }
    if (desktop == IntPtr.Zero) return new(desktop, IntPtr.Zero, shell);
    var icons = windows.FindChild(desktop, IntPtr.Zero, "SHELLDLL_DefView");
    bool BelowIcons(IntPtr window)
    {
      for (var sibling = windows.Next(icons); sibling != IntPtr.Zero; sibling = windows.Next(sibling))
        if (sibling == window) return true;
      return false;
    }
    bool Suitable(IntPtr window)
    {
      if (window == IntPtr.Zero || !windows.Visible(window)) return false;
      return windows.Process(window) == explorer && windows.FindChild(window, IntPtr.Zero, "SHELLDLL_DefView") == IntPtr.Zero;
    }
    // Modern shell: the wallpaper surface is below DefView inside the same desktop host.
    for (var child = windows.FindChild(desktop, IntPtr.Zero, "WorkerW"); child != IntPtr.Zero;
      child = windows.FindChild(desktop, child, "WorkerW"))
      if (Suitable(child) && BelowIcons(child)) return new(desktop, child, shell);
    // Classic shell: search only WorkerW siblings after the icon host in native Z order.
    for (var sibling = windows.FindChild(IntPtr.Zero, desktop, "WorkerW"); sibling != IntPtr.Zero;
      sibling = windows.FindChild(IntPtr.Zero, sibling, "WorkerW"))
      if (Suitable(sibling)) return new(desktop, sibling, shell);
    return new(desktop, IntPtr.Zero, shell);
  }

  private sealed class NativeWindows : IShellWindows
  {
    public static readonly NativeWindows Instance = new();
    public IntPtr Progman => FindWindowW("Progman", null);
    public IEnumerable<IntPtr> TopLevel()
    {
      var windows = new List<IntPtr>();
      EnumWindows((window, _) => { windows.Add(window); return true; }, IntPtr.Zero);
      return windows;
    }
    public IntPtr FindChild(IntPtr parent, IntPtr after, string name) => FindWindowExW(parent, after, name, null);
    public IntPtr Next(IntPtr window) => GetWindow(window, 2);
    public uint Process(IntPtr window) { GetWindowThreadProcessId(window, out var process); return process; }
    public bool Visible(IntPtr window) => IsWindowVisible(window);
    public bool Alive(IntPtr window) => IsWindow(window);
    public void RequestWallpaper(IntPtr shell, int wParam, int lParam) =>
      SendMessageTimeoutW(shell, 0x052C, new IntPtr(wParam), new IntPtr(lParam), 3, 250, out _);
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

// Keeps the real host-selection and recovery decisions testable without another OS or manipulating Explorer.
internal interface IShellWindows
{
  IntPtr Progman { get; }
  IEnumerable<IntPtr> TopLevel();
  IntPtr FindChild(IntPtr parent, IntPtr after, string name);
  IntPtr Next(IntPtr window);
  uint Process(IntPtr window);
  bool Visible(IntPtr window);
  bool Alive(IntPtr window);
  void RequestWallpaper(IntPtr shell, int wParam, int lParam);
}
