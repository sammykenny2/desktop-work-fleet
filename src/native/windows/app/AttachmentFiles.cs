using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media.Imaging;
using WorkFleet.Windows.Core;

namespace WorkFleet.Windows;

/// <summary>Only decrypted attachment bytes reach this adapter; no renderer-provided path or command is accepted.</summary>
internal sealed class AttachmentFiles : IDisposable
{
  private readonly string root = Path.Combine(Path.GetTempPath(), "WorkFleet-attachments-" + Guid.NewGuid().ToString("N"));
  private readonly List<string> files = [];
  private readonly Dictionary<string, object> previews = [];
  private readonly object gate = new();
  private bool disposed;
  internal static string Filename(string name)
  {
    HostError.Require(!string.IsNullOrWhiteSpace(name) && name.Length <= 240, "invalid-attachment", "附件檔名無效。");
    var clean = new string(name.Select(character => Path.GetInvalidFileNameChars().Contains(character) || char.IsControl(character) ? '_' : character).ToArray()).Trim().TrimEnd(' ', '.');
    var stem = Path.GetFileNameWithoutExtension(clean);
    if (new[] { "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9" }.Contains(stem.ToUpperInvariant())) clean = "_" + clean;
    if (clean.Length > 120)
    {
      var suffix = Path.GetExtension(clean); if (suffix.Length > 32) suffix = "";
      clean = clean[..(120 - suffix.Length)] + suffix;
    }
    return clean is "" or "." or ".." ? "attachment.bin" : clean;
  }
  internal static bool CanOpen(string name) => !new[] { ".exe", ".com", ".bat", ".cmd", ".ps1", ".msi", ".msp", ".scr", ".lnk", ".url", ".desktop", ".sh", ".app", ".command", ".vbs", ".js", ".jse", ".wsf", ".hta", ".cpl", ".pif", ".vbe", ".wsh", ".py", ".pyw", ".rb", ".pl", ".jar", ".jnlp", ".webloc", ".workflow", ".action", ".run", ".deb", ".rpm", ".pkg", ".dmg", ".reg", ".inf" }.Contains(Path.GetExtension(Filename(name)).ToLowerInvariant());
  public object Invoke(byte[] bytes, string name, bool open)
  {
    name = Filename(name);
    HostError.Require(bytes.Length <= LocalDatabase.MaxAttachment, "attachment-capacity", "附件超過容量上限。");
    var key = LocalDatabase.Digest(bytes) + ":" + name; string path, directory;
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this);
      if (!open && previews.TryGetValue(key, out var cached)) return cached;
      HostError.Require(!open || CanOpen(name), "attachment-not-document", "此類檔案請先匯出，再自行選擇開啟方式。");
      directory = Path.Combine(root, Guid.NewGuid().ToString("N")); Directory.CreateDirectory(directory);
      path = Path.Combine(directory, name); File.WriteAllBytes(path, bytes); files.Add(path);
      if (open)
      {
        File.SetAttributes(path, FileAttributes.ReadOnly);
        try { Process.Start(new ProcessStartInfo(path) { UseShellExecute = true }); return new { opened = true }; }
        catch { throw new HostError("attachment-open", "無法開啟附件，請確認已安裝對應的應用程式。"); }
      }
    }
    string? png = null;
    var worker = new Thread(() => { try { png = Thumbnail(path); } catch { } }) { IsBackground = true };
    worker.SetApartmentState(ApartmentState.STA); worker.Start();
    // The owner can close this profile while a third-party Shell handler is still running.
    if (!worker.Join(TimeSpan.FromSeconds(10))) return new { available = true, png = (string?)null };
    try { File.Delete(path); Directory.Delete(directory); } catch { }
    lock (gate)
    {
      ObjectDisposedException.ThrowIf(disposed, this); files.Remove(path);
      object result = new { available = true, png };
      if (previews.Count >= 64) previews.Remove(previews.Keys.First()); previews[key] = result;
      return result;
    }
  }
  private static string? Thumbnail(string path)
  {
    var iid = typeof(IImageFactory).GUID;
    if (SHCreateItemFromParsingName(path, IntPtr.Zero, ref iid, out var factory) != 0) return null;
    IntPtr bitmap = IntPtr.Zero;
    try
    {
      if (factory.GetImage(new SizeI { Width = 128, Height = 128 }, 0, out bitmap) != 0 || bitmap == IntPtr.Zero) return null;
      var source = Imaging.CreateBitmapSourceFromHBitmap(bitmap, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
      var encoder = new PngBitmapEncoder(); encoder.Frames.Add(BitmapFrame.Create(source));
      using var output = new MemoryStream(); encoder.Save(output);
      return output.Length <= 256 * 1024 ? Convert.ToBase64String(output.ToArray()) : null;
    }
    finally { if (bitmap != IntPtr.Zero) _ = DeleteObject(bitmap); _ = Marshal.FinalReleaseComObject(factory); }
  }
  public void Dispose()
  {
    string[] owned;
    lock (gate) { disposed = true; previews.Clear(); owned = files.ToArray(); files.Clear(); }
    foreach (var path in owned) try { File.SetAttributes(path, FileAttributes.Normal); File.Delete(path); Directory.Delete(Path.GetDirectoryName(path)!); } catch { }
    try { Directory.Delete(root); } catch { }
  }
  [StructLayout(LayoutKind.Sequential)] private struct SizeI { public int Width, Height; }
  [ComImport, Guid("BCC18B79-BA16-442F-80C4-8A59C30C463B"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IImageFactory { [PreserveSig] int GetImage(SizeI size, int flags, out IntPtr bitmap); }
  [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
  private static extern int SHCreateItemFromParsingName(string path, IntPtr bind, ref Guid iid, out IImageFactory factory);
  [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr value);
}
