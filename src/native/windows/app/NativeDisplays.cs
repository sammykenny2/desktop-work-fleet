using System.Runtime.InteropServices;

namespace WorkFleet.Windows;

public sealed record PhysicalBounds(int X, int Y, int Width, int Height);
public sealed record DisplayInfo(string Id, bool Primary, PhysicalBounds Bounds, PhysicalBounds WorkArea, uint Dpi);
/// <summary>ADR-046 inputs: the lid state (null without one) and whether a built-in panel and any other display are on.</summary>
public sealed record BuiltInDisplays(bool? LidClosed, bool BuiltInOn, bool OtherOn);

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
  /// <summary>One host.log line per inventory (ADR-045): device, primary, physical bounds and DPI; no monitor names or work areas.</summary>
  public static string Describe(IReadOnlyList<DisplayInfo> values) => $"{values.Count} display(s): " + string.Join("; ", values.Select(d =>
    FormattableString.Invariant($"{d.Id}{(d.Primary ? " primary" : "")} {d.Bounds.X},{d.Bounds.Y} {d.Bounds.Width}x{d.Bounds.Height} dpi={d.Dpi}")));
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
  /// <summary>Active display targets by connection: a laptop's own panel (internal, LVDS, embedded DisplayPort or UDI) or anything else.</summary>
  public static BuiltInDisplays ReadBuiltIn(bool? lidClosed)
  {
    for (var attempt = 0; attempt < 3; attempt++)
    {
      var status = GetDisplayConfigBufferSizes(2, out var pathCount, out var modeCount); // QDC_ONLY_ACTIVE_PATHS
      if (status != 0) throw new InvalidOperationException($"Unable to size the display configuration ({status}).");
      var paths = new PathInfo[pathCount]; var modes = new ModeInfo[modeCount];
      status = QueryDisplayConfig(2, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero);
      if (status == 122) continue; // ERROR_INSUFFICIENT_BUFFER: the topology changed between the two calls.
      if (status != 0) throw new InvalidOperationException($"Unable to read the display configuration ({status}).");
      // A cloned target has several paths; count each target once.
      var targets = paths.Take((int)pathCount).Where(p => (p.Flags & 1) != 0)
        .GroupBy(p => (p.TargetAdapterLow, p.TargetAdapterHigh, p.TargetId)).Select(g => g.First().OutputTechnology).ToArray();
      static bool BuiltIn(uint technology) => technology is 0x80000000 or 6 or 11 or 13;
      return new(lidClosed, targets.Any(BuiltIn), targets.Any(t => !BuiltIn(t)));
    }
    throw new InvalidOperationException("The display configuration kept changing.");
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
  // DISPLAYCONFIG_PATH_INFO (72 bytes): source info, then target adapter LUID, id, mode index, output technology, ...
  [StructLayout(LayoutKind.Explicit, Size = 72)] private struct PathInfo
  {
    [FieldOffset(20)] public uint TargetAdapterLow; [FieldOffset(24)] public int TargetAdapterHigh; [FieldOffset(28)] public uint TargetId;
    [FieldOffset(36)] public uint OutputTechnology; [FieldOffset(68)] public uint Flags;
  }
  [StructLayout(LayoutKind.Sequential, Size = 64)] private struct ModeInfo { public uint InfoType; }
  [DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint pathCount, out uint modeCount);
  [DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint pathCount, [Out] PathInfo[] paths,
    ref uint modeCount, [Out] ModeInfo[] modes, IntPtr currentTopology);
  [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorCallback callback, IntPtr data);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfoW(IntPtr monitor, ref MonitorInfo info);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr CreateWindowExW(uint extended, string className, string title, uint style,
    int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
  [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
}
