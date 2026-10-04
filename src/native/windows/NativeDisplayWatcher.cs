using System.Windows.Interop;
using System.Windows.Threading;

namespace WorkFleet.Windows;

/// <summary>Owns a broadcast recipient; messages are hints to re-enumerate, never a monitor inventory.</summary>
public sealed class NativeDisplayWatcher : IDisposable
{
  private readonly HwndSource source;
  private readonly DispatcherTimer timer;
  private readonly Func<IReadOnlyList<DisplayInfo>> read;
  private readonly Action invalidated;
  private readonly Action<IReadOnlyList<DisplayInfo>> changed;
  private readonly Action failed;
  private bool disposed, pending, suspended;
  public NativeDisplayWatcher(Func<IReadOnlyList<DisplayInfo>> read, Action invalidated,
    Action<IReadOnlyList<DisplayInfo>> changed, Action failed)
  {
    this.read = read; this.invalidated = invalidated; this.changed = changed; this.failed = failed;
    source = new HwndSource(new HwndSourceParameters("Work Fleet display notifications")
      { Width = 0, Height = 0, WindowStyle = unchecked((int)0x80000000), ExtendedWindowStyle = 0x08000080 });
    source.AddHook(Message);
    timer = new DispatcherTimer(DispatcherPriority.Background) { Interval = TimeSpan.FromMilliseconds(350) };
    timer.Tick += Tick;
  }
  public void Refresh()
  {
    if (disposed) return;
    if (!pending) { pending = true; invalidated(); }
    timer.Stop(); timer.Interval = TimeSpan.FromMilliseconds(350); if (!suspended) timer.Start();
  }
  private void Tick(object? sender, EventArgs args)
  {
    timer.Stop(); if (disposed || suspended) return;
    try { var value = NativeDisplays.Validate(read()); changed(value); pending = false; }
    catch { failed(); timer.Interval = TimeSpan.FromSeconds(3); timer.Start(); }
  }
  private IntPtr Message(IntPtr window, int message, IntPtr wParam, IntPtr lParam, ref bool handled)
  {
    if (message is 0x007E or 0x001A) Refresh(); // DISPLAYCHANGE / SETTINGCHANGE, including taskbar work area.
    if (message == 0x0218) // POWERBROADCAST
    {
      if (wParam.ToInt64() == 4) { suspended = true; Refresh(); }
      else if (wParam.ToInt64() is 6 or 7 or 18) { suspended = false; Refresh(); }
    }
    return IntPtr.Zero;
  }
  public void Dispose()
  {
    if (disposed) return; disposed = true; timer.Stop(); timer.Tick -= Tick; source.RemoveHook(Message); source.Dispose();
  }
}
