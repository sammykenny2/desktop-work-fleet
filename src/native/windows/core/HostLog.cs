using System.Text;
using System.Text.Json;

namespace WorkFleet.Windows.Core;

/// <summary>
/// ADR-045: launches, exits and fatal errors of the host for this data directory, so a failure at sign-in leaves evidence
/// beside the data and not only in the Windows event log. It never holds note text.
/// </summary>
public static class HostLog
{
  public const string FileName = "host.log";
  public const long Limit = 256 * 1024;
  /// <summary>WPF's UCEERR_RENDERTHREADFAILURE: the render thread is gone and this process cannot draw again.</summary>
  public const int RenderThreadFailure = unchecked((int)0x88980406);

  /// <summary>Appends one entry; a full log becomes host.log.1, replacing the older one. Logging never throws.</summary>
  public static void Append(string directory, DateTimeOffset time, string text)
  {
    try
    {
      Directory.CreateDirectory(directory);
      var path = Path.Combine(directory, FileName);
      var file = new FileInfo(path);
      if (file.Exists && file.Length >= Limit) File.Move(path, path + ".1", true);
      using var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
      stream.Write(Encoding.UTF8.GetBytes($"{time:yyyy-MM-dd HH:mm:ss.fffzzz} {text.TrimEnd('\n')}\n")); stream.Flush(true);
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { }
  }

  /// <summary>Each exception in the chain with its HRESULT, which a COMException's message does not always name, then the full text.</summary>
  public static string Describe(Exception error)
  {
    var text = new StringBuilder();
    for (var current = error; current is not null; current = current.InnerException)
      text.Append(current == error ? "" : " <- ").Append(current.GetType().FullName).Append($" HRESULT=0x{current.HResult:X8}");
    return text.Append('\n').Append(error).ToString();
  }

  public static bool IsRenderThreadFailure(Exception error)
  {
    for (var current = error; current is not null; current = current.InnerException)
      if (current.HResult == RenderThreadFailure) return true;
    return false;
  }
}

/// <summary>
/// ADR-045: left by a sign-in launch that is ending after a render-thread failure. The instance it reopens takes the marker
/// once, waits for the old process to end and starts hidden; that instance never reopens itself again.
/// </summary>
public sealed record RestartMarker(int ProcessId, DateTimeOffset Created, string Reason)
{
  public const string FileName = "restart.json";
  // Long enough for Windows to finish a dump of the old process; short enough that a later manual launch never takes it.
  public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(2);

  public byte[] Serialize() => Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
  {
    version = 1, processId = ProcessId, created = Created.ToUniversalTime().ToString("O"), reason = Reason
  }) + "\n");
  public void Write(string directory) => HostFiles.Replace(directory, FileName, Serialize());

  public static RestartMarker? Parse(ReadOnlySpan<byte> bytes)
  {
    try
    {
      using var document = JsonRules.Parse(bytes.ToArray()); var value = document.RootElement;
      if (value.ValueKind != JsonValueKind.Object || JsonRules.Integer(value, "version") != 1) return null;
      var process = JsonRules.Integer(value, "processId", int.MaxValue);
      if (process == 0 || !value.GetProperty("created").TryGetDateTimeOffset(out var created)) return null;
      return new((int)process, created.ToUniversalTime(), JsonRules.Text(value, "reason", 64));
    }
    catch (Exception error) when (error is JsonException or HostError or KeyNotFoundException or InvalidOperationException) { return null; }
  }

  /// <summary>Moves the marker aside before reading it, so only one launch takes it. Stale, future-dated and damaged markers are dropped.</summary>
  public static RestartMarker? Take(string directory, DateTimeOffset now)
  {
    var path = Path.Combine(directory, FileName); var taken = path + "." + Guid.NewGuid().ToString("N") + ".taken";
    try { File.Move(path, taken); }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
    try
    {
      var marker = new FileInfo(taken).Length <= 4096 ? Parse(File.ReadAllBytes(taken)) : null;
      return marker is not null && now - marker.Created <= Lifetime && marker.Created - now <= TimeSpan.FromMinutes(1) ? marker : null;
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return null; }
    finally { try { File.Delete(taken); } catch (Exception error) when (error is IOException or UnauthorizedAccessException) { } }
  }
}
