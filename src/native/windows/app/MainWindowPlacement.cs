using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Threading;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>
/// ADR-043 main window size and position in physical screen pixels. Win32 reports the real state (IsZoomed/IsIconic),
/// so a minimize, including the adjust overlay stepping aside, never overwrites the saved bounds or maximized flag.
/// </summary>
internal sealed class MainWindowPlacement
{
  private const int DefaultWidth = 1180, DefaultHeight = 800;
  private readonly Window window;
  private readonly string directory;
  private readonly DispatcherTimer timer;
  private SavedPlacement? current;
  private bool tracking, dirty;
  /// <summary>A maximized window is created at its restore bounds and maximized on its first show, so a hidden start stays hidden.</summary>
  public bool PendingMaximize { get; set; }

  public MainWindowPlacement(Window window, string directory)
  {
    this.window = window; this.directory = directory; current = WindowPlacement.Read(directory);
    timer = new DispatcherTimer(DispatcherPriority.Background, window.Dispatcher) { Interval = TimeSpan.FromMilliseconds(500) };
    timer.Tick += (_, _) => Flush();
    window.LocationChanged += (_, _) => Observe(); window.SizeChanged += (_, _) => Observe(); window.StateChanged += (_, _) => Observe();
  }
  private IntPtr Handle => new WindowInteropHelper(window).Handle;
  /// <summary>Moves the window to its saved, validated bounds. Call while it is hidden or before its first show.</summary>
  public void Apply()
  {
    var resolved = Resolve(current); if (resolved is null) return;
    Move(resolved); PendingMaximize = resolved.Maximized; current = resolved;
  }
  /// <summary>Starts recording changes once the window shows the bounds that Apply chose.</summary>
  public void Track() => tracking = true;
  /// <summary>Before a hidden window is shown again: a display may have gone away while it waited in the tray.</summary>
  public void BeforeShow()
  {
    if (window.IsVisible || Handle == IntPtr.Zero || IsZoomed(Handle) || IsIconic(Handle) || !GetWindowRect(Handle, out var rect)) return;
    var bounds = new SavedPlacement(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top, false);
    var resolved = Resolve(bounds); if (resolved is not null && resolved != bounds) Move(resolved);
  }
  private static SavedPlacement? Resolve(SavedPlacement? saved)
  {
    IReadOnlyList<DisplayInfo> displays;
    try { displays = NativeDisplays.Read(); } catch (InvalidOperationException) { return null; }
    var areas = displays.Select(display => new PlacementArea(display.WorkArea.X, display.WorkArea.Y, display.WorkArea.Width, display.WorkArea.Height)).ToArray();
    var dpi = (int)displays[0].Dpi;
    return WindowPlacement.Resolve(saved, areas, DefaultWidth * dpi / 96, DefaultHeight * dpi / 96);
  }
  private void Move(SavedPlacement value)
  {
    var was = tracking; tracking = false;
    try
    {
      // Moving onto a display with another DPI rescales the window once; the second call restores the exact size.
      for (var i = 0; i < 2; i++) _ = SetWindowPos(Handle, IntPtr.Zero, value.X!.Value, value.Y!.Value, value.Width, value.Height, 0x0004 | 0x0010 | 0x0200);
    }
    finally { tracking = was; }
  }
  private void Observe()
  {
    if (!tracking || !window.IsVisible || Handle == IntPtr.Zero || IsIconic(Handle)) return;
    if (IsZoomed(Handle))
    {
      if (current is { Maximized: false }) { current = current with { Maximized = true }; Schedule(); }
      return;
    }
    if (!GetWindowRect(Handle, out var rect)) return;
    var next = new SavedPlacement(rect.Left, rect.Top, rect.Right - rect.Left, rect.Bottom - rect.Top, false);
    if (next != current) { current = next; Schedule(); }
  }
  private void Schedule() { dirty = true; timer.Stop(); timer.Start(); }
  /// <summary>Writes pending bounds now: before hiding to the tray, quitting, signing out and installing an update.</summary>
  public void Flush()
  {
    timer.Stop();
    if (!dirty || current is null) return;
    try { WindowPlacement.Write(directory, current); dirty = false; }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { /* A missing file only loses the last position. */ }
  }
  /// <summary>Forgets the saved bounds and shows the default size, centred on the primary display.</summary>
  public void Reset()
  {
    timer.Stop(); dirty = false; current = null; PendingMaximize = false;
    try { WindowPlacement.Remove(directory); }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { throw new HostError("placement-reset", "Couldn't reset the main window position. Try again later."); }
    var was = tracking; tracking = false;
    try { if (window.WindowState != WindowState.Normal) window.WindowState = WindowState.Normal; Apply(); }
    finally { tracking = was; }
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect rect);
  [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
}
