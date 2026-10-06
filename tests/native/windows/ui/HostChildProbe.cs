using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using WorkFleet.Windows;

/// <summary>
/// Reproduces Explorer-attached scenes without Explorer. Another process owns a topmost host window created like
/// Explorer's Progman, without a redirection surface, and a scene is attached to it as a cross-process child exactly as
/// desktop and wallpaper scenes are. Because the host is topmost, the composed screen can be read while applications
/// cover the real desktop. Under such a host, scenes drawn through WPF show black and a windowed WebView created while its
/// window was hidden stays black once shown.
/// </summary>
internal static class HostChildProbe
{
  /// <summary>Runs in its own process until killed and prints the host window handle. With redirection off the host is
  /// created like Explorer's Progman, with WS_EX_NOREDIRECTIONBITMAP: it has no GDI surface of its own.</summary>
  public static void Host(bool redirection = true)
  {
    if (!redirection)
    {
      var created = CreateWindowExW(0x00200000 | 0x8 | 0x80, "Static", "Work Fleet host probe", 0x90000000, 60, 60, 540, 360,
        IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
      if (created == IntPtr.Zero) throw new Exception("Unable to create the host window.");
      Console.WriteLine($"HOST {created.ToInt64():X}"); Console.Out.Flush(); return;
    }
    var window = new Window { WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false, ShowActivated = false,
      Topmost = true, Left = 40, Top = 40, Width = 360, Height = 240, Background = new SolidColorBrush(Color.FromRgb(0x20, 0x60, 0x20)),
      WindowStartupLocation = WindowStartupLocation.Manual, Title = "Work Fleet host probe" };
    window.Show();
    Console.WriteLine($"HOST {new WindowInteropHelper(window).Handle.ToInt64():X}"); Console.Out.Flush();
  }

  /// <summary>Starts a host process, checks an attached scene the way the app starts one, and stops the host.</summary>
  public static async Task Check(string directory)
  {
    var start = new ProcessStartInfo(Environment.ProcessPath!, "--host-window-dcomp") { RedirectStandardOutput = true, UseShellExecute = false };
    using var host = Process.Start(start) ?? throw new Exception("Unable to start the host process.");
    try
    {
      var line = await host.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20));
      if (line is null || !line.StartsWith("HOST ")) throw new Exception("Host process did not report its window.");
      if (!await Run(new IntPtr(Convert.ToInt64(line[5..], 16)), directory, "startup"))
        throw new Exception("An Explorer-style attached scene did not show its paper on the screen.");
    }
    finally { if (!host.HasExited) host.Kill(); }
  }

  /// <summary>"startup" attaches a scene the way the app does; "windowed" hosts a bare windowed WebView for comparison.</summary>
  public static async Task<bool> Run(IntPtr host, string directory, string variant)
  {
    Directory.CreateDirectory(directory);
    if (!GetWindowRect(host, out var rect)) throw new Exception("Host window is gone.");
    var bounds = new PhysicalBounds(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top);
    var scale = GetDpiForWindow(host) / 96d;
    if (variant == "windowed") return await Windowed(host, directory, bounds, scale);
    using var surface = new DesktopSurface(bounds.X / scale, bounds.Y / scale, bounds.Width / scale, bounds.Height / scale, layered: false);
    // As the app does: place the scene and create its browser, navigate while hidden, show with the first frame's papers.
    surface.SetShellParent(host);
    await surface.Start(false, bounds, await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview")));
    var loaded = new TaskCompletionSource();
    surface.WebView.CoreWebView2.NavigationCompleted += (_, e) => loaded.TrySetResult();
    surface.WebView.CoreWebView2.NavigateToString("""
      <!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
      #paper{position:absolute;left:20px;top:20px;width:160px;height:100px;background:#e050a0}
      </style></head><body><article id="paper">Host test</article></body></html>
      """);
    await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
    await Task.Delay(500); surface.SetInput([new(20, 20, 160, 100, false)]); surface.Show(false);
    await Task.Delay(1500);
    return Report(variant, bounds, scale);
  }

  // The browser draws into its own child window through DirectComposition instead of into the WPF surface.
  private static async Task<bool> Windowed(IntPtr host, string directory, PhysicalBounds bounds, double scale)
  {
    var web = new Microsoft.Web.WebView2.Wpf.WebView2 { DefaultBackgroundColor = System.Drawing.Color.White };
    var window = new Window { WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, ShowInTaskbar = false, ShowActivated = false,
      Left = bounds.X / scale, Top = bounds.Y / scale, Width = bounds.Width / scale, Height = bounds.Height / scale, Content = web,
      WindowStartupLocation = WindowStartupLocation.Manual };
    var handle = new WindowInteropHelper(window).EnsureHandle();
    SetWindowLongPtrW(handle, -16, new IntPtr((GetWindowLongPtrW(handle, -16).ToInt64() & ~0x80000000L) | 0x40000000L));
    SetParent(handle, host); window.Show();
    SetWindowPos(handle, IntPtr.Zero, 0, 0, bounds.Width, bounds.Height, 0x14);
    SetWindowRgn(handle, CreateRectRgn((int)(20 * scale), (int)(20 * scale), (int)(180 * scale), (int)(120 * scale)), true);
    await web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview")));
    var loaded = new TaskCompletionSource();
    web.CoreWebView2.NavigationCompleted += (_, _) => loaded.TrySetResult();
    web.CoreWebView2.NavigateToString("<!doctype html><html><body style='margin:0;background:transparent'><article style='position:absolute;left:20px;top:20px;width:160px;height:100px;background:#e050a0'>Host test</article></body></html>");
    await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20)); await Task.Delay(1500);
    var result = Report("windowed", bounds, scale); window.Close(); return result;
  }

  private static bool Report(string variant, PhysicalBounds bounds, double scale)
  {
    var paper = Pixel(bounds.X + (int)(100 * scale), bounds.Y + (int)(70 * scale));
    var outside = Pixel(bounds.X + (int)(300 * scale), bounds.Y + (int)(200 * scale));
    var shown = Math.Abs(paper.R - 0xe0) < 24 && Math.Abs(paper.G - 0x50) < 24 && Math.Abs(paper.B - 0xa0) < 24;
    Console.WriteLine($"{(shown ? "PASS" : "FAIL")} {variant} scene under an Explorer-style host: paper rgb({paper.R},{paper.G},{paper.B}), outside rgb({outside.R},{outside.G},{outside.B})");
    return shown;
  }

  private static (int R, int G, int B) Pixel(int x, int y)
  {
    var dc = GetDC(IntPtr.Zero);
    try { var value = GetPixel(dc, x, y); return ((int)(value & 0xff), (int)((value >> 8) & 0xff), (int)((value >> 16) & 0xff)); }
    finally { ReleaseDC(IntPtr.Zero, dc); }
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowExW(uint exStyle, string className, string title, uint style,
    int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] private static extern uint GetPixel(IntPtr dc, int x, int y);
  [DllImport("user32.dll")] private static extern IntPtr SetParent(IntPtr child, IntPtr parent);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll")] private static extern IntPtr SetWindowLongPtrW(IntPtr window, int index, IntPtr value);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
}
