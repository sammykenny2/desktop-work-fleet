using Microsoft.Web.WebView2.Wpf;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;

namespace WorkFleet.Windows;

public readonly record struct SceneHitRect(double X, double Y, double Width, double Height, bool Interactive);

/// <summary>One logical scene, one browser, two native surfaces. All methods run on the WPF dispatcher.</summary>
public sealed class DesktopSurface : IDisposable
{
  public WebView2CompositionControl WebView { get; } = new() { DefaultBackgroundColor = System.Drawing.Color.Transparent };
  public Window InputWindow { get; }
  public Window VisualWindow { get; }
  private bool disposed;
  private bool shown;
  private bool floating;
  private bool ordering;
  private bool closePending;
  public event Action? CloseRequested;
  private SceneHitRect[] rectangles = [];
  private IntPtr InputHandle => new WindowInteropHelper(InputWindow).Handle;
  private IntPtr VisualHandle => new WindowInteropHelper(VisualWindow).Handle;

  public DesktopSurface(double left, double top, double width, double height)
  {
    if (!double.IsFinite(left) || !double.IsFinite(top) || !double.IsFinite(width) || !double.IsFinite(height)
      || Math.Abs(left) > 1_000_000 || Math.Abs(top) > 1_000_000
      || width is <= 0 or > 32768 || height is <= 0 or > 32768) throw new ArgumentException("Invalid scene bounds.");
    InputWindow = Create(left, top, width, height); InputWindow.Content = WebView;
    VisualWindow = Create(left, top, width, height);
    VisualWindow.Content = new System.Windows.Shapes.Rectangle { IsHitTestVisible = false,
      Fill = new VisualBrush(WebView) { Stretch = Stretch.None, AlignmentX = AlignmentX.Left, AlignmentY = AlignmentY.Top } };
    InputWindow.SourceInitialized += (_, _) =>
    {
      SetStyle(InputHandle, transparent: false);
      SetRegion([]); // No full-screen input interval, including first navigation.
      HwndSource.FromHwnd(InputHandle).AddHook(HandleInputMessage);
    };
    VisualWindow.SourceInitialized += (_, _) => { SetStyle(VisualHandle, transparent: true); SetRegion(shown ? rectangles : []); };
    InputWindow.Closing += RequestClose; VisualWindow.Closing += RequestClose;
    InputWindow.LocationChanged += (_, _) => AlignVisual();
    InputWindow.SizeChanged += (_, _) => { AlignVisual(); if (shown) SetRegion(rectangles); };
  }

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

  private static Window Create(double left, double top, double width, double height) => new()
  {
    Title = "Work Fleet 桌面", Left = left, Top = top, Width = width, Height = height,
    WindowStyle = WindowStyle.None, ResizeMode = ResizeMode.NoResize, AllowsTransparency = true,
    Background = Brushes.Transparent, ShowActivated = false, ShowInTaskbar = false,
    WindowStartupLocation = WindowStartupLocation.Manual, UseLayoutRounding = true,
  };

  public void Show(bool topmost)
  {
    ObjectDisposedException.ThrowIf(disposed, this); InputWindow.Dispatcher.VerifyAccess();
    floating = topmost; InputWindow.Show(); VisualWindow.Show(); shown = true;
    AlignVisual(); SetRegion(rectangles); Order();
  }

  public void Hide()
  {
    InputWindow.Dispatcher.VerifyAccess(); if (disposed) return;
    shown = false; if (InputHandle != IntPtr.Zero) SetRegion([]);
    InputWindow.Hide(); VisualWindow.Hide();
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
    rectangles = next;
  }

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
        mirror = NewRegion(0, 0, (int)Math.Ceiling(InputWindow.ActualWidth * scale), (int)Math.Ceiling(InputWindow.ActualHeight * scale));
        Combine(mirror, mirror, result.Input, 4);
      }
      if (SetWindowRgn(InputHandle, result.Input, true) == 0) throw new InvalidOperationException("Unable to install scene input region.");
      result.Input = IntPtr.Zero;
      // Disjoint display regions: translucent pixels are drawn exactly once, including paper edges.
      if (mirror != IntPtr.Zero)
      {
        if (SetWindowRgn(VisualHandle, mirror, true) == 0) throw new InvalidOperationException("Unable to install scene display region.");
        mirror = IntPtr.Zero;
      }
    }
    catch { InputWindow.Hide(); VisualWindow.Hide(); shown = false; throw; }
    finally { result?.Dispose(); if (mirror != IntPtr.Zero) DeleteObject(mirror); }
  }

  private RegionPair BuildRegion(SceneHitRect[] next, int start, int count, double scale)
  {
    if (count <= 1)
    {
      var rect = count == 0 ? new SceneHitRect(0, 0, 0, 0, false) : next[start];
      var left = Math.Max(0, rect.X); var top = Math.Max(0, rect.Y);
      var right = Math.Min(InputWindow.ActualWidth, rect.X + rect.Width);
      var bottom = Math.Min(InputWindow.ActualHeight, rect.Y + rect.Height);
      var covered = right <= left || bottom <= top ? NewRegion(0, 0, 0, 0)
        : NewRegion((int)Math.Floor(left * scale), (int)Math.Floor(top * scale), (int)Math.Ceiling(right * scale), (int)Math.Ceiling(bottom * scale));
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
  private static void Combine(IntPtr target, IntPtr first, IntPtr second, int mode)
  {
    if (CombineRgn(target, first, second, mode) == 0) throw new InvalidOperationException("Unable to combine scene regions.");
  }

  private void AlignVisual()
  {
    if (!shown || InputHandle == IntPtr.Zero || VisualHandle == IntPtr.Zero) return;
    if (!GetWindowRect(InputHandle, out var bounds)
      || !SetWindowPos(VisualHandle, IntPtr.Zero, bounds.Left, bounds.Top, bounds.Right - bounds.Left,
        bounds.Bottom - bounds.Top, 0x14)) throw new InvalidOperationException("Unable to align scene surfaces.");
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
    if (message == 0x02E0) // WM_DPICHANGED: WPF applies suggested bounds before our queued rebuild.
      InputWindow.Dispatcher.BeginInvoke(new Action(() => { if (shown && !disposed) { AlignVisual(); SetRegion(rectangles); } }));
    if (message == 0x0047 && shown && !floating && !ordering) // WM_WINDOWPOSCHANGED: activating a selection must not float resident cards.
    {
      var position = Marshal.PtrToStructure<WindowPosition>(lParam);
      if ((position.Flags & 0x4) == 0 && position.After != VisualHandle)
        InputWindow.Dispatcher.BeginInvoke(new Action(() => { if (shown && !floating && !disposed) Order(); }));
    }
    return IntPtr.Zero;
  }

  private static void SetStyle(IntPtr handle, bool transparent)
  {
    var style = GetWindowLongPtrW(handle, -20).ToInt64() | 0x80; // TOOLWINDOW, absent from Alt-Tab.
    if (transparent) style |= 0x20 | 0x08000000; // Layered WS_EX_TRANSPARENT works across processes; never activates.
    SetLastError(0); var previous = SetWindowLongPtrW(handle, -20, new IntPtr(style));
    if (previous == IntPtr.Zero && Marshal.GetLastWin32Error() != 0) throw new InvalidOperationException("Unable to set scene policy.");
  }

  public void Dispose()
  {
    if (disposed) return; InputWindow.Dispatcher.VerifyAccess(); disposed = true; shown = false;
    VisualWindow.Content = null; VisualWindow.Close(); InputWindow.Close(); WebView.Dispose();
  }

  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] private struct WindowPosition { public IntPtr Window, After; public int X, Y, Width, Height; public uint Flags; }
  [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
  [DllImport("gdi32.dll")] private static extern int CombineRgn(IntPtr target, IntPtr first, IntPtr second, int mode);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
  [DllImport("user32.dll")] private static extern int SetWindowRgn(IntPtr window, IntPtr region, bool redraw);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);
  [DllImport("user32.dll")] private static extern IntPtr GetWindowLongPtrW(IntPtr window, int index);
  [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetWindowLongPtrW(IntPtr window, int index, IntPtr value);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
