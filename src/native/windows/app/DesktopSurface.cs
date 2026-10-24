using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Input;
using System.Windows.Media;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

public readonly record struct SceneHitRect(double X, double Y, double Width, double Height, bool Interactive);

/// <summary>One logical scene, one browser, two native surfaces. All methods run on the WPF dispatcher.</summary>
public sealed class DesktopSurface : IDisposable
{
  public IWebView2 WebView { get; }
  public Window InputWindow { get; }
  public Window VisualWindow { get; }
  private readonly bool layered;
  private bool disposed;
  private bool shown;
  private bool floating;
  private bool ordering;
  private bool closePending;
  private bool inputSuspended;
  private bool dragCaptured;
  private IntPtr shellParent;
  private PhysicalBounds? physicalBounds;
  public bool Shown => shown;
  public bool NativeAlive => InputHandle != IntPtr.Zero && VisualHandle != IntPtr.Zero && IsWindow(InputHandle) && IsWindow(VisualHandle);
  public uint Dpi => GetDpiForWindow(InputHandle);
  public event Action? CloseRequested;
  public event Action? DpiChanged;
  public event Action? PointerCaptureLost;
  private SceneHitRect[] rectangles = [];
  private IntPtr InputHandle => new WindowInteropHelper(InputWindow).Handle;
  private IntPtr VisualHandle => new WindowInteropHelper(VisualWindow).Handle;

  /// <param name="layered">
  /// A top-level scene: per-pixel transparent windows, with the composition WebView mirrored into a click-through visual
  /// window so that only interactive papers take input. Scenes attached to Explorer cannot work that way. Explorer's
  /// desktop window has no redirection surface (WS_EX_NOREDIRECTIONBITMAP), so a child that paints through WPF, layered
  /// or not, never reaches the screen: transparent ones vanish and opaque ones show black (measured on the real screen,
  /// Windows 11 build 26200, and reproduced under a host created with the same style). An attached scene therefore hosts
  /// a windowed WebView, which the browser draws into its own child window through DirectComposition, in one native host
  /// whose region keeps only the papers. Wallpaper papers lie under the icons and desktop papers always take input, so
  /// the papers taking clicks does not block anything that clicks should reach.
  /// </param>
  public DesktopSurface(double left, double top, double width, double height, bool layered = true)
  {
    this.layered = layered;
    WebView = layered ? new WebView2CompositionControl { DefaultBackgroundColor = System.Drawing.Color.Transparent }
      : new WebView2 { DefaultBackgroundColor = System.Drawing.Color.White };
    if (!double.IsFinite(left) || !double.IsFinite(top) || !double.IsFinite(width) || !double.IsFinite(height)
      || Math.Abs(left) > 1_000_000 || Math.Abs(top) > 1_000_000
      || width is <= 0 or > 32768 || height is <= 0 or > 32768) throw new ArgumentException("Invalid scene bounds.");
    InputWindow = Create(left, top, width, height, layered); InputWindow.Content = WebView;
    if (layered)
    {
      var element = (UIElement)WebView;
      // DOM pointer capture cannot keep WPF mouse events arriving outside a lagging native paper region.
      element.AddHandler(Mouse.MouseDownEvent, new MouseButtonEventHandler((_, e) =>
      {
        if (shown && !inputSuspended && e.ChangedButton == MouseButton.Left) dragCaptured = element.CaptureMouse();
      }), handledEventsToo: true);
      element.AddHandler(Mouse.MouseUpEvent, new MouseButtonEventHandler((_, e) =>
      {
        if (e.ChangedButton == MouseButton.Left) ReleaseDragCapture();
      }), handledEventsToo: true);
      element.LostMouseCapture += (_, _) =>
      {
        if (!dragCaptured) return;
        dragCaptured = false; if (!disposed) PointerCaptureLost?.Invoke();
      };
    }
    VisualWindow = Create(left, top, width, height, layered);
    VisualWindow.Content = !layered ? null : new System.Windows.Shapes.Rectangle { IsHitTestVisible = false,
      Fill = new VisualBrush((Visual)WebView) { Stretch = Stretch.None, AlignmentX = AlignmentX.Left, AlignmentY = AlignmentY.Top } };
    InputWindow.SourceInitialized += (_, _) =>
    {
      if (!layered) RenderInSoftware(InputHandle);
      SetStyle(InputHandle, transparent: false);
      SetRegion([]); // No full-screen input interval, including first navigation.
      HwndSource.FromHwnd(InputHandle).AddHook(HandleInputMessage);
    };
    VisualWindow.SourceInitialized += (_, _) =>
    {
      if (!layered) RenderInSoftware(VisualHandle);
      SetStyle(VisualHandle, transparent: true); SetRegion(shown ? rectangles : []);
    };
    InputWindow.Closing += RequestClose; VisualWindow.Closing += RequestClose;
    InputWindow.LocationChanged += (_, _) => AlignVisual();
    InputWindow.SizeChanged += (_, _) => { AlignVisual(); if (shown) SetRegion(Current()); };
  }

  /// <summary>
  /// ADR-049: what WPF draws in an attached scene never reaches the screen (see the constructor), yet each of its two
  /// windows kept a Direct3D render target inside Explorer's desktop window. WPF has one render thread per process; it
  /// failed during display changes while these windows were attached, and every window of the process went with it.
  /// In software they hold no Direct3D state. The browser still draws the papers through its own GPU process.
  /// </summary>
  private static void RenderInSoftware(IntPtr handle) => HwndSource.FromHwnd(handle).CompositionTarget.RenderMode = RenderMode.SoftwareOnly;

  private void RequestClose(object? sender, System.ComponentModel.CancelEventArgs e)
  {
    if (disposed) return; e.Cancel = true;
    if (closePending) return; closePending = true;
    // A consumer may synchronously Dispose after flushing. WPF cannot Close again inside Closing.
    InputWindow.Dispatcher.BeginInvoke(new Action(() =>
    {
      closePending = false; if (disposed) return;
      if (CloseRequested is { } request) request(); else Hide();
    }));
  }

  private static Window Create(double left, double top, double width, double height, bool layered) => new()
  {
    Title = HostText.Get("desktop.windowTitle"), Left = left, Top = top, Width = width, Height = height,
    WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, AllowsTransparency = layered,
    // Empty browser pixels must not expose a white WPF background during paper-region transitions.
    Background = Brushes.Transparent, ShowActivated = false, ShowInTaskbar = false,
    WindowStartupLocation = WindowStartupLocation.Manual, UseLayoutRounding = true,
  };

  /// <summary>
  /// Places the scene and creates its browser; the scene ends hidden until it has papers. A windowed WebView created
  /// while its window is hidden stays black on Explorer's desktop once shown (reproduced under a host without a
  /// redirection surface), so an attached scene stays shown until the WebView exists. Its region is still empty then,
  /// so it shows and takes nothing.
  /// </summary>
  public async Task Start(bool topmost, PhysicalBounds bounds, CoreWebView2Environment environment)
  {
    Show(topmost); SetPhysicalBounds(bounds);
    if (layered) Hide();
    try { await WebView.EnsureCoreWebView2Async(environment); }
    finally { if (!layered) Hide(); }
  }

  public void Show(bool topmost)
  {
    ObjectDisposedException.ThrowIf(disposed, this); InputWindow.Dispatcher.VerifyAccess();
    new WindowInteropHelper(InputWindow).EnsureHandle(); new WindowInteropHelper(VisualWindow).EnsureHandle();
    Attach(InputHandle); Attach(VisualHandle);
    floating = topmost; InputWindow.Show(); VisualWindow.Show(); shown = true;
    // WPF's Show may refresh native styles. Reassert the child style and client coordinates.
    if (!layered) { SetStyle(InputHandle, transparent: false); SetStyle(VisualHandle, transparent: true); }
    Attach(InputHandle); Attach(VisualHandle);
    if (physicalBounds is not null) SetPhysicalBounds(physicalBounds);
    AlignVisual(); SetRegion(Current()); Order();
  }

  public void SetShellParent(IntPtr parent)
  {
    ObjectDisposedException.ThrowIf(disposed, this); InputWindow.Dispatcher.VerifyAccess();
    if (parent != shellParent && shown) Hide();
    shellParent = parent;
  }

  private void Attach(IntPtr handle)
  {
    var current = GetAncestor(handle, 1); // GA_PARENT excludes an owner of a top-level window.
    if (shellParent != IntPtr.Zero && (!IsWindow(shellParent)
      || !AreDpiAwarenessContextsEqual(GetWindowDpiAwarenessContext(handle), GetWindowDpiAwarenessContext(shellParent))))
      throw new InvalidOperationException("The Explorer desktop host is gone or its DPI mode is incompatible.");
    var style = GetWindowLongPtrW(handle, -16).ToInt64();
    if (shellParent != IntPtr.Zero && current != shellParent
      && !SetWindowPos(handle, new IntPtr(-2), 0, 0, 0, 0, 0x13))
      throw new InvalidOperationException("Unable to clear floating desktop style.");
    var next = shellParent == IntPtr.Zero ? (style & ~0x40000000L) | 0x80000000L : (style & ~0x80000000L) | 0x40000000L;
    if (!layered) next |= 0x02000000L | 0x04000000L; // CLIPCHILDREN / CLIPSIBLINGS: never paint over browser or shell siblings.
    if (next != style)
    {
      SetLastError(0); var previous = SetWindowLongPtrW(handle, -16, new IntPtr(next));
      if (previous == IntPtr.Zero && Marshal.GetLastWin32Error() != 0) throw new InvalidOperationException("Unable to set desktop child style.");
    }
    if (shellParent != IntPtr.Zero ? current != shellParent : (style & 0x40000000L) != 0)
    {
      SetLastError(0); var previous = SetParent(handle, shellParent);
      if (previous == IntPtr.Zero && Marshal.GetLastWin32Error() != 0) throw new InvalidOperationException("Unable to attach desktop scene.");
    }
    if (next != style && !SetWindowPos(handle, IntPtr.Zero, 0, 0, 0, 0, 0x37))
      throw new InvalidOperationException("Unable to apply desktop child style.");
  }

  public void Hide()
  {
    InputWindow.Dispatcher.VerifyAccess(); if (disposed) return;
    ReleaseDragCapture();
    var wasShown = shown;
    shown = false; if (!NativeAlive) return;
    // Keep the old region while hiding so User32 can uncover its actual footprint, not an already empty one.
    InputWindow.Hide(); VisualWindow.Hide();
    if (wasShown) RepaintShellParent();
    SetRegion([]);
  }

  private void ReleaseDragCapture()
  {
    dragCaptured = false;
    if (ReferenceEquals(Mouse.Captured, WebView)) Mouse.Capture(null);
  }

  private void RepaintShellParent()
  {
    if (shellParent != IntPtr.Zero && IsWindow(shellParent))
      _ = RedrawWindow(shellParent, IntPtr.Zero, IntPtr.Zero, 0x0001 | 0x0004 | 0x0080);
  }

  public void SetPhysicalBounds(PhysicalBounds bounds)
  {
    ObjectDisposedException.ThrowIf(disposed, this); InputWindow.Dispatcher.VerifyAccess();
    if (Math.Abs((long)bounds.X) > 1_000_000 || Math.Abs((long)bounds.Y) > 1_000_000
      || bounds.Width is <= 0 or > 32768 || bounds.Height is <= 0 or > 32768) throw new ArgumentException("Invalid physical bounds.");
    var origin = ToParent(bounds.X, bounds.Y);
    if (InputHandle == IntPtr.Zero) throw new InvalidOperationException("Unable to position scene.");
    AllowAnySize(InputWindow); AllowAnySize(VisualWindow);
    if (!SetWindowPos(InputHandle, IntPtr.Zero, origin.X, origin.Y, bounds.Width, bounds.Height, 0x14))
      throw new InvalidOperationException("Unable to position scene.");
    physicalBounds = bounds;
    InputWindow.UpdateLayout(); AlignVisual();
  }

  /// <summary>
  /// WPF lays a window's content out no larger than the maximum track size of the last WM_GETMINMAXINFO it received.
  /// Windows sends that message on a resize only to overlapped or thick-frame windows, and Attach makes scenes popup or
  /// child windows, so they keep the value from their creation. A scene created on a 1920x1080 display kept its 1940x1100
  /// content inside the 2560x1306 window it was resized to for a remote session. Sending the message again with the
  /// largest scene size lifts that limit before every resize.
  /// </summary>
  private static void AllowAnySize(Window window)
  {
    var handle = new WindowInteropHelper(window).Handle;
    if (handle == IntPtr.Zero) return;
    var limits = new MinMaxInfo { MaxSize = new() { X = 32768, Y = 32768 }, MaxTrackSize = new() { X = 32768, Y = 32768 } };
    _ = SendMessageW(handle, 0x0024, IntPtr.Zero, ref limits);
    window.InvalidateMeasure();
  }

  public void SetInput(IEnumerable<SceneHitRect> backToFront)
  {
    ObjectDisposedException.ThrowIf(disposed, this); InputWindow.Dispatcher.VerifyAccess();
    var next = backToFront.Take(20001).ToArray();
    if (next.Length > 20000 || next.Any(r => !double.IsFinite(r.X) || !double.IsFinite(r.Y)
      || !double.IsFinite(r.Width) || !double.IsFinite(r.Height) || r.Width <= 0 || r.Height <= 0
      || Math.Abs(r.X) > 1_000_000 || Math.Abs(r.Y) > 1_000_000 || r.Width > 32768 || r.Height > 32768))
      throw new ArgumentException("Invalid scene input rectangles.");
    // Build/validate before replacing the previous policy. SetWindowRgn owns only successful regions.
    if (InputHandle != IntPtr.Zero) SetRegion(shown ? next : []);
    // A shown attached scene that drops a paper uncovers it for Explorer to draw again, as hiding does.
    var uncovered = !layered && shown && rectangles.Except(next).Any();
    rectangles = next; inputSuspended = false;
    if (uncovered) RepaintShellParent();
  }

  public void SuspendInput()
  {
    if (disposed) return; InputWindow.Dispatcher.VerifyAccess(); inputSuspended = true;
    ReleaseDragCapture();
    if (NativeAlive) SetRegion(Current());
  }

  // While input is suspended no paper takes input. An attached scene shows and takes input in one window, so its papers stay.
  private SceneHitRect[] Current() => inputSuspended && layered ? [] : rectangles;

  private void SetRegion(SceneHitRect[] next)
  {
    RegionPair? result = null; var mirror = IntPtr.Zero;
    try
    {
      var scale = GetDpiForWindow(InputHandle) / 96d;
      if (scale <= 0) throw new InvalidOperationException("No scene DPI.");
      // Balanced paint composition avoids repeatedly unioning an increasingly complex GDI region.
      result = BuildRegion(next, 0, next.Length, scale);
      if (VisualHandle != IntPtr.Zero)
      {
        // The visual window mirrors everything the input window does not show; an attached scene has no mirror.
        mirror = layered ? NewRegion(0, 0, (int)Math.Ceiling(InputWindow.ActualWidth * scale), (int)Math.Ceiling(InputWindow.ActualHeight * scale))
          : NewRegion(0, 0, 0, 0);
        if (layered) Combine(mirror, mirror, result.Input, 4);
      }
      // An attached scene's single window shows every paper; a top-level scene's input window keeps the interactive ones.
      if (SetWindowRgn(InputHandle, layered ? result.Input : result.Covered, shown) == 0) throw new InvalidOperationException("Unable to install scene input region.");
      if (layered) result.Input = IntPtr.Zero; else result.Covered = IntPtr.Zero;
      // Disjoint display regions: translucent pixels are drawn exactly once, including paper edges.
      if (mirror != IntPtr.Zero)
      {
        if (SetWindowRgn(VisualHandle, mirror, shown) == 0) throw new InvalidOperationException("Unable to install scene display region.");
        mirror = IntPtr.Zero;
      }
    }
    catch { InputWindow.Hide(); VisualWindow.Hide(); shown = false; throw; }
    finally { result?.Dispose(); if (mirror != IntPtr.Zero) DeleteObject(mirror); }
  }

  // The `.card` border-radius in src/desktop/scene.css. An attached scene cannot show transparent pixels, so its region
  // gives each paper the rounded corners the page draws.
  private const double PaperRadius = 3;

  private RegionPair BuildRegion(SceneHitRect[] next, int start, int count, double scale)
  {
    if (count <= 1)
    {
      var rect = count == 0 ? new SceneHitRect(0, 0, 0, 0, false) : next[start];
      var left = Math.Max(0, rect.X); var top = Math.Max(0, rect.Y);
      var right = Math.Min(InputWindow.ActualWidth, rect.X + rect.Width);
      var bottom = Math.Min(InputWindow.ActualHeight, rect.Y + rect.Height);
      var covered = right <= left || bottom <= top ? NewRegion(0, 0, 0, 0)
        : layered ? NewRegion((int)Math.Floor(left * scale), (int)Math.Floor(top * scale), (int)Math.Ceiling(right * scale), (int)Math.Ceiling(bottom * scale))
        : NewRoundRegion((int)Math.Floor(rect.X * scale), (int)Math.Floor(rect.Y * scale), (int)Math.Ceiling((rect.X + rect.Width) * scale),
            (int)Math.Ceiling((rect.Y + rect.Height) * scale), (int)Math.Round(PaperRadius * 2 * scale));
      try
      {
        var result = new RegionPair(covered, NewRegion(0, 0, 0, 0));
        try { if (rect.Interactive) Combine(result.Input, covered, IntPtr.Zero, 5); return result; }
        catch { result.Dispose(); covered = IntPtr.Zero; throw; }
      }
      catch { if (covered != IntPtr.Zero) DeleteObject(covered); throw; }
    }
    var half = count / 2; var back = BuildRegion(next, start, half, scale);
    try
    {
      using var front = BuildRegion(next, start + half, count - half, scale);
      Combine(back.Input, back.Input, front.Covered, 4);
      Combine(back.Input, back.Input, front.Input, 2);
      Combine(back.Covered, back.Covered, front.Covered, 2);
      return back;
    }
    catch { back.Dispose(); throw; }
  }

  private sealed class RegionPair(IntPtr covered, IntPtr input) : IDisposable
  {
    public IntPtr Covered = covered, Input = input;
    public void Dispose() { if (Covered != IntPtr.Zero) DeleteObject(Covered); if (Input != IntPtr.Zero) DeleteObject(Input); Covered = Input = IntPtr.Zero; }
  }
  private static IntPtr NewRegion(int left, int top, int right, int bottom)
  {
    var result = CreateRectRgn(left, top, right, bottom);
    return result != IntPtr.Zero ? result : throw new InvalidOperationException("Unable to allocate scene region.");
  }
  // GDI rounded regions stop one pixel short of their right and bottom edges; extend them to match the paper.
  private static IntPtr NewRoundRegion(int left, int top, int right, int bottom, int diameter)
  {
    var result = CreateRoundRectRgn(left, top, right + 1, bottom + 1, diameter, diameter);
    return result != IntPtr.Zero ? result : throw new InvalidOperationException("Unable to allocate scene region.");
  }
  private static void Combine(IntPtr target, IntPtr first, IntPtr second, int mode)
  {
    if (CombineRgn(target, first, second, mode) == 0) throw new InvalidOperationException("Unable to combine scene regions.");
  }

  private void AlignVisual()
  {
    if (!shown || InputHandle == IntPtr.Zero || VisualHandle == IntPtr.Zero) return;
    if (!GetWindowRect(InputHandle, out var bounds)) throw new InvalidOperationException("Unable to read scene bounds.");
    var origin = ToParent(bounds.Left, bounds.Top);
    if (!SetWindowPos(VisualHandle, IntPtr.Zero, origin.X, origin.Y, bounds.Right - bounds.Left,
        bounds.Bottom - bounds.Top, 0x14)) throw new InvalidOperationException("Unable to align scene surfaces.");
  }

  private NativePoint ToParent(int x, int y)
  {
    var point = new NativePoint { X = x, Y = y };
    if (shellParent != IntPtr.Zero && !ScreenToClient(shellParent, ref point))
      throw new InvalidOperationException("Unable to map desktop coordinates.");
    return point;
  }

  private void Order()
  {
    if (!shown) return;
    ordering = true;
    try
    {
      if (floating)
      {
        // HWND_TOP alone does not guarantee placement above a separate foreground process.
        if (!SetWindowPos(InputHandle, new IntPtr(-1), 0, 0, 0, 0, 0x13)
          || !SetWindowPos(VisualHandle, new IntPtr(-1), 0, 0, 0, 0, 0x13)) throw new InvalidOperationException("Unable to float scene.");
      }
      else if (shellParent != IntPtr.Zero)
      {
        if (!SetWindowPos(InputHandle, IntPtr.Zero, 0, 0, 0, 0, 0x13)
          || !SetWindowPos(VisualHandle, IntPtr.Zero, 0, 0, 0, 0, 0x13)
          || !SetWindowPos(InputHandle, VisualHandle, 0, 0, 0, 0, 0x13)) throw new InvalidOperationException("Unable to order desktop children.");
      }
      else
      {
        if (!SetWindowPos(InputHandle, new IntPtr(1), 0, 0, 0, 0, 0x13)
          || !SetWindowPos(VisualHandle, new IntPtr(1), 0, 0, 0, 0, 0x13)
          || !SetWindowPos(InputHandle, VisualHandle, 0, 0, 0, 0, 0x13)) throw new InvalidOperationException("Unable to lower scene.");
      }
    }
    finally { ordering = false; }
  }

  private IntPtr HandleInputMessage(IntPtr handle, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
  {
    if (message == 0x0046 && !layered && lParam != IntPtr.Zero) // Includes SetWindowRgn's implicit position change.
    {
      var position = Marshal.PtrToStructure<WindowPosition>(lParam);
      position.Flags |= 0x0100; // SWP_NOCOPYBITS: stale white WPF pixels must not survive a paper-region transition.
      Marshal.StructureToPtr(position, lParam, false);
    }
    if (message == 0x02E0) // WPF processes the suggested bounds; input waits for a matching topology/frame.
    {
      SuspendInput();
      InputWindow.Dispatcher.BeginInvoke(new Action(() =>
      {
        if (disposed) return;
        if (DpiChanged is { } changed) changed();
        else if (shown) { inputSuspended = false; AlignVisual(); SetRegion(Current()); }
      }));
    }
    if (message == 0x0047 && shown && !floating && !ordering) // WM_WINDOWPOSCHANGED: activating a selection must not float resident cards.
    {
      var position = Marshal.PtrToStructure<WindowPosition>(lParam);
      if ((position.Flags & 0x4) == 0 && position.After != VisualHandle)
        InputWindow.Dispatcher.BeginInvoke(new Action(() => { if (shown && !floating && !disposed) Order(); }));
    }
    return IntPtr.Zero;
  }

  /// <summary>
  /// The composition WebView renders through a browser-owned top-level popup that WebView2 keeps visible, fully
  /// transparent and as large as the scene, just above Explorer's desktop. The popup is not click-through, so with
  /// the scene shown it swallowed clicks on desktop icons wherever no application covered them. Input reaches the
  /// page through InputWindow, never through the popup, so the popup only needs to let clicks pass.
  /// </summary>
  public void PassBrowserClicksThrough()
  {
    if (disposed || WebView.CoreWebView2 is not { } core) return;
    var browser = (uint)core.BrowserProcessId; var title = InputWindow.Title;
    var name = new StringBuilder(64);
    EnumWindows((window, _) =>
    {
      GetWindowThreadProcessId(window, out var process);
      if (process != browser) return true;
      name.Clear(); GetClassNameW(window, name, name.Capacity); if (name.ToString() != "Chrome_WidgetWin_1") return true;
      name.Clear(); GetWindowTextW(window, name, name.Capacity); if (name.ToString() != title) return true;
      var style = GetWindowLongPtrW(window, -20).ToInt64();
      // Only the layered, non-activating render popup; dropdowns and other browser windows keep their input.
      if ((style & 0x08080000L) == 0x08080000L && (style & 0x28L) == 0) SetWindowLongPtrW(window, -20, new IntPtr(style | 0x20));
      return true;
    }, IntPtr.Zero);
  }

  private void SetStyle(IntPtr handle, bool transparent)
  {
    var previousStyle = GetWindowLongPtrW(handle, -20).ToInt64();
    var style = previousStyle | 0x80; // TOOLWINDOW, absent from Alt-Tab.
    if (transparent) style |= 0x20 | 0x08000000; // Layered WS_EX_TRANSPARENT works across processes; never activates.
    if (style == previousStyle) return;
    SetLastError(0); var previous = SetWindowLongPtrW(handle, -20, new IntPtr(style));
    var error = Marshal.GetLastWin32Error();
    if (previous == IntPtr.Zero && error != 0)
      throw new System.ComponentModel.Win32Exception(error, $"Unable to set scene policy (HWND={handle:X}, before={previousStyle:X}, requested={style:X}, actual={GetWindowLongPtrW(handle, -20).ToInt64():X}).");
    if (!layered && !SetWindowPos(handle, IntPtr.Zero, 0, 0, 0, 0, 0x0137))
      throw new InvalidOperationException("Unable to apply scene composition policy.");
  }

  public void Dispose()
  {
    if (disposed) return; InputWindow.Dispatcher.VerifyAccess(); Hide(); disposed = true;
    VisualWindow.Content = null; VisualWindow.Close(); InputWindow.Close(); ((IDisposable)WebView).Dispose();
    RepaintShellParent();
  }

  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct NativePoint { public int X, Y; }
  [StructLayout(LayoutKind.Sequential)] private struct WindowPosition { public IntPtr Window, After; public int X, Y, Width, Height; public uint Flags; }
  [StructLayout(LayoutKind.Sequential)] private struct MinMaxInfo { public NativePoint Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize; }
  [DllImport("user32.dll")] private static extern IntPtr SendMessageW(IntPtr window, uint message, IntPtr wParam, ref MinMaxInfo lParam);
  private delegate bool EnumCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassNameW(IntPtr window, StringBuilder name, int capacity);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextW(IntPtr window, StringBuilder text, int capacity);
  [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRoundRectRgn(int left, int top, int right, int bottom, int width, int height);
  [DllImport("gdi32.dll")] private static extern int CombineRgn(IntPtr target, IntPtr first, IntPtr second, int mode);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
  [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowLongPtrW(IntPtr window, int index, IntPtr value);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr window, IntPtr parent);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] private static extern bool ScreenToClient(IntPtr window, ref NativePoint point);
  [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool RedrawWindow(IntPtr window, IntPtr rect, IntPtr region, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr window);
  [DllImport("user32.dll")] private static extern bool AreDpiAwarenessContextsEqual(IntPtr first, IntPtr second);
}
