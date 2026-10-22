using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using WorkFleet.Windows;

/// <summary>
/// ADR-020 on real windows: a scene still fills its bounds after they grow past the largest size Windows allowed when its
/// windows were created. A 1920x1080 start later viewed through a 2560x1306 remote session left the adjust overlay at
/// 1940x1100, the old maximum track size. Bounds larger than this screen's maximum track size reproduce that without
/// changing the display. A floating scene and a scene attached to an offscreen host window each follow the coordinator's
/// display change: shown, hidden, resized, shown again. The WebView2 controls exist, but no browser is started.
/// </summary>
internal static class SceneGrowthProbe
{
  internal static void Run()
  {
    var width = GetSystemMetrics(59) + 240; var height = GetSystemMetrics(60) + 160; // SM_CXMAXTRACK, SM_CYMAXTRACK
    var host = new Window { Left = -20000, Top = -20000, Width = 480, Height = 300, WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize,
      ShowActivated = false, ShowInTaskbar = false, WindowStartupLocation = WindowStartupLocation.Manual };
    host.Show();
    try
    {
      foreach (var layered in new[] { true, false }) Grow(layered, new WindowInteropHelper(host).Handle, width, height);
    }
    finally { host.Close(); }
  }

  private static void Grow(bool layered, IntPtr host, int width, int height)
  {
    var name = layered ? "floating" : "attached";
    using var surface = new DesktopSurface(-20000, -20000, 480, 300, layered);
    if (!layered) surface.SetShellParent(host);
    surface.Show(layered);
    var windows = new[] { surface.InputWindow, surface.VisualWindow };
    Check(windows.All(w => GetAncestor(new WindowInteropHelper(w).Handle, 1) == (layered ? GetDesktopWindow() : host)), $"{name}: scene windows have the wrong parent");
    surface.Hide();
    surface.SetPhysicalBounds(new(-20000, -20000, width, height));
    surface.Show(layered);
    var scale = surface.Dpi / 96d;
    foreach (var window in windows)
    {
      window.UpdateLayout();
      if (!GetWindowRect(new WindowInteropHelper(window).Handle, out var rect)) throw new Exception(name + ": a scene window is gone");
      Check(rect.Right - rect.Left == width && rect.Bottom - rect.Top == height, $"{name}: window {rect.Right - rect.Left}x{rect.Bottom - rect.Top} instead of {width}x{height}");
      Check(Math.Abs(window.ActualWidth * scale - width) <= 1 && Math.Abs(window.ActualHeight * scale - height) <= 1,
        $"{name}: content {window.ActualWidth * scale:0}x{window.ActualHeight * scale:0} inside a {width}x{height} window");
    }
    var web = (FrameworkElement)surface.WebView;
    Check(Math.Abs(web.ActualWidth * scale - width) <= 1 && Math.Abs(web.ActualHeight * scale - height) <= 1,
      $"{name}: browser {web.ActualWidth * scale:0}x{web.ActualHeight * scale:0} inside a {width}x{height} window");
    Console.WriteLine($"PASS {name} scene fills {width}x{height}, beyond the {width - 240}x{height - 160} maximum track size it was created with");
  }

  private static void Check(bool condition, string description)
  {
    if (!condition) throw new Exception("Scene growth: " + description);
  }

  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetDesktopWindow();
}
