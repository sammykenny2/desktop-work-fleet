using Microsoft.Web.WebView2.Core;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using WorkFleet.Windows;

internal static class WallpaperProbe
{
  public static async Task Run(string directory)
  {
    Directory.CreateDirectory(directory);
    var shell = NativeShellLayers.Discover();
    if (shell.Desktop == IntPtr.Zero || shell.Wallpaper == IntPtr.Zero || shell.Desktop == shell.Wallpaper)
      throw new Exception("Explorer has no distinct wallpaper and icon hosts in this Windows session.");
    var icons = FindWindowExW(shell.Desktop, IntPtr.Zero, "SHELLDLL_DefView", null);
    var sibling = GetAncestor(shell.Wallpaper, 1) == shell.Desktop ? icons : shell.Desktop;
    var belowIcons = false;
    for (sibling = GetWindow(sibling, 2); sibling != IntPtr.Zero; sibling = GetWindow(sibling, 2))
      if (sibling == shell.Wallpaper) { belowIcons = true; break; }
    if (!belowIcons) throw new Exception("Wallpaper host is not below the Explorer icon surface in native Z order.");
    var monitor = NativeDisplays.Read().First(d => d.Primary); var scale = monitor.Dpi / 96d;
    var bounds = new PhysicalBounds(monitor.WorkArea.X + 40, monitor.WorkArea.Y + 40, 480, 300);
    using var surface = new DesktopSurface(bounds.X / scale, bounds.Y / scale, bounds.Width / scale, bounds.Height / scale);
    var foreground = GetForegroundWindow();
    surface.SetShellParent(shell.Wallpaper); surface.Show(false); surface.SetPhysicalBounds(bounds);
    surface.SetInput([new(20, 20, 160, 100, false)]);
    var input = new WindowInteropHelper(surface.InputWindow).Handle;
    var visual = new WindowInteropHelper(surface.VisualWindow).Handle;
    void Parent(IntPtr parent)
    {
      if (GetAncestor(input, 1) != parent || GetAncestor(visual, 1) != parent) throw new Exception("Scene is not attached to its requested Explorer host.");
      foreach (var handle in new[] { input, visual })
      {
        if ((GetWindowLongPtrW(handle, -16).ToInt64() & 0x40000000) == 0) throw new Exception("Attached scene lacks WS_CHILD.");
        if ((GetWindowLongPtrW(handle, -20).ToInt64() & 8) != 0) throw new Exception("Attached scene retained TOPMOST.");
        if (!GetWindowRect(handle, out var rect) || rect.Left != bounds.X || rect.Top != bounds.Y
          || rect.Right - rect.Left != bounds.Width || rect.Bottom - rect.Top != bounds.Height)
          throw new Exception($"Attached scene lost physical bounds: {rect.Left},{rect.Top},{rect.Right},{rect.Bottom}");
      }
    }
    Parent(shell.Wallpaper);
    await surface.WebView.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview")));
    var loaded = new TaskCompletionSource();
    surface.WebView.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new Exception("Wallpaper WebView navigation failed.")); };
    surface.WebView.CoreWebView2.NavigateToString("""
      <!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
      #paper{position:absolute;left:20px;top:20px;width:160px;height:100px;background:#e050a0}
      </style></head><body><article id="paper">Wallpaper test</article></body></html>
      """);
    await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
    var until = DateTime.UtcNow.AddSeconds(10); var painted = false;
    while (DateTime.UtcNow < until)
    {
      await Task.Delay(100);
      var bitmap = new RenderTargetBitmap((int)Math.Ceiling(surface.InputWindow.ActualWidth), (int)Math.Ceiling(surface.InputWindow.ActualHeight), 96, 96, PixelFormats.Pbgra32);
      bitmap.Render((Visual)surface.VisualWindow.Content);
      var pixel = new byte[4]; bitmap.CopyPixels(new System.Windows.Int32Rect(80, 70, 1, 1), pixel, 4, 0);
      if (pixel[0] < 130 || pixel[1] > 110 || pixel[2] < 180 || pixel[3] < 240) continue;
      var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(bitmap));
      using var file = File.Create(Path.Combine(directory, "wallpaper-surface.png")); png.Save(file); painted = true; break;
    }
    if (!painted) throw new Exception("Explorer-attached WPF wallpaper did not paint its live WebView pixels.");
    var region = CreateRectRgn(0, 0, 0, 0);
    try { if (GetWindowRgn(input, region) != 1) throw new Exception("Wallpaper retained a native input region."); }
    finally { DeleteObject(region); }
    if (GetForegroundWindow() != foreground) throw new Exception("Wallpaper initialization stole foreground focus.");
    Console.WriteLine("PASS live Explorer wallpaper host, WS_CHILD, zero input, WebView pixels, physical coordinates and no activation");
    // Exercise detach/reattach on owned test surfaces without manipulating other applications.
    surface.Hide(); surface.SetShellParent(IntPtr.Zero); surface.Show(true);
    if ((GetWindowLongPtrW(input, -16).ToInt64() & 0x40000000) != 0 || (GetWindowLongPtrW(input, -20).ToInt64() & 8) == 0)
      throw new Exception("Floating transition remained a desktop child.");
    surface.Hide(); surface.SetShellParent(shell.Wallpaper); surface.Show(false); Parent(shell.Wallpaper);
    surface.Hide(); surface.SetShellParent(shell.Desktop); surface.Show(false); Parent(shell.Desktop);
    surface.Hide(); surface.Show(false); Parent(shell.Desktop);
    if (GetForegroundWindow() != foreground) throw new Exception("Layer transitions stole foreground focus.");
    Console.WriteLine("PASS wallpaper -> floating -> wallpaper -> icon host, repeated show and unchanged physical bounds");
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
  [DllImport("user32.dll")] private static extern int GetWindowRgn(IntPtr window, IntPtr region);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string name, string? title);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint relationship);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr region);
}
