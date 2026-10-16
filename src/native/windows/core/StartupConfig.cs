using System.Text.Json;

namespace WorkFleet.Windows.Core;

/// <summary>
/// ADR-043 startup timings from config/startup.json, which the build writes into Config/public.json beside the app.
/// A missing, damaged or invalid value waits for nothing, so a hidden sign-in start is never left unreachable.
/// </summary>
public static class StartupConfig
{
  /// <summary>How long a hidden sign-in start waits for the tray before showing the main window.</summary>
  public static TimeSpan TrayWait(ReadOnlySpan<byte> publicConfig)
  {
    try
    {
      using var document = JsonRules.Parse(publicConfig.ToArray()); var value = document.RootElement;
      return value.ValueKind == JsonValueKind.Object && value.TryGetProperty("startup", out var startup) && startup.ValueKind == JsonValueKind.Object
        && startup.TryGetProperty("trayWaitSeconds", out var field) && field.ValueKind == JsonValueKind.Number && field.TryGetInt32(out var seconds) && seconds >= 0
        ? TimeSpan.FromSeconds(seconds) : TimeSpan.Zero;
    }
    catch (Exception error) when (error is JsonException or HostError or ArgumentException) { return TimeSpan.Zero; }
  }
  public static TimeSpan ReadTrayWait(string appDirectory)
  {
    try
    {
      var path = Path.Combine(appDirectory, "Config", "public.json");
      return File.Exists(path) ? TrayWait(File.ReadAllBytes(path)) : TimeSpan.Zero;
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return TimeSpan.Zero; }
  }
}
