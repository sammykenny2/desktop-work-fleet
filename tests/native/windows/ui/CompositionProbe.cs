using Microsoft.Web.WebView2.Core;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Runtime.InteropServices;
using System.Windows.Interop;
using System.Windows.Input;
using System.Diagnostics;
using System.Reflection;
using WorkFleet.Windows;

internal static class CompositionProbe
{
  public static void RunHitTarget()
  {
    var app = new Application();
    var target = new Window { Width = 480, Height = 300, WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize,
      Background = Brushes.Green, ShowActivated = false, ShowInTaskbar = false, WindowStartupLocation = WindowStartupLocation.Manual,
      Left = -20000, Top = -20000 };
    target.Loaded += async (_, _) =>
    {
      Console.WriteLine(new WindowInteropHelper(target).Handle.ToInt64()); Console.Out.Flush();
      await Task.Run(() => Console.ReadLine()); target.Close();
    };
    app.Run(target);
  }

  public static async Task Run(string directory)
  {
    Directory.CreateDirectory(directory);
    using var surface = new DesktopSurface(-20000, -20000, 480, 300);
    surface.Show(topmost: true); var web = surface.WebView;
    await web.EnsureCoreWebView2Async(await CoreWebView2Environment.CreateAsync(null, Path.Combine(directory, "webview")));
    surface.PassBrowserClicksThrough();
    var loaded = new TaskCompletionSource();
    web.CoreWebView2.NavigationCompleted += (_, e) => { if (e.IsSuccess) loaded.TrySetResult(); else loaded.TrySetException(new Exception("Composition navigation failed")); };
    // Synthetic rendering only: no product bridge, user notes, paths or network.
    web.CoreWebView2.NavigateToString("""
      <!doctype html><html><head><style>html,body{margin:0;background:transparent;overflow:hidden}
      #paper{position:absolute;left:80px;top:50px;width:260px;height:170px;background:#ffe080;color:#234;font:20px sans-serif}
      </style></head><body><article id="paper">透明表面測試<textarea style="display:block;width:200px">原生輸入</textarea></article></body></html>
      """);
    await loaded.Task.WaitAsync(TimeSpan.FromSeconds(20));
    await VerifyPixels((Visual)web, directory, "composition.png", blue: false);
    Console.WriteLine($"PASS WPF composition alpha: real WebView2 {web.CoreWebView2.Environment.BrowserVersionString}, opaque paper, zero-alpha empty space");
    await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#paper').style.background='#2080f0'");
    await VerifyPixels((Visual)surface.VisualWindow.Content, directory, "composition-mirror.png", blue: true);
    Console.WriteLine("PASS live shared visual mirror updates with empty native input region");

    var info = new ProcessStartInfo(Path.ChangeExtension(Assembly.GetExecutingAssembly().Location, ".exe")) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true,
      UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden };
    info.ArgumentList.Add("--hit-target");
    using var target = Process.Start(info) ?? throw new Exception("Failed test target process");
    try
    {
      var targetHandle = new IntPtr(long.Parse(await target.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(10)) ?? throw new Exception("No target handle")));
      var handle = new WindowInteropHelper(surface.InputWindow).Handle;
      var mirrorHandle = new WindowInteropHelper(surface.VisualWindow).Handle;
      await Task.Delay(200); surface.Show(topmost: true); await Task.Delay(200);
      // Match the coordinator's policy when the browser creates or recreates its own render popup.
      surface.PassBrowserClicksThrough();
      if (!GetWindowRect(handle, out var bounds) || !GetWindowRect(targetHandle, out var targetBounds)
        || !bounds.Equals(targetBounds)) throw new Exception("Probe windows have different physical bounds");
      var scale = (bounds.Right - bounds.Left) / 480d;
      IntPtr Hit(int x, int y) => GetAncestor(WindowFromPoint(new NativePoint { X = bounds.Left + (int)(x * scale), Y = bounds.Top + (int)(y * scale) }), 2);
      AssertOrder(mirrorHandle, handle, targetHandle);
      var passiveHit = Hit(100, 150); var emptyHit = Hit(10, 10);
      if (passiveHit != targetHandle || emptyHit != targetHandle)
        throw new Exception($"Empty native region or passive visual intercepted hit: paper={Describe(passiveHit)}, empty={Describe(emptyHit)}, target={targetHandle:X}, browser PID={web.CoreWebView2.BrowserProcessId}");
      surface.SetInput([new(80, 50, 260, 170, true)]); await Task.Delay(200);
      if (Hit(100, 150) != handle || Hit(10, 10) != targetHandle) throw new Exception("Interactive paper or empty-space hit region failed");
      await web.CoreWebView2.ExecuteScriptAsync("const cover=document.createElement('article');Object.assign(cover.style,{position:'absolute',left:'180px',top:'100px',width:'130px',height:'60px',background:'#ff7060'});document.body.append(cover)");
      surface.SetInput([new(80, 50, 260, 170, true), new(180, 100, 130, 60, false)]); await Task.Delay(200);
      if (Hit(100, 150) != handle || Hit(210, 130) != targetHandle || Hit(10, 10) != targetHandle)
        throw new Exception("Foreground passive card did not occlude the interactive back card's input");
      surface.SetInput([new(80, 50, 260, 170, true), new(180, 100, 130, 60, false), new(200, 110, 40, 40, true)]);
      await Task.Delay(200);
      if (Hit(210, 130) != handle || Hit(260, 130) != targetHandle) throw new Exception("Foreground interactive card did not restore input");
      try { surface.SetInput([new(double.NaN, 0, 100, 100, true)]); throw new Exception("Invalid geometry accepted"); }
      catch (ArgumentException) { }
      if (Hit(210, 130) != handle || Hit(260, 130) != targetHandle) throw new Exception("Invalid input changed the previous policy");
      VerifySplit(handle, mirrorHandle, bounds);
      Console.WriteLine("PASS cross-process OS hits: passive paper, empty space and covered back card pass through; interactive foreground receives hit");

      surface.Show(topmost: false); await Task.Delay(300); AssertOrder(targetHandle, mirrorHandle, handle);
      if (Hit(100, 150) != targetHandle) throw new Exception("Resident scene remained above an ordinary application");
      if ((GetWindowLongPtrW(handle, -20).ToInt64() & 8) != 0 || (GetWindowLongPtrW(mirrorHandle, -20).ToInt64() & 8) != 0)
        throw new Exception("Resident layer retained TOPMOST");
      surface.Show(topmost: true); await Task.Delay(200); AssertOrder(mirrorHandle, handle, targetHandle);
      surface.PassBrowserClicksThrough();
      if (Hit(100, 150) != handle) throw new Exception("Floating layer did not restore input");
      surface.Hide(); await Task.Delay(100);
      if (Hit(100, 150) != targetHandle) throw new Exception("Hidden scene retained input");
      surface.Show(topmost: true); await Task.Delay(200);
      surface.PassBrowserClicksThrough();
      if (Hit(100, 150) != handle || Hit(260, 130) != targetHandle) throw new Exception("Reopened scene lost input policy");
      surface.SetInput([]); await Task.Delay(100);
      if (Hit(100, 150) != targetHandle) throw new Exception("Ending interaction retained an input region");
      Console.WriteLine("PASS topmost/resident layer, hide/show and empty-input transitions; no activation or input injection");
      var element = (UIElement)web;
      element.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left) { RoutedEvent = Mouse.MouseDownEvent, Handled = true });
      if (Mouse.Captured != element || GetCapture() != handle)
        throw new Exception("Floating WebView did not capture the native mouse for a drag.");
      surface.SetInput([new(300, 200, 40, 40, true)]);
      if (GetCapture() != handle) throw new Exception("Moving the input region dropped native drag capture.");
      element.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left) { RoutedEvent = Mouse.MouseUpEvent, Handled = true });
      if (Mouse.Captured == element || GetCapture() == handle) throw new Exception("Mouse release retained native drag capture.");
      var lostCapture = 0; surface.PointerCaptureLost += () => lostCapture++;
      element.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left) { RoutedEvent = Mouse.MouseDownEvent, Handled = true });
      Mouse.Capture(null);
      if (lostCapture != 1) throw new Exception("Unexpected native capture loss did not notify the scene.");
      element.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left) { RoutedEvent = Mouse.MouseDownEvent, Handled = true });
      surface.Hide();
      if (GetCapture() == handle || lostCapture != 1) throw new Exception("Hidden scene retained drag capture or sent a false cancellation.");
      surface.Show(topmost: true);
      element.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, 0, MouseButton.Left) { RoutedEvent = Mouse.MouseDownEvent, Handled = true });
      surface.SuspendInput();
      if (GetCapture() == handle || lostCapture != 1) throw new Exception("Topology suspension retained drag capture or sent a false cancellation.");
      Console.WriteLine("PASS native drag capture survives input-region movement and releases on mouse up");
      Console.WriteLine("PASS unexpected capture loss notifies the scene; hide and topology suspension release capture");
      var watch = Stopwatch.StartNew();
      surface.SetInput(Enumerable.Range(0, 20000).Select(i => new SceneHitRect((i % 200) * 2, (i / 200) * 2, 1, 1, true)));
      watch.Stop(); VerifySplit(handle, mirrorHandle, bounds);
      Console.WriteLine($"PASS 20,000 separated card regions built in {watch.ElapsedMilliseconds} ms");
      surface.InputWindow.Close(); await Task.Delay(100);
      if (surface.InputWindow.IsVisible || surface.VisualWindow.IsVisible) throw new Exception("Direct close left one scene surface visible");
      surface.Show(topmost: true); surface.VisualWindow.Close(); await Task.Delay(100);
      if (surface.InputWindow.IsVisible || surface.VisualWindow.IsVisible) throw new Exception("Mirror close left input visible");
      Console.WriteLine("PASS either window's close request hides the pair and retains the view until disposal");
      surface.Show(topmost: true); var closeCalls = 0;
      surface.CloseRequested += () => { closeCalls++; surface.Dispose(); };
      surface.InputWindow.Close(); surface.VisualWindow.Close(); await Task.Delay(100);
      if (closeCalls != 1 || surface.InputWindow.IsVisible || surface.VisualWindow.IsVisible)
        throw new Exception("Coalesced close request did not safely dispose both windows");
      Console.WriteLine("PASS CloseRequested may synchronously dispose after Closing returns; paired requests coalesce");
    }
    finally
    {
      if (!target.HasExited) await target.StandardInput.WriteLineAsync("close");
      try { await target.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5)); }
      catch (TimeoutException) { target.Kill(); throw; }
      if (target.ExitCode != 0) throw new Exception("Hit target failed: " + await target.StandardError.ReadToEndAsync());
    }
  }

  private static async Task VerifyPixels(Visual visual, string directory, string name, bool blue)
  {
    var until = DateTime.UtcNow.AddSeconds(10);
    while (DateTime.UtcNow < until)
    {
      await Task.Delay(200); var bitmap = new RenderTargetBitmap(480, 300, 96, 96, PixelFormats.Pbgra32); bitmap.Render(visual);
      var pixel = new byte[4]; bitmap.CopyPixels(new Int32Rect(100, 150, 1, 1), pixel, 4, 0);
      if (pixel[3] <= 200 || (blue && !(pixel[0] > 200 && pixel[1] > 90 && pixel[2] < 80))) continue;
      bitmap.CopyPixels(new Int32Rect(10, 10, 1, 1), pixel, 4, 0);
      if (pixel[3] != 0) throw new Exception("Scene filled transparent space");
      var png = new PngBitmapEncoder(); png.Frames.Add(BitmapFrame.Create(bitmap));
      using var output = File.Create(Path.Combine(directory, name)); png.Save(output); return;
    }
    throw new Exception("Expected composition pixels did not appear: " + name);
  }
  private static void AssertOrder(params IntPtr[] expected)
  {
    var ordered = new List<IntPtr>(); var next = GetWindow(expected[0], 0);
    for (var count = 0; next != IntPtr.Zero && count < 10000; count++, next = GetWindow(next, 2))
      if (expected.Contains(next)) ordered.Add(next);
    if (!ordered.SequenceEqual(expected)) throw new Exception("Probe native z order differs from requested layer");
  }
  private static string Describe(IntPtr window)
  {
    var name = new System.Text.StringBuilder(128);
    GetClassNameW(window, name, name.Capacity); GetWindowThreadProcessId(window, out var process);
    return $"{window:X}/{name}/PID={process}";
  }
  private static void VerifySplit(IntPtr input, IntPtr visual, NativeRect bounds)
  {
    var a = CreateRectRgn(0, 0, 0, 0); var b = CreateRectRgn(0, 0, 0, 0);
    var result = CreateRectRgn(0, 0, 0, 0); var full = CreateRectRgn(0, 0, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
    try
    {
      if (GetWindowRgn(input, a) == 0 || GetWindowRgn(visual, b) == 0) throw new Exception("Missing scene region");
      if (CombineRgn(result, a, b, 1) != 1) throw new Exception("Scene draws translucent pixels twice");
      if (CombineRgn(result, a, b, 2) == 0 || !EqualRgn(result, full)) throw new Exception("Scene split leaves a visible gap");
    }
    finally { DeleteObject(a); DeleteObject(b); DeleteObject(result); DeleteObject(full); }
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(NativePoint point);
  [DllImport("user32.dll")] private static extern IntPtr GetCapture();
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetWindow(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, System.Text.StringBuilder name, int capacity);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll")] private static extern int GetWindowRgn(IntPtr window, IntPtr region);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] private static extern int CombineRgn(IntPtr target, IntPtr first, IntPtr second, int mode);
  [DllImport("gdi32.dll")] private static extern bool EqualRgn(IntPtr first, IntPtr second);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
}
