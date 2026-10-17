using System.Text;
using System.Text.Json;

namespace WorkFleet.Windows.Core;

/// <summary>
/// ADR-043: startup behaviour and the display language for this data directory. Not part of any profile, backup or Google data.
/// </summary>
public sealed record HostPreferences(bool StartAtLogin = true, bool CloseToTray = true, bool OpenMainAtLogin = false, string? LastUpdateCheck = null,
  string Language = "auto")
{
  public const string FileName = "host-preferences.json";
  /// <summary>Unknown versions, damaged files and invalid values fall back to the defaults instead of blocking startup.</summary>
  public static HostPreferences Parse(ReadOnlySpan<byte> bytes)
  {
    var defaults = new HostPreferences();
    try
    {
      using var document = JsonRules.Parse(bytes.ToArray()); var value = document.RootElement;
      if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("version", out var version) || version.ValueKind != JsonValueKind.Number || version.GetInt32() != 1) return defaults;
      static bool Flag(JsonElement value, string key, bool fallback) => value.TryGetProperty(key, out var field) && field.ValueKind is JsonValueKind.True or JsonValueKind.False ? field.GetBoolean() : fallback;
      string? checkedAt = null;
      if (value.TryGetProperty("lastUpdateCheck", out var field) && field.ValueKind == JsonValueKind.String && field.TryGetDateTimeOffset(out var time)) checkedAt = time.ToUniversalTime().ToString("O");
      // An unknown or damaged language falls back to "auto" on its own; the other settings still apply.
      var language = value.TryGetProperty("language", out var chosen) && chosen.ValueKind == JsonValueKind.String && HostText.ValidPreference(chosen.GetString())
        ? chosen.GetString()! : defaults.Language;
      return new(Flag(value, "startAtLogin", defaults.StartAtLogin), Flag(value, "closeToTray", defaults.CloseToTray), Flag(value, "openMainAtLogin", defaults.OpenMainAtLogin), checkedAt, language);
    }
    catch (Exception error) when (error is JsonException or HostError or FormatException or InvalidOperationException) { return defaults; }
  }
  public byte[] Serialize() => Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
  {
    version = 1, startAtLogin = StartAtLogin, closeToTray = CloseToTray, openMainAtLogin = OpenMainAtLogin, lastUpdateCheck = LastUpdateCheck, language = Language
  }) + "\n");
  public static HostPreferences Read(string directory)
  {
    try
    {
      var file = new FileInfo(Path.Combine(directory, FileName));
      return file.Exists && file.Length <= 4096 ? Parse(File.ReadAllBytes(file.FullName)) : new();
    }
    catch (Exception error) when (error is IOException or UnauthorizedAccessException) { return new(); }
  }
  public void Write(string directory) => HostFiles.Replace(directory, FileName, Serialize());
  /// <summary>Applies one named switch from the settings page; other names are refused.</summary>
  public HostPreferences With(string name, bool value) => name switch
  {
    "startAtLogin" => this with { StartAtLogin = value },
    "closeToTray" => this with { CloseToTray = value },
    "openMainAtLogin" => this with { OpenMainAtLogin = value },
    _ => throw new HostError("invalid-request", "There is no such startup setting.")
  };
  /// <summary>The display language from Settings > General: "auto", "en" or "zh-TW"; anything else is refused.</summary>
  public HostPreferences WithLanguage(string value) => HostText.ValidPreference(value) ? this with { Language = value }
    : throw new HostError("invalid-request", "This display language is not supported.");
}

/// <summary>What host.info reports about this build. The version comes from Directory.Build.props.</summary>
public sealed record HostIdentity(string AppVersion, string Distribution, bool HostPreferences, bool Updates = false)
{
  public static HostIdentity Default { get; } = new(BuildVersion(), "unknown", false);
  public static string BuildVersion()
  {
    var text = typeof(HostIdentity).Assembly.GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
      .OfType<System.Reflection.AssemblyInformationalVersionAttribute>().FirstOrDefault()?.InformationalVersion ?? "0.0.0";
    // SourceLink appends +<commit>; the release version is the part before it.
    var plus = text.IndexOf('+'); return plus >= 0 ? text[..plus] : text;
  }
}
