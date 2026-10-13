using System.Text;
using System.Text.Json;
using WorkFleet.Windows.Core;

/// <summary>ADR-044 feed rules from the shared fixture, plus the MSIX identity check on synthetic manifests.</summary>
internal static class UpdateFeedProbe
{
  public static int Run()
  {
    var count = 0;
    void Require(bool value, string message) { if (!value) throw new Exception(message); count++; }
    using var document = JsonDocument.Parse(File.ReadAllBytes(Fixture()));
    var root = document.RootElement;
    var releases = Encoding.UTF8.GetBytes(root.GetProperty("releases").GetRawText());
    foreach (var item in root.GetProperty("selection").EnumerateArray())
    {
      var expected = item.GetProperty("expected").ValueKind == JsonValueKind.Null ? null : item.GetProperty("expected").GetString();
      var chosen = UpdateFeed.Latest(releases, item.GetProperty("platform").GetString()!, item.GetProperty("channel").GetString()!,
        UpdateFeed.ParseVersion(item.GetProperty("current").GetString())!);
      Require(chosen?.Tag == expected, $"{item.GetProperty("name").GetString()}: {chosen?.Tag ?? "none"} != {expected ?? "none"}");
    }
    var release = UpdateFeed.Latest(releases, "windows", "preview", new Version(0, 1, 2))!;
    Require(release.Tag == root.GetProperty("manifestRelease").GetString(), "manifest release");
    foreach (var item in root.GetProperty("manifests").EnumerateArray())
    {
      var name = item.GetProperty("name").GetString();
      var manifest = Encoding.UTF8.GetBytes(item.GetProperty("manifest").GetRawText());
      var expected = item.GetProperty("expected");
      if (expected.ValueKind == JsonValueKind.Null)
      {
        try { UpdateFeed.Manifest(manifest, release, "windows", "x64"); throw new Exception($"{name}: accepted"); }
        catch (HostError error) { Require(error.Code == "metadata_invalid", $"{name}: {error.Code}"); }
        continue;
      }
      var package = UpdateFeed.Manifest(manifest, release, "windows", "x64");
      Require(package.Version == expected.GetProperty("version").GetString() && package.Summary == expected.GetProperty("summary").GetString()
        && package.Name == expected.GetProperty("name").GetString() && package.Size == expected.GetProperty("size").GetInt64()
        && package.Sha256 == expected.GetProperty("sha256").GetString() && package.Url == expected.GetProperty("url").GetString(), $"{name}: {package}");
    }
    foreach (var damaged in new[] { "", "{", "{}", "[1,", "\"text\"" })
    {
      try { UpdateFeed.Latest(Encoding.UTF8.GetBytes(damaged), "windows", "preview", new Version(0, 1, 2)); throw new Exception($"damaged feed accepted: {damaged}"); }
      catch (HostError error) { Require(error.Code == "metadata_invalid", $"damaged feed code: {damaged}"); }
    }
    Require(UpdateFeed.ParseVersion("0.1.10") == new Version(0, 1, 10) && UpdateFeed.ParseVersion("01.2.3") is null && UpdateFeed.ParseVersion("1.2") is null
      && UpdateFeed.ParseVersion("1.2.3.4") is null && UpdateFeed.ParseVersion("1.2.3-beta") is null, "strict versions");

    static MemoryStream Appx(string name, string publisher, string version, string arch = "x64") => new(Encoding.UTF8.GetBytes(
      $"<?xml version=\"1.0\" encoding=\"utf-8\"?><Package xmlns=\"http://schemas.microsoft.com/appx/manifest/foundation/windows10\"><Identity Name=\"{name}\" Version=\"{version}\" Publisher=\"{publisher}\" ProcessorArchitecture=\"{arch}\" /></Package>"));
    var current = new Version(0, 1, 2, 0);
    UpdateFeed.CheckIdentity(Appx("app.workfleet.preview", "CN=Work Fleet Preview", "0.1.3.0"), "app.workfleet.preview", "CN=Work Fleet Preview", "x64", current);
    count++;
    foreach (var (stream, why) in new[] {
      (Appx("app.other", "CN=Work Fleet Preview", "0.1.3.0"), "another identity"),
      (Appx("app.workfleet.preview", "CN=Someone Else", "0.1.3.0"), "another publisher"),
      (Appx("app.workfleet.preview", "CN=Work Fleet Preview", "0.1.2.0"), "the same version"),
      (Appx("app.workfleet.preview", "CN=Work Fleet Preview", "0.1.3.0", "arm64"), "another architecture"),
      (new MemoryStream(Encoding.UTF8.GetBytes("<!DOCTYPE x [<!ENTITY a \"b\">]><Package><Identity Name=\"&a;\" /></Package>")), "a DTD"),
      (new MemoryStream(Encoding.UTF8.GetBytes("not xml")), "not XML") })
    {
      try { UpdateFeed.CheckIdentity(stream, "app.workfleet.preview", "CN=Work Fleet Preview", "x64", current); throw new Exception($"identity check accepted {why}"); }
      catch (HostError error) { Require(error.Code == "identity_mismatch", $"identity check code for {why}"); }
    }
    return count;
  }
  private static string Fixture()
  {
    for (var folder = new DirectoryInfo(AppContext.BaseDirectory); folder is not null; folder = folder.Parent)
    {
      var candidate = Path.Combine(folder.FullName, "tests", "fixtures", "update-feed.json");
      if (File.Exists(candidate)) return candidate;
    }
    throw new FileNotFoundException("tests/fixtures/update-feed.json");
  }
}
