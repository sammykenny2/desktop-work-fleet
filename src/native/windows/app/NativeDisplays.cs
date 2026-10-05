using System.Runtime.InteropServices;

namespace WorkFleet.Windows;

public sealed record PhysicalBounds(int X, int Y, int Width, int Height);
public sealed record DisplayInfo(string Id, bool Primary, PhysicalBounds Bounds, PhysicalBounds WorkArea, uint Dpi);

/// <summary>Physical monitor inventory. Consumers explicitly map these pixels into their logical scene coordinate space.</summary>
public static class NativeDisplays
{
  public static IReadOnlyList<DisplayInfo> Validate(IReadOnlyList<DisplayInfo> values)
  {
    if (values.Count is < 1 or > 16 || values.Count(d => d.Primary) != 1
      || values.Select(d => d.Id).Distinct(StringComparer.Ordinal).Count() != values.Count)
      throw new InvalidOperationException("Invalid display inventory.");
    foreach (var value in values)
    {
      static bool Valid(PhysicalBounds r) => Math.Abs((long)r.X) <= 1_000_000 && Math.Abs((long)r.Y) <= 1_000_000
        && r.Width is > 0 and <= 32768 && r.Height is > 0 and <= 32768;
      if (string.IsNullOrEmpty(value.Id) || value.Id.Length > 128 || value.Dpi is < 48 or > 960
        || !Valid(value.Bounds) || !Valid(value.WorkArea) || value.WorkArea.X < value.Bounds.X || value.WorkArea.Y < value.Bounds.Y
        || (long)value.WorkArea.X + value.WorkArea.Width > (long)value.Bounds.X + value.Bounds.Width
        || (long)value.WorkArea.Y + value.WorkArea.Height > (long)value.Bounds.Y + value.Bounds.Height)
        throw new InvalidOperationException("Invalid display geometry.");
    }
    return values.OrderByDescending(d => d.Primary).ThenBy(d => d.Id, StringComparer.Ordinal).ToArray();
  }
  public static IReadOnlyList<DisplayInfo> Read()
  {
    var values = new List<DisplayInfo>(); Exception? failure = null;
    MonitorCallback callback = (IntPtr monitor, IntPtr dc, ref NativeRect rect, IntPtr data) =>
    {
      try
      {
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>(), Device = "" };
        if (!GetMonitorInfoW(monitor, ref info)) throw new InvalidOperationException("Unable to read display.");
        var bounds = Bounds(info.Monitor); var work = Bounds(info.Work);
        // A hidden owned HWND reports the actual per-monitor DPI without deprecated awareness-dependent APIs.
        var probe = CreateWindowExW(0x80 | 0x08000000, "STATIC", "", 0x80000000,
          bounds.X + bounds.Width / 2, bounds.Y + bounds.Height / 2, 1, 1, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (probe == IntPtr.Zero) throw new InvalidOperationException("Unable to query display DPI.");
        uint dpi;
        try { dpi = GetDpiForWindow(probe); }
        finally { DestroyWindow(probe); }
        if (dpi < 48 || dpi > 960) throw new InvalidOperationException("Invalid display DPI.");
        values.Add(new(info.Device, (info.Flags & 1) != 0, bounds, work, dpi));
        return true;
      }
      catch (Exception error) { failure = error; return false; }
    };
    var succeeded = EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, callback, IntPtr.Zero);
    if (failure is not null) throw failure;
    if (!succeeded || values.Count == 0) throw new InvalidOperationException("No usable displays.");
    return Validate(values);
  }
  private static PhysicalBounds Bounds(NativeRect r)
  {
    if (r.Right <= r.Left || r.Bottom <= r.Top) throw new InvalidOperationException("Invalid display bounds.");
    return new(r.Left, r.Top, checked(r.Right - r.Left), checked(r.Bottom - r.Top));
  }
  [StructLayout(LayoutKind.Sequential)] private struct NativeRect { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct MonitorInfo
  { public int Size; public NativeRect Monitor, Work; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device; }
  private delegate bool MonitorCallback(IntPtr monitor, IntPtr dc, ref NativeRect rect, IntPtr data);
  [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorCallback callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowExW(uint extended, string className, string title, uint style,
    int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
}
