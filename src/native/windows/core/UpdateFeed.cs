using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;
using System.Xml.Linq;

namespace WorkFleet.Windows.Core;

public sealed record UpdateRelease(string Repository, string Tag, Version Version, string PageUrl);
/// <summary>One installer chosen from this platform's manifest in a release, downloaded from that same release.</summary>
public sealed record UpdatePackage(string Version, string Tag, string Summary, string Name, long Size, string Sha256, string Url, string PageUrl);

/// <summary>
/// ADR-044 feed rules shared with the Linux and macOS hosts (tests/fixtures/update-feed.json): a public GitHub Atom feed,
/// one `vX.Y.Z` release for every platform, and this platform's manifest in it (work-fleet-update-windows.json). Every
/// refusal is metadata_invalid.
/// </summary>
public static partial class UpdateFeed
{
  /// <summary>Each platform's manifest in the shared release; tests/fixtures/update-feed.json lists them.</summary>
  public static string ManifestName(string platform) => $"work-fleet-update-{platform}.json";
  public const long MaxPackageBytes = 512L * 1024 * 1024;
  [GeneratedRegex(@"^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\z")] private static partial Regex VersionPattern();
  [GeneratedRegex(@"^[0-9a-f]{64}\z")] private static partial Regex DigestPattern();

  /// <summary>A strict x.y.z release version without leading zeros, or null.</summary>
  public static Version? ParseVersion(string? text)
  {
    var match = text is null ? null : VersionPattern().Match(text);
    return match is { Success: true } ? new Version(int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value), int.Parse(match.Groups[3].Value)) : null;
  }
  /// <summary>The message is update-state text the page shows as is, so it comes from HostText in the host language.</summary>
  private static HostError Invalid(string key = "update.invalidMetadata") => new("metadata_invalid", HostText.Get(key));

  /// <summary>The newest release on this channel that is newer than the running version, if any.</summary>
  public static UpdateRelease? Latest(ReadOnlySpan<byte> releases, string repository, string channel, Version current)
  {
    // Atom includes published prereleases but has no reliable prerelease flag. Only the approved preview channel is supported.
    if (channel != "preview") throw Invalid("update.invalidChannel");
    UpdateRelease? best = null;
    try
    {
      using var stream = new MemoryStream(releases.ToArray());
      using var reader = XmlReader.Create(stream, new XmlReaderSettings
        { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 2 * 1024 * 1024 });
      var document = XDocument.Load(reader);
      XNamespace atom = "http://www.w3.org/2005/Atom";
      if (document.Root?.Name != atom + "feed") throw Invalid();
      var pagePrefix = $"https://github.com/{repository}/releases/tag/";
      // Releases before 0.3.7 had one tag per platform, such as windows-v0.3.6; they never match this prefix.
      const string prefix = "v";
      var entries = document.Root.Elements(atom + "entry").ToArray();
      var found = false;
      foreach (var item in entries)
      {
        foreach (var link in item.Elements(atom + "link"))
        {
          if ((string?)link.Attribute("rel") is { } rel && rel != "alternate") continue;
          var page = (string?)link.Attribute("href");
          if (page is null || !page.StartsWith(pagePrefix, StringComparison.Ordinal)) continue;
          var tag = page[pagePrefix.Length..];
          if (!tag.StartsWith(prefix, StringComparison.Ordinal) || ParseVersion(tag[prefix.Length..]) is not { } version) continue;
          found = true;
          if (version > current && (best is null || version > best.Version)) best = new(repository, tag, version, page);
        }
      }
      // A feed that lists releases but none of this form must not be read as "up to date".
      if (entries.Length > 0 && !found) throw Invalid("update.releaseMissing");
    }
    catch (XmlException) { throw Invalid(); }
    return best;
  }
  private static string? Text(JsonElement value, string key) => value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;

  public static string AssetUrl(UpdateRelease release, string name)
  {
    if (!Regex.IsMatch(name, @"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\z")) throw Invalid("update.invalidFileName");
    return $"https://github.com/{release.Repository}/releases/download/{release.Tag}/{name}";
  }

  /// <summary>Checks this platform's manifest against the release it came from and picks this architecture's installer.</summary>
  public static UpdatePackage Manifest(ReadOnlySpan<byte> manifest, UpdateRelease release, string platform, string arch)
  {
    try
    {
      using var document = JsonRules.Parse(manifest.ToArray()); var value = document.RootElement;
      if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("schemaVersion", out var schema) || !schema.TryGetInt32(out var number) || number != 1) throw Invalid();
      var version = Text(value, "version"); var summary = Text(value, "summary") ?? "";
      if (Text(value, "platform") != platform || Text(value, "tag") != release.Tag || ParseVersion(version) != release.Version || summary.Length > 2000) throw Invalid();
      if (!value.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) throw Invalid();
      var matches = assets.EnumerateArray().Where(asset => asset.ValueKind == JsonValueKind.Object && Text(asset, "arch") == arch).ToArray();
      if (matches.Length != 1) throw Invalid("update.architectureMissing");
      var chosen = matches[0];
      var name = Text(chosen, "name"); var sha256 = Text(chosen, "sha256");
      if (name is null || sha256 is null || !DigestPattern().IsMatch(sha256) || !chosen.TryGetProperty("size", out var size) || !size.TryGetInt64(out var bytes)
        || bytes <= 0 || bytes > MaxPackageBytes) throw Invalid();
      return new(version!, release.Tag, summary.Length > 500 ? summary[..500] : summary, name, bytes, sha256, AssetUrl(release, name), release.PageUrl);
    }
    catch (JsonException) { throw Invalid(); }
  }

  /// <summary>
  /// The downloaded MSIX must be this app: same identity name and publisher, the same architecture and a higher version.
  /// Windows verifies the signature itself when installing.
  /// </summary>
  public static void CheckIdentity(Stream appxManifest, string name, string publisher, string architecture, Version current)
  {
    var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 1024 * 1024 };
    try
    {
      using var reader = XmlReader.Create(appxManifest, settings);
      while (reader.Read())
      {
        if (reader.NodeType != XmlNodeType.Element || reader.LocalName != "Identity" || reader.Depth != 1) continue;
        var version = Version.TryParse(reader.GetAttribute("Version"), out var parsed) ? parsed : null;
        if (reader.GetAttribute("Name") != name || reader.GetAttribute("Publisher") != publisher)
          throw new HostError("identity_mismatch", HostText.Get("update.otherApp"));
        if (!string.Equals(reader.GetAttribute("ProcessorArchitecture"), architecture, StringComparison.OrdinalIgnoreCase) || version is null || version <= current)
          throw new HostError("identity_mismatch", HostText.Get("update.versionMismatch"));
        return;
      }
    }
    catch (XmlException) { }
    throw new HostError("identity_mismatch", HostText.Get("update.identityMissing"));
  }
}
