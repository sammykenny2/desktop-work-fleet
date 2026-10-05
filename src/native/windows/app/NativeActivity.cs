using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Threading;
using System.Windows.Interop;

namespace WorkFleet.Windows;

/// <summary>Release OS registrations synchronously on activation; the focused document handles local keys.</summary>
public sealed class NativeActivity : IDisposable
{
  private readonly NativeShortcuts shortcuts;
  private readonly HashSet<Window> windows = [];
  private readonly DispatcherTimer timer;
  private bool blocked = true, disposed;
  public NativeActivity(NativeShortcuts shortcuts)
  {
    this.shortcuts = shortcuts; shortcuts.Suspend(true);
    timer = new DispatcherTimer(TimeSpan.FromMilliseconds(250), DispatcherPriority.Background, (_, _) => Refresh(), Application.Current.Dispatcher);
  }
  public void Watch(Window window)
  {
    if (!windows.Add(window)) return;
    window.Activated += Activated; window.Deactivated += Deactivated; window.Closed += Closed; Refresh();
  }
  private void Activated(object? sender, EventArgs e)
  {
    shortcuts.Suspend(true);
    // WPF can report thread activation even when Windows refuses foreground permission.
    Application.Current.Dispatcher.BeginInvoke(new Action(Refresh), DispatcherPriority.Background);
  }
  private void Deactivated(object? sender, EventArgs e) => Application.Current.Dispatcher.BeginInvoke(new Action(Refresh), DispatcherPriority.Background);
  private void Closed(object? sender, EventArgs e) { if (sender is Window window) Unwatch(window); Refresh(); }
  private void Unwatch(Window window)
  {
    windows.Remove(window); window.Activated -= Activated; window.Deactivated -= Deactivated; window.Closed -= Closed;
  }
  public void Block(bool value) { blocked = value; Refresh(); }
  public void Refresh()
  {
    if (disposed) return;
    var foreground = GetForegroundWindow(); _ = GetWindowThreadProcessId(foreground, out var process);
    shortcuts.Suspend(blocked || process == (uint)Environment.ProcessId);
  }
  public void Dispose()
  {
    if (disposed) return; disposed = true; timer.Stop(); foreach (var window in windows.ToArray()) Unwatch(window);
  }
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}

/// <summary>Async UI may use this intent only while the user has neither switched windows nor supplied later input.</summary>
public sealed class ForegroundIntent
{
  private readonly IntPtr foreground = GetForegroundWindow();
  private readonly uint? input = LastInput();
  private readonly long created = Environment.TickCount64;
  public string Id { get; } = Guid.NewGuid().ToString();
  public static ForegroundIntent? ForWindow(Window window)
  {
    var value = new ForegroundIntent(); var handle = new WindowInteropHelper(window).Handle;
    return handle != IntPtr.Zero && value.foreground == handle ? value : null;
  }
  public bool Current => input is not null && Environment.TickCount64 - created < 5000 && GetForegroundWindow() == foreground && LastInput() == input;
  private static uint? LastInput() { var value = new LastInputInfo { Size = (uint)Marshal.SizeOf<LastInputInfo>() }; return GetLastInputInfo(ref value) ? value.Time : null; }
  [StructLayout(LayoutKind.Sequential)] private struct LastInputInfo { public uint Size, Time; }
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LastInputInfo value);
}
