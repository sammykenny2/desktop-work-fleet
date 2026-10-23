using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using WorkFleet.Windows;

internal static class NativeScreenCapture
{
  // Capture the composed screen, not a browser preview: old pixels outside the new paper are the regression.
  public static void Save(PhysicalBounds bounds, string path, IntPtr window = default)
  {
    var pixels = Read(bounds, window);
    var encoder = new PngBitmapEncoder();
    encoder.Frames.Add(BitmapFrame.Create(BitmapSource.Create(bounds.Width, bounds.Height, 96, 96, PixelFormats.Bgr32, null, pixels, bounds.Width * 4)));
    using var file = File.Create(path); encoder.Save(file);
  }
  /// <summary>One window as Windows draws it, frame included, even where other windows cover it.</summary>
  public static void SaveWindow(IntPtr window, string path)
  {
    if (!GetWindowRect(window, out var r)) throw new Exception("No window to capture.");
    Save(new PhysicalBounds(0, 0, r.Right - r.Left, r.Bottom - r.Top), path, window);
  }
  public static byte[] Read(PhysicalBounds bounds, IntPtr window = default)
  {
    var screen = GetDC(IntPtr.Zero);
    var memory = CreateCompatibleDC(screen); var bitmap = CreateCompatibleBitmap(screen, bounds.Width, bounds.Height);
    var previous = IntPtr.Zero;
    try
    {
      if (screen == IntPtr.Zero || memory == IntPtr.Zero || bitmap == IntPtr.Zero) throw new Exception("Unable to allocate screen capture.");
      previous = SelectObject(memory, bitmap);
      if (window != IntPtr.Zero ? !PrintWindow(window, memory, 2) : !BitBlt(memory, 0, 0, bounds.Width, bounds.Height, screen, bounds.X, bounds.Y, 0x40CC0020))
        throw new Exception("Unable to capture the test footprint.");
      SelectObject(memory, previous); previous = IntPtr.Zero;
      var pixels = new byte[checked(bounds.Width * bounds.Height * 4)];
      var info = new BitmapInfo { Size = 40, Width = bounds.Width, Height = -bounds.Height, Planes = 1, BitCount = 32 };
      if (GetDIBits(memory, bitmap, 0, (uint)bounds.Height, pixels, ref info, 0) != bounds.Height)
        throw new Exception("Unable to read screen capture pixels.");
      return pixels;
    }
    finally
    {
      if (previous != IntPtr.Zero) SelectObject(memory, previous);
      if (bitmap != IntPtr.Zero) DeleteObject(bitmap);
      if (memory != IntPtr.Zero) DeleteDC(memory);
      if (screen != IntPtr.Zero) ReleaseDC(IntPtr.Zero, screen);
    }
  }

  [StructLayout(LayoutKind.Sequential)] private struct BitmapInfo
  {
    public uint Size;
    public int Width, Height;
    public ushort Planes, BitCount;
    public uint Compression, ImageSize;
    public int XPixelsPerMeter, YPixelsPerMeter;
    public uint ColorsUsed, ColorsImportant, Color;
  }
  [StructLayout(LayoutKind.Sequential)] private struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] private static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
  [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
  [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] private static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int width, int height);
  [DllImport("gdi32.dll")] private static extern IntPtr SelectObject(IntPtr dc, IntPtr item);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr item);
  [DllImport("gdi32.dll")] private static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] private static extern bool BitBlt(IntPtr target, int x, int y, int width, int height, IntPtr source, int sourceX, int sourceY, uint operation);
  [DllImport("gdi32.dll")] private static extern int GetDIBits(IntPtr dc, IntPtr bitmap, uint firstLine, uint lines, byte[] pixels, ref BitmapInfo info, uint usage);
}
