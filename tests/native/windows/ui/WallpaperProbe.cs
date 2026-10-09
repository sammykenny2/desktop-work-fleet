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
    // Place the test paper where no application window covers the desktop, so the real screen can be read there.
    // With --wait-desktop the probe waits for the user to reveal the desktop (Win+D) instead of skipping.
    var bounds = new PhysicalBounds(monitor.WorkArea.X + 40, monitor.WorkArea.Y + 40, 480, 300); var uncovered = false;
    var waitUntil = DateTime.UtcNow.AddSeconds(Environment.GetCommandLineArgs().Contains("--wait-desktop") ? 90 : 0);
    if (waitUntil > DateTime.UtcNow) Console.WriteLine("Waiting up to 90 s for an uncovered desktop spot (press Win+D)...");
    do
    {
      for (var y = monitor.WorkArea.Y + 40; !uncovered && y + 300 <= monitor.WorkArea.Y + monitor.WorkArea.Height; y += 120)
        for (var x = monitor.WorkArea.X + 40; !uncovered && x + 480 <= monitor.WorkArea.X + monitor.WorkArea.Width; x += 120)
          if (ShellAt(x + (int)(100 * scale), y + (int)(70 * scale), shell)) { bounds = new PhysicalBounds(x, y, 480, 300); uncovered = true; }
      if (!uncovered) await Task.Delay(500);
    } while (!uncovered && DateTime.UtcNow < waitUntil);
    var point = (X: bounds.X + (int)(100 * scale), Y: bounds.Y + (int)(70 * scale));
    var background = uncovered ? ScreenPixel(point.X, point.Y) : ((int R, int G, int B)?)null;
    // Same kind of surface the app attaches to Explorer: opaque, showing only its papers.
    using var surface = new DesktopSurface(bounds.X / scale, bounds.Y / scale, bounds.Width / scale, bounds.Height / scale, layered: false);
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
    // The attached scene's windowed WebView draws outside WPF, so the page itself is captured.
    var until = DateTime.UtcNow.AddSeconds(10); var painted = false;
    while (DateTime.UtcNow < until)
    {
      await Task.Delay(100);
      using var stream = new MemoryStream();
      await surface.WebView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream); stream.Position = 0;
      var bitmap = new FormatConvertedBitmap(BitmapDecoder.Create(stream, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0], PixelFormats.Pbgra32, null, 0);
      var x = (int)(100 * bitmap.PixelWidth / surface.InputWindow.ActualWidth); var y = (int)(70 * bitmap.PixelHeight / surface.InputWindow.ActualHeight);
      var pixel = new byte[4]; bitmap.CopyPixels(new System.Windows.Int32Rect(x, y, 1, 1), pixel, 4, 0);
      if (pixel[0] < 130 || pixel[1] > 110 || pixel[2] < 180 || pixel[3] < 240) continue;
      var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(bitmap));
      using var file = File.Create(Path.Combine(directory, "wallpaper-surface.png")); png.Save(file); painted = true; break;
    }
    if (!painted) throw new Exception("Explorer-attached wallpaper WebView did not paint its page.");
    // The attached scene's window shows only the paper; wallpaper papers lie under the icons, which take every click.
    var region = CreateRectRgn(0, 0, 0, 0);
    try { if (GetWindowRgn(input, region) is not (2 or 3)) throw new Exception("Wallpaper scene is not clipped to its paper."); }
    finally { DeleteObject(region); }
    if (GetForegroundWindow() != foreground) throw new Exception("Wallpaper initialization stole foreground focus.");
    Console.WriteLine("PASS live Explorer wallpaper host, WS_CHILD, paper-only region, WebView pixels, physical coordinates and no activation");
    // Offscreen pixels prove WPF painted, not that the desktop shows it. Ask DWM to compose the whole Explorer desktop
    // (wallpaper, icon host and their children) even where applications cover it, and read only the test paper's pixel.
    async Task<string> Screen(string layer)
    {
      await Task.Delay(800);
      var root = GetAncestor(WindowFromPoint(new NativePoint { X = point.X, Y = point.Y }), 2);
      var ownFloating = layer == "floating" && (root == input || root == visual);
      if (!ownFloating && (!uncovered || !ShellAt(point.X, point.Y, shell))) return $"SKIP on-screen {layer}: an application window covers the test spot";
      var color = ScreenPixel(point.X, point.Y);
      var shown = Math.Abs(color.R - 0xe0) < 24 && Math.Abs(color.G - 0x50) < 24 && Math.Abs(color.B - 0xa0) < 24;
      return $"{(shown ? "PASS" : "FAIL")} on-screen {layer} at {point.X},{point.Y}: rgb({color.R},{color.G},{color.B})";
    }
    var screen = new List<string> { await Screen("wallpaper") };
    surface.Hide(); surface.SetShellParent(shell.Desktop); surface.Show(false); surface.SetPhysicalBounds(bounds); screen.Add(await Screen("desktop"));
    surface.Hide(); surface.SetShellParent(IntPtr.Zero); surface.Show(true); surface.SetPhysicalBounds(bounds); screen.Add(await Screen("floating"));
    surface.Hide(); surface.SetShellParent(shell.Wallpaper); surface.Show(false); surface.SetPhysicalBounds(bounds); screen.Add(await Screen("wallpaper again"));
    foreach (var line in screen) Console.WriteLine(line);
    if (screen.Any(line => line.StartsWith("FAIL ")))
      throw new Exception("An Explorer-attached scene failed the real screen pixel check.");
    // Exercise detach/reattach on owned test surfaces without manipulating other applications.
    surface.Hide(); surface.SetShellParent(IntPtr.Zero); surface.Show(true);
    if ((GetWindowLongPtrW(input, -16).ToInt64() & 0x40000000) != 0 || (GetWindowLongPtrW(input, -20).ToInt64() & 8) == 0)
      throw new Exception("Floating transition remained a desktop child.");
    surface.Hide(); surface.SetShellParent(shell.Wallpaper); surface.Show(false); Parent(shell.Wallpaper);
    surface.Hide(); surface.SetShellParent(shell.Desktop); surface.Show(false); Parent(shell.Desktop);
    surface.Hide(); surface.Show(false); Parent(shell.Desktop);
    if (GetForegroundWindow() != foreground) throw new Exception("Layer transitions stole foreground focus.");
    Console.WriteLine("PASS wallpaper -> floating -> wallpaper -> icon host, repeated show and unchanged physical bounds");
    surface.Hide(); await Task.Delay(800);
    if (background is { } original && ShellAt(point.X, point.Y, shell))
    {
      var restored = ScreenPixel(point.X, point.Y);
      if (restored != original) throw new Exception($"An attached paper left stale desktop pixels after hiding: before={original}, after={restored}");
      Console.WriteLine("PASS hiding an Explorer-attached paper restores the original desktop pixel");
    }
    else Console.WriteLine("SKIP desktop pixel restoration: an application window covers the test spot");
  }
  private static bool ShellAt(int x, int y, NativeShellLayers shell)
  {
    var window = GetAncestor(WindowFromPoint(new NativePoint { X = x, Y = y }), 2);
    return window == shell.Desktop || window == shell.Wallpaper || window == GetAncestor(shell.Wallpaper, 2);
  }
  private static (int R, int G, int B) ScreenPixel(int x, int y)
  {
    var dc = GetDC(IntPtr.Zero);
    try { var value = GetPixel(dc, x, y); return ((int)(value & 0xff), (int)((value >> 8) & 0xff), (int)((value >> 16) & 0xff)); }
    finally { ReleaseDC(IntPtr.Zero, dc); }
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(NativePoint point);
  [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] private static extern uint GetPixel(IntPtr dc, int x, int y);
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
