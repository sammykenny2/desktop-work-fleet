using Microsoft.Web.WebView2.Core;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
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
    var targets = new[] { (X: 20, Y: 20, Height: 100), (X: 20, Y: 130, Height: 32), (X: 200, Y: 20, Height: 100) };
    var relativeSamples = targets.SelectMany(target =>
      from x in new[] { target.X, target.X + 4, target.X + 80, target.X + 155, target.X + 160 }
      from y in new[] { target.Y, target.Y + 4, target.Y + target.Height / 2, target.Y + target.Height - 5, target.Y + target.Height }
      where x * scale < 480 && y * scale < 300
      select (X: (int)(x * scale), Y: (int)(y * scale))).Distinct().ToArray();
    // Place the test paper where no application window covers the desktop, so the real screen can be read there.
    // With --wait-desktop the probe waits for the user to reveal the desktop (Win+D) instead of skipping.
    var bounds = new PhysicalBounds(monitor.WorkArea.X + 40, monitor.WorkArea.Y + 40, 480, 300); var uncovered = false;
    var waitUntil = DateTime.UtcNow.AddSeconds(Environment.GetCommandLineArgs().Contains("--wait-desktop") ? 90 : 0);
    if (waitUntil > DateTime.UtcNow) Console.WriteLine("Waiting up to 90 s for an uncovered desktop spot (press Win+D)...");
    do
    {
      for (var y = monitor.WorkArea.Y + 40; !uncovered && y + 300 <= monitor.WorkArea.Y + monitor.WorkArea.Height; y += 120)
        for (var x = monitor.WorkArea.X + 40; !uncovered && x + 480 <= monitor.WorkArea.X + monitor.WorkArea.Width; x += 120)
          if (relativeSamples.All(p => ShellAt(x + p.X, y + p.Y, shell))) { bounds = new PhysicalBounds(x, y, 480, 300); uncovered = true; }
      if (!uncovered) await Task.Delay(500);
    } while (!uncovered && DateTime.UtcNow < waitUntil);
    var point = (X: bounds.X + (int)(100 * scale), Y: bounds.Y + (int)(70 * scale));
    var background = uncovered ? ScreenPixel(point.X, point.Y) : ((int R, int G, int B)?)null;
    using var focus = new ForegroundObservation();
    // Same kind of surface the app attaches to Explorer: opaque, showing only its papers.
    using var surface = new DesktopSurface(bounds.X / scale, bounds.Y / scale, bounds.Width / scale, bounds.Height / scale, layered: false);
    var foreground = GetForegroundWindow();
    // As DesktopCoordinator attaches a wallpaper scene (ADR-060).
    Func<bool> repaintWallpaper = () => shell.RepaintWallpaper();
    surface.SetShellParent(shell.Wallpaper, repaintWallpaper); surface.Show(false); surface.SetPhysicalBounds(bounds);
    surface.SetInput([new(20, 20, 160, 100, false)]);
    var input = new WindowInteropHelper(surface.InputWindow).Handle;
    var visual = new WindowInteropHelper(surface.VisualWindow).Handle;
    Console.WriteLine($"Wallpaper test handles: input={input:X}, visual={visual:X}");
    // ADR-049: no Direct3D render target inside Explorer.
    if (new[] { input, visual }.Any(handle => HwndSource.FromHwnd(handle).CompositionTarget.RenderMode != RenderMode.SoftwareOnly))
      throw new Exception("Attached scene windows must render WPF in software.");
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
    var environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview"));
    await surface.WebView.EnsureCoreWebView2Async(environment);
    focus.BrowserProcess = surface.WebView.CoreWebView2.BrowserProcessId;
    var loaded = new TaskCompletionSource();
    surface.WebView.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new Exception("Wallpaper WebView navigation failed.")); };
    const string page = """
      <!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
      #paper{position:absolute;left:20px;top:20px;width:160px;height:100px;background:#e050a0}
      </style></head><body><article id="paper">Wallpaper test</article></body></html>
      """;
    surface.WebView.CoreWebView2.NavigateToString(page);
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
    focus.Check();
    Console.WriteLine("PASS live Explorer wallpaper host, WS_CHILD, software WPF rendering, paper-only region, WebView pixels, physical coordinates and no activation");
    // Offscreen pixels prove WPF painted, not that the desktop shows it. Ask DWM to compose the whole Explorer desktop
    // (wallpaper, icon host and their children) even where applications cover it, and read only the test paper's pixel.
    // Product layers have separate surface types: never detach a windowed Explorer child and turn it into a popup.
    // WPF's repeated non-layered child -> popup Show can activate it, but the coordinator never follows that path.
    using var floatingSurface = new DesktopSurface(bounds.X / scale, bounds.Y / scale, bounds.Width / scale, bounds.Height / scale);
    await floatingSurface.Start(true, bounds, environment);
    var floatingLoaded = new TaskCompletionSource();
    floatingSurface.WebView.CoreWebView2.NavigationCompleted += (_, e) =>
    { if (e.IsSuccess) floatingLoaded.TrySetResult(); else floatingLoaded.TrySetException(new Exception("Floating WebView navigation failed.")); };
    floatingSurface.WebView.CoreWebView2.NavigateToString(page); await floatingLoaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
    var floatingInput = new WindowInteropHelper(floatingSurface.InputWindow).Handle;
    var floatingVisual = new WindowInteropHelper(floatingSurface.VisualWindow).Handle;
    // The floating scene shows WPF's own drawing of the composition WebView, so it keeps hardware rendering.
    if (new[] { floatingInput, floatingVisual }.Any(handle => HwndSource.FromHwnd(handle).CompositionTarget.RenderMode != RenderMode.Default))
      throw new Exception("The floating scene must keep WPF's default rendering.");
    async Task<string> Screen(string layer)
    {
      await Task.Delay(800);
      var root = GetAncestor(WindowFromPoint(new NativePoint { X = point.X, Y = point.Y }), 2);
      var ownFloating = layer == "floating" && (root == floatingInput || root == floatingVisual);
      if (!ownFloating && (!uncovered || !ShellAt(point.X, point.Y, shell))) return $"SKIP on-screen {layer}: an application window covers the test spot";
      var color = ScreenPixel(point.X, point.Y);
      var shown = Math.Abs(color.R - 0xe0) < 24 && Math.Abs(color.G - 0x50) < 24 && Math.Abs(color.B - 0xa0) < 24;
      return $"{(shown ? "PASS" : "FAIL")} on-screen {layer} at {point.X},{point.Y}: rgb({color.R},{color.G},{color.B})";
    }
    var screen = new List<string> { await Screen("wallpaper") };
    focus.Phase = "wallpaper to desktop";
    surface.Hide(); surface.SetShellParent(shell.Desktop); surface.Show(false); surface.SetPhysicalBounds(bounds); screen.Add(await Screen("desktop"));
    focus.Phase = "desktop to composition floating";
    surface.Hide(); floatingSurface.SetInput([new(20, 20, 160, 100, true)]); floatingSurface.Show(true); floatingSurface.PassBrowserClicksThrough();
    screen.Add(await Screen("floating"));
    focus.Phase = "composition floating to wallpaper";
    floatingSurface.Hide(); surface.SetShellParent(shell.Wallpaper, repaintWallpaper); surface.Show(false); surface.SetPhysicalBounds(bounds); screen.Add(await Screen("wallpaper again"));
    foreach (var line in screen) Console.WriteLine(line);
    if (screen.Any(line => line.StartsWith("FAIL ")))
      throw new Exception("An Explorer-attached scene failed the real screen pixel check.");
    // Exercise the same separate composition surface again, then reattach only between compatible shell hosts.
    focus.Phase = "second composition floating show";
    surface.Hide(); floatingSurface.Show(true);
    if ((GetWindowLongPtrW(floatingInput, -16).ToInt64() & 0x40000000) != 0 || (GetWindowLongPtrW(floatingInput, -20).ToInt64() & 8) == 0)
      throw new Exception("Floating composition scene is not a top-level topmost window.");
    floatingSurface.Hide();
    surface.Hide(); surface.SetShellParent(shell.Wallpaper, repaintWallpaper); surface.Show(false); Parent(shell.Wallpaper);
    surface.Hide(); surface.SetShellParent(shell.Desktop); surface.Show(false); Parent(shell.Desktop);
    surface.Hide(); surface.Show(false); Parent(shell.Desktop);
    await Task.Delay(100);
    focus.Check();
    if (GetForegroundWindow() != foreground)
    {
      var current = GetForegroundWindow();
      string Describe(IntPtr handle)
      {
        var name = new StringBuilder(128); GetClassNameW(handle, name, name.Capacity);
        GetWindowThreadProcessId(handle, out var process);
        return $"{handle:X}/{name}/PID:{process}";
      }
      Console.WriteLine($"SKIP unchanged foreground: external foreground changed, before={Describe(foreground)}, after={Describe(current)}, beforeAlive={IsWindow(foreground)}; owned scene activation event check passed.");
    }
    Console.WriteLine("PASS wallpaper -> floating -> wallpaper -> icon host, repeated show, unchanged physical bounds and no owned foreground activation");
    surface.Hide(); await Task.Delay(800);
    // No pointer input: simulate the moved/resized paper footprints used by stack/spread, on the real Explorer
    // surfaces. Compare every old center and edge against its original screen pixel while the new paper is visible.
    var samples = relativeSamples.Select(p => (X: bounds.X + p.X, Y: bounds.Y + p.Y)).ToArray();
    if (uncovered && samples.All(p => ShellAt(p.X, p.Y, shell)))
    {
      var originalPixels = samples.ToDictionary(p => p, p => ScreenPixel(p.X, p.Y));
      // The product's scene spans the entire monitor; keep only this small paper footprint visible and captured.
      surface.SetPhysicalBounds(monitor.Bounds);
      var offsetX = (bounds.X - monitor.Bounds.X) / scale; var offsetY = (bounds.Y - monitor.Bounds.Y) / scale;
      foreach (var layer in new[] { (Name: "wallpaper", Parent: shell.Wallpaper), (Name: "desktop", Parent: shell.Desktop) })
      {
        var previous = targets[0];
        surface.SetShellParent(layer.Parent, layer.Parent == shell.Wallpaper ? repaintWallpaper : null);
        await surface.WebView.ExecuteScriptAsync(FormattableString.Invariant($"Object.assign(document.getElementById('paper').style,{{left:'{offsetX + 20}px',top:'{offsetY + 20}px',height:'100px'}})"));
        surface.SetInput([new(offsetX + 20, offsetY + 20, 160, 100, false)]); surface.Show(false); await Task.Delay(800);
        NativeScreenCapture.Save(bounds, Path.Combine(directory, $"{layer.Name}-adjusted.png"));
        var step = 0;
        foreach (var target in new[] { targets[1], targets[2], targets[0], targets[1], targets[2], targets[0] })
        {
          surface.Hide();
          await surface.WebView.ExecuteScriptAsync(FormattableString.Invariant($"Object.assign(document.getElementById('paper').style,{{left:'{offsetX + target.X}px',top:'{offsetY + target.Y}px',height:'{target.Height}px'}})"));
          surface.SetInput([new(offsetX + target.X, offsetY + target.Y, 160, target.Height, false)]); surface.Show(false); await Task.Delay(800);
          var center = (X: bounds.X + (int)((target.X + 80) * scale), Y: bounds.Y + (int)((target.Y + target.Height / 2) * scale));
          var color = ScreenPixel(center.X, center.Y);
          if (Math.Abs(color.R - 0xe0) >= 24 || Math.Abs(color.G - 0x50) >= 24 || Math.Abs(color.B - 0xa0) >= 24)
            throw new Exception($"Moved {layer.Name} paper did not appear at {center}: {color}");
          foreach (var p in samples.Where(p => p.X >= bounds.X + previous.X * scale && p.X <= bounds.X + (previous.X + 160) * scale
            && p.Y >= bounds.Y + previous.Y * scale && p.Y <= bounds.Y + (previous.Y + previous.Height) * scale))
          {
            var restored = ScreenPixel(p.X, p.Y);
            if (restored != originalPixels[p]) throw new Exception($"Moved {layer.Name} paper left stale pixels at {p}: before={originalPixels[p]}, after={restored}");
          }
          if (step < 3) NativeScreenCapture.Save(bounds, Path.Combine(directory, $"{layer.Name}-step-{step}.png"));
          step++;
          previous = target;
        }
        surface.Hide(); await Task.Delay(800);
        foreach (var p in samples)
          if (ScreenPixel(p.X, p.Y) != originalPixels[p]) throw new Exception($"Hidden {layer.Name} scene left stale pixels at {p}");
        NativeScreenCapture.Save(bounds, Path.Combine(directory, $"{layer.Name}-hidden.png"));
        Console.WriteLine($"PASS full-monitor live Explorer {layer.Name}: repeated adjusted/stack/spread footprints restore old centers and edges while the next paper is visible");
      }
    }
    else Console.WriteLine("SKIP live Explorer moved-paper pixels: an application covers part of the test footprint");
    if (background is { } original && ShellAt(point.X, point.Y, shell))
    {
      var restored = ScreenPixel(point.X, point.Y);
      if (restored != original) throw new Exception($"An attached paper left stale desktop pixels after hiding: before={original}, after={restored}");
      Console.WriteLine("PASS hiding an Explorer-attached paper restores the original desktop pixel");
    }
    else Console.WriteLine("SKIP desktop pixel restoration: an application window covers the test spot");
    focus.Phase = "wallpaper host remnants";
    await WallpaperHostRemnants(shell, bounds, scale, environment, directory);
    focus.Check();
  }

  /// <summary>
  /// ADR-060: Explorer does not draw the wallpaper again where an attached scene leaves its wallpaper host, so what the
  /// scene last drew there stays. A black wallpaper hides a black remnant and the screen check above cannot see it, so
  /// the host's own pixels are read and first marked with a sentinel colour the host loses only by drawing the wallpaper
  /// itself. Where a paper was, the host must then show what it shows just beside it. No application covering the spot
  /// matters: the host is read with PrintWindow.
  /// </summary>
  private static async Task WallpaperHostRemnants(NativeShellLayers shell, PhysicalBounds bounds, double scale,
    CoreWebView2Environment environment, string directory)
  {
    if (!GetWindowRect(shell.Wallpaper, out var host)) throw new Exception("No wallpaper host to read.");
    var hostBounds = new PhysicalBounds(0, 0, host.Right - host.Left, host.Bottom - host.Top);
    (int R, int G, int B) HostPixel(byte[] pixels, double x, double y)
    {
      var index = (((bounds.Y + (int)(y * scale)) - host.Top) * hostBounds.Width + (bounds.X + (int)(x * scale)) - host.Left) * 4;
      return (pixels[index + 2], pixels[index + 1], pixels[index]);
    }
    static bool Near((int R, int G, int B) a, (int R, int G, int B) b) =>
      Math.Abs(a.R - b.R) < 24 && Math.Abs(a.G - b.G) < 24 && Math.Abs(a.B - b.B) < 24;
    var sentinel = (R: 0xff, G: 0x00, B: 0xff);
    void Mark()
    {
      var origin = new NativePoint { X = bounds.X, Y = bounds.Y };
      if (!ScreenToClient(shell.Wallpaper, ref origin)) throw new Exception("Unable to map the wallpaper host.");
      var dc = GetDC(shell.Wallpaper); var brush = CreateSolidBrush(0x00ff00ff);
      try
      {
        // The host clips its children, so only the wallpaper outside the scene's papers is marked.
        var rect = new NativeRect { Left = origin.X, Top = origin.Y, Right = origin.X + bounds.Width, Bottom = origin.Y + bounds.Height };
        if (dc == IntPtr.Zero || brush == IntPtr.Zero || FillRect(dc, ref rect, brush) == 0) throw new Exception("Unable to mark the wallpaper host.");
      }
      finally { if (brush != IntPtr.Zero) DeleteObject(brush); if (dc != IntPtr.Zero) ReleaseDC(shell.Wallpaper, dc); }
    }
    // Beside both papers, inside the scene and the mark.
    var beside = (X: 100.0, Y: 200.0);
    var papers = new[] { (X: 20.0, Y: 20.0), (X: 200.0, Y: 20.0) };
    try
    {
      Mark(); await Task.Delay(200);
      if (!Near(HostPixel(NativeScreenCapture.Read(hostBounds, shell.Wallpaper), beside.X, beside.Y), sentinel))
      {
        Console.WriteLine("SKIP wallpaper host remnants: the host does not keep pixels drawn into it, so no remnant can stay");
        return;
      }
      using var scene = new DesktopSurface(bounds.X / scale, bounds.Y / scale, bounds.Width / scale, bounds.Height / scale, layered: false);
      // As DesktopCoordinator attaches a wallpaper scene.
      scene.SetShellParent(shell.Wallpaper, () => shell.RepaintWallpaper()); scene.Show(false); scene.SetPhysicalBounds(bounds);
      await scene.WebView.EnsureCoreWebView2Async(environment);
      var loaded = new TaskCompletionSource();
      scene.WebView.CoreWebView2.NavigationCompleted += (_, e) =>
      { if (e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new Exception("Remnant WebView navigation failed.")); };
      scene.WebView.CoreWebView2.NavigateToString("""
        <!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
        article{position:absolute;top:20px;width:160px;height:100px;background:#e050a0}
        </style></head><body><article style="left:20px"></article><article style="left:200px"></article></body></html>
        """);
      await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
      scene.SetInput(papers.Select(p => new SceneHitRect(p.X, p.Y, 160, 100, false)));
      var until = DateTime.UtcNow.AddSeconds(10); var painted = false;
      while (!painted && DateTime.UtcNow < until)
      {
        await Task.Delay(200);
        var pixels = NativeScreenCapture.Read(hostBounds, shell.Wallpaper);
        painted = papers.All(p => Near(HostPixel(pixels, p.X + 80, p.Y + 50), (0xe0, 0x50, 0xa0)));
      }
      if (!painted) throw new Exception("The remnant scene's papers never showed on the wallpaper host.");
      void Expect(string step, (double X, double Y) paper)
      {
        var pixels = NativeScreenCapture.Read(hostBounds, shell.Wallpaper);
        var old = HostPixel(pixels, paper.X + 80, paper.Y + 50); var next = HostPixel(pixels, beside.X, beside.Y);
        if (!Near(old, next))
        {
          NativeScreenCapture.Save(hostBounds, Path.Combine(directory, $"wallpaper-host-{step}.png"), shell.Wallpaper);
          throw new Exception($"The wallpaper host kept a scene remnant after {step}: rgb{old} where the paper was, rgb{next} beside it");
        }
      }
      // A dropped paper (SetInput's uncovered path), then the whole scene (Hide), each against a fresh mark.
      Mark(); scene.SetInput([new SceneHitRect(papers[0].X, papers[0].Y, 160, 100, false)]); await Task.Delay(800);
      Expect("dropping a paper", papers[1]);
      Mark(); scene.Hide(); await Task.Delay(800);
      Expect("hiding the scene", papers[0]);
      Console.WriteLine("PASS the wallpaper host shows no scene remnant after a paper is dropped or the scene is hidden");
    }
    finally
    {
      // Never leave the sentinel or a remnant on the owner's wallpaper.
      shell.RepaintWallpaper();
    }
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
  [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr window, ref NativePoint point);
  [DllImport("user32.dll")] private static extern int FillRect(IntPtr dc, ref NativeRect rect, IntPtr brush);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateSolidBrush(uint color);
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
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, StringBuilder name, int maximum);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr FindWindowExW(IntPtr parent, IntPtr after, string name, string? title);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint relationship);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr region);
}
