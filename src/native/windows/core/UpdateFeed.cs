using System.Text.Json;
using System.Text.RegularExpressions;
using System.Xml;

namespace WorkFleet.Windows.Core;

public sealed record ReleaseAsset(string Name, long Size, string Url);
public sealed record UpdateRelease(string Tag, Version Version, bool Prerelease, string PageUrl, IReadOnlyList<ReleaseAsset> Assets);
/// <summary>One installer chosen from a release's work-fleet-update.json, with the download URL from the release itself.</summary>
public sealed record UpdatePackage(string Version, string Tag, string Summary, string Name, long Size, string Sha256, string Url, string PageUrl);

/// <summary>
/// ADR-044 feed rules shared with the Linux and macOS hosts (tests/fixtures/update-feed.json): a GitHub REST releases page,
/// the per-platform tag `platform-vX.Y.Z`, and the release's work-fleet-update.json. Every refusal is metadata_invalid.
/// </summary>
public static partial class UpdateFeed
{
  public const string ManifestName = "work-fleet-update.json";
  public const long MaxPackageBytes = 512L * 1024 * 1024;
  [GeneratedRegex(@"^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$")] private static partial Regex VersionPattern();
  [GeneratedRegex("^[0-9a-f]{64}$")] private static partial Regex DigestPattern();

  /// <summary>A strict x.y.z release version without leading zeros, or null.</summary>
  public static Version? ParseVersion(string? text)
  {
    var match = text is null ? null : VersionPattern().Match(text);
    return match is { Success: true } ? new Version(int.Parse(match.Groups[1].Value), int.Parse(match.Groups[2].Value), int.Parse(match.Groups[3].Value)) : null;
  }
  private static HostError Invalid(string detail) => new("metadata_invalid", "更新資訊格式不符，未下載任何檔案。" + detail);

  /// <summary>The newest release for this platform and channel that is newer than the running version, if any.</summary>
  public static UpdateRelease? Latest(ReadOnlySpan<byte> releases, string platform, string channel, Version current)
  {
    UpdateRelease? best = null;
    try
    {
      using var document = JsonDocument.Parse(releases.ToArray(), new JsonDocumentOptions { MaxDepth = 32 });
      if (document.RootElement.ValueKind != JsonValueKind.Array) throw Invalid("");
      var prefix = platform + "-v";
      foreach (var item in document.RootElement.EnumerateArray())
      {
        if (item.ValueKind != JsonValueKind.Object || !item.TryGetProperty("tag_name", out var tag) || tag.ValueKind != JsonValueKind.String) continue;
        var name = tag.GetString()!;
        if (!name.StartsWith(prefix, StringComparison.Ordinal) || ParseVersion(name[prefix.Length..]) is not { } version) continue;
        if (Flag(item, "draft") || Flag(item, "prerelease") && channel != "preview" || version <= current) continue;
        if (best is not null && version <= best.Version) continue;
        var assets = new List<ReleaseAsset>();
        if (item.TryGetProperty("assets", out var list) && list.ValueKind == JsonValueKind.Array)
          foreach (var asset in list.EnumerateArray())
            if (asset.ValueKind == JsonValueKind.Object && Text(asset, "name") is { } assetName && Text(asset, "browser_download_url") is { } url
              && asset.TryGetProperty("size", out var size) && size.TryGetInt64(out var bytes) && bytes >= 0)
              assets.Add(new(assetName, bytes, url));
        best = new(name, version, Flag(item, "prerelease"), Text(item, "html_url") ?? "", assets);
      }
    }
    catch (JsonException) { throw Invalid(""); }
    return best;
  }
  private static bool Flag(JsonElement value, string key) => value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.True;
  private static string? Text(JsonElement value, string key) => value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String ? field.GetString() : null;

  /// <summary>Checks a release's work-fleet-update.json against the release it came from and picks this architecture's installer.</summary>
  public static UpdatePackage Manifest(ReadOnlySpan<byte> manifest, UpdateRelease release, string platform, string arch)
  {
    try
    {
      using var document = JsonRules.Parse(manifest.ToArray()); var value = document.RootElement;
      if (value.ValueKind != JsonValueKind.Object || !value.TryGetProperty("schemaVersion", out var schema) || !schema.TryGetInt32(out var number) || number != 1) throw Invalid("");
      var version = Text(value, "version"); var summary = Text(value, "summary") ?? "";
      if (Text(value, "platform") != platform || Text(value, "tag") != release.Tag || ParseVersion(version) != release.Version || summary.Length > 2000) throw Invalid("");
      if (!value.TryGetProperty("assets", out var assets) || assets.ValueKind != JsonValueKind.Array) throw Invalid("");
      var matches = assets.EnumerateArray().Where(asset => asset.ValueKind == JsonValueKind.Object && Text(asset, "arch") == arch).ToArray();
      if (matches.Length != 1) throw Invalid("沒有這個架構的安裝檔。");
      var chosen = matches[0];
      var name = Text(chosen, "name"); var sha256 = Text(chosen, "sha256");
      if (name is null || sha256 is null || !DigestPattern().IsMatch(sha256) || !chosen.TryGetProperty("size", out var size) || !size.TryGetInt64(out var bytes)
        || bytes <= 0 || bytes > MaxPackageBytes) throw Invalid("");
      var asset = release.Assets.FirstOrDefault(item => item.Name == name);
      if (asset is null || asset.Size != bytes) throw Invalid("");
      return new(version!, release.Tag, summary.Length > 500 ? summary[..500] : summary, name, bytes, sha256, asset.Url, release.PageUrl);
    }
    catch (JsonException) { throw Invalid(""); }
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
          throw new HostError("identity_mismatch", "下載的安裝檔不是這個 App，未安裝。");
        if (!string.Equals(reader.GetAttribute("ProcessorArchitecture"), architecture, StringComparison.OrdinalIgnoreCase) || version is null || version <= current)
          throw new HostError("identity_mismatch", "下載的安裝檔版本或架構不符，未安裝。");
        return;
      }
    }
    catch (XmlException) { }
    throw new HostError("identity_mismatch", "下載的安裝檔缺少套件身分，未安裝。");
  }
}
