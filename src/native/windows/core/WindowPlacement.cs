using System.Text;
using System.Text.Json;

namespace WorkFleet.Windows.Core;

public sealed record PlacementArea(int X, int Y, int Width, int Height);
/// <summary>Main window restore bounds in the host's own units; X/Y are null where the compositor places windows.</summary>
public sealed record SavedPlacement(int? X, int? Y, int Width, int Height, bool Maximized);

/// <summary>ADR-043: the main window's restore bounds, kept per data directory and never in a profile or backup.</summary>
public static class WindowPlacement
{
  public const string FileName = "window-placement.json";
  /// <summary>
  /// Keeps saved bounds on the display they overlap most, shrunk and moved fully inside its work area. Bounds that
  /// overlap no display, or none saved, give the default size centred on the primary work area.
  /// </summary>
  public static SavedPlacement Resolve(SavedPlacement? saved, IReadOnlyList<PlacementArea> areas, int defaultWidth, int defaultHeight)
  {
    if (areas.Count == 0) throw new ArgumentException("No work areas.", nameof(areas));
    var primary = areas[0];
    if (saved is null || saved.Width <= 0 || saved.Height <= 0) return Default(primary, defaultWidth, defaultHeight);
    if (saved.X is null || saved.Y is null)
      return saved with { X = null, Y = null, Width = Math.Min(saved.Width, primary.Width), Height = Math.Min(saved.Height, primary.Height) };
    PlacementArea? best = null; long most = 0;
    foreach (var area in areas)
    {
      long width = Math.Min((long)saved.X.Value + saved.Width, (long)area.X + area.Width) - Math.Max(saved.X.Value, area.X);
      long height = Math.Min((long)saved.Y.Value + saved.Height, (long)area.Y + area.Height) - Math.Max(saved.Y.Value, area.Y);
      if (width > 0 && height > 0 && width * height > most) { most = width * height; best = area; }
    }
    if (best is null) return Default(primary, defaultWidth, defaultHeight);
    var fitWidth = Math.Min(saved.Width, best.Width); var fitHeight = Math.Min(saved.Height, best.Height);
    return new(Math.Clamp(saved.X.Value, best.X, best.X + best.Width - fitWidth), Math.Clamp(saved.Y.Value, best.Y, best.Y + best.Height - fitHeight),
      fitWidth, fitHeight, saved.Maximized);
  }
  private static SavedPlacement Default(PlacementArea area, int width, int height)
  {
    width = Math.Min(width, area.Width); height = Math.Min(height, area.Height);
    return new(area.X + (area.Width - width) / 2, area.Y + (area.Height - height) / 2, width, height, false);
  }
  public static SavedPlacement? Parse(ReadOnlySpan<byte> bytes)
  {
    try
    {
      using var document = JsonRules.Parse(bytes.ToArray()); var value = document.RootElement;
      if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || version.GetInt32() != 1) return null;
      static int? Coordinate(JsonElement value, string key) => value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.Number
        && field.TryGetInt32(out var number) && Math.Abs((long)number) <= 1_000_000 ? number : null;
      static bool Present(JsonElement value, string key) => value.TryGetProperty(key, out var field) && field.ValueKind != JsonValueKind.Null;
      int? x = Coordinate(value, "x"), y = Coordinate(value, "y"), width = Coordinate(value, "width"), height = Coordinate(value, "height");
      if (width is not > 0 || height is not > 0 || width > 32768 || height > 32768) return null;
      if ((x is null) != (y is null) || x is null && (Present(value, "x") || Present(value, "y"))) return null;
      if (!value.TryGetProperty("maximized", out var maximized) || maximized.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return null;
      return new(x, y, width.Value, height.Value, maximized.GetBoolean());
    }
    catch (Exception error) when (error is JsonException or HostError or FormatException or InvalidOperationException) { return null; }
  }
  public static byte[] Serialize(SavedPlacement value) => Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
  {
    version = 1, x = value.X, y = value.Y, width = value.Width, height = value.Height, maximized = value.Maximized
  }) + "\n");
  public static SavedPlacement? Read(string directory)
  {
    try
    {
      var file = new FileInfo(Path.Combine(directory, FileName));
      return file.Exists && file.Length <= 4096 ? Parse(File.ReadAllBytes(file.FullName)) : null;
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
  }
  public static void Write(string directory, SavedPlacement value) => HostFiles.Replace(directory, FileName, Serialize(value));
  public static void Remove(string directory) => File.Delete(Path.Combine(directory, FileName));
}

/// <summary>Atomic small-file replacement for host-level settings beside profile.txt.</summary>
public static class HostFiles
{
  public static void Replace(string directory, string name, byte[] bytes)
  {
    Directory.CreateDirectory(directory);
    var target = Path.Combine(directory, name); var temporary = target + "." + Guid.NewGuid().ToString("N") + ".tmp";
    try
    {
      using (var stream = new FileStream(temporary, FileMode.CreateNew, FileAccess.Write, FileShare.None)) { stream.Write(bytes); stream.Flush(true); }
      File.Move(temporary, target, true);
    }
    finally { if (File.Exists(temporary)) File.Delete(temporary); }
  }
}
