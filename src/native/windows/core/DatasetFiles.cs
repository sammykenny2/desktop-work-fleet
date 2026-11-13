using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace PinItAnywhere.Windows.Core;

/// <summary>Closed dataset descriptors and typed selectors; no renderer-provided HTTP or query strings.</summary>
public static class DatasetFiles
{
  public const string Format = "pin-it-anywhere-dataset";
  public const string Fields = "id,name,mimeType,parents,spaces,trashed,size,createdTime,appProperties,sha256Checksum";
  public static readonly string[] Shards = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "a", "b", "c", "d", "e", "f", "groups"];
  public static void Check(bool value) => HostError.Require(value, "invalid-source-file", "The dataset descriptor or query isn't valid.");
  private static bool Match(string value, string pattern) => value is not ("__proto__" or "prototype" or "constructor") && Regex.IsMatch(value, "\\A(?:" + pattern + ")\\z");
  public static bool FileId(string value) => Match(value, "[A-Za-z0-9_-]{1,256}");
  private static bool EntityId(string value) => Match(value, "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}");
  private static bool DatasetId(string value) => Match(value, "[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}");
  private static HashSet<string> Keys(JsonElement value) => value.EnumerateObject().Select(item => item.Name).ToHashSet(StringComparer.Ordinal);
  private static string Text(JsonElement value, string key) => JsonRules.Text(value, key, 256);
  private static Dictionary<string, string> Properties(JsonElement file)
  {
    var result = new Dictionary<string, string> { ["piaFormat"] = Format, ["piaSchema"] = "1", ["piaDataset"] = Text(file, "datasetId"), ["piaKind"] = Text(file, "kind") };
    foreach (var (key, property) in new[] { ("sha256", "piaSha256"), ("role", "piaRole"), ("entityId", "piaEntity"), ("revisionId", "piaRevision"), ("shard", "piaShard") })
      if (file.TryGetProperty(key, out _)) result[property] = Text(file, key);
    Check(result.All(item => Encoding.UTF8.GetByteCount(item.Key + item.Value) <= 124)); return result;
  }
  public static JsonElement File(JsonElement value)
  {
    Check(value.ValueKind == JsonValueKind.Object); var kind = Text(value, "kind");
    Check(FileId(Text(value, "id")) && FileId(Text(value, "parentId")) && DatasetId(Text(value, "datasetId"))
      && kind is "dataset-root" or "folder" or "dataset" or "ready" or "revision" or "attachment" or "change" or "checkpoint" or "purge");
    var keys = new HashSet<string>(["id", "parentId", "datasetId", "kind"], StringComparer.Ordinal);
    if (kind is "folder" or "dataset-root")
    {
      keys.Add("role"); Check(Match(Text(value, "role"), "[a-z][a-z0-9-]{0,31}"));
      if (value.TryGetProperty("entityId", out _)) { keys.Add("entityId"); Check(EntityId(Text(value, "entityId"))); }
      Check(kind != "dataset-root" || Text(value, "parentId") == "appDataFolder" && Text(value, "role") == "root");
    }
    else
    {
      keys.UnionWith(["sha256", "size"]); LocalDatabase.CheckDigest(Text(value, "sha256"));
      _ = JsonRules.Integer(value, "size", kind == "attachment" ? LocalDatabase.MaxAttachment : kind is "change" or "purge" or "dataset" or "ready" ? 65536 : 8 * 1024 * 1024);
      if (kind is "revision" or "attachment" or "change" or "purge") { keys.Add("entityId"); Check(EntityId(Text(value, "entityId"))); }
      if (kind is "revision" or "change") { keys.Add("revisionId"); Check(EntityId(Text(value, "revisionId"))); }
      if (kind is "revision" or "change" or "checkpoint" or "purge") { keys.Add("shard"); Check(Shards.Contains(Text(value, "shard"))); }
    }
    Check(keys.SetEquals(Keys(value))); _ = Properties(value); return value.Clone();
  }
  public static bool MediaType(string kind, string? value) => value is not null && value.Length <= 256
    && (kind is "folder" or "dataset-root" ? value == "application/vnd.google-apps.folder"
      : Match(value, "[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*")
        && !value.StartsWith("application/vnd.google-apps.", StringComparison.OrdinalIgnoreCase));
  public static JsonElement Metadata(JsonElement input)
  {
    var value = File(input); var kind = Text(value, "kind"); var id = Text(value, "id"); var folder = kind is "folder" or "dataset-root";
    var suffix = folder ? "" : kind == "attachment" ? ".bin" : ".json";
    var identity = value.TryGetProperty("revisionId", out var revision) ? revision.GetString()! : value.TryGetProperty("entityId", out var entity) ? entity.GetString()! : id;
    return JsonSerializer.SerializeToElement(new { id, name = kind + "-" + identity + suffix, mimeType = folder ? "application/vnd.google-apps.folder" : kind == "attachment" ? "application/octet-stream" : "application/json",
      parents = new[] { Text(value, "parentId") }, appProperties = Properties(value) });
  }
  public static void Verify(JsonElement value, JsonElement expected)
  {
    var desired = Metadata(expected); var parents = value.GetProperty("parents").EnumerateArray().Select(item => item.GetString()!).ToArray();
    var properties = Properties(expected); var actual = value.GetProperty("appProperties");
    Check(Keys(actual).SetEquals(properties.Keys) && properties.All(item => Text(actual, item.Key) == item.Value));
    Check(Text(value, "id") == Text(expected, "id") && MediaType(Text(expected, "kind"), Text(value, "mimeType")) && parents.Length == 1
      && (parents[0] == Text(expected, "parentId") || Text(expected, "kind") == "dataset-root" && FileId(parents[0]))
      && value.GetProperty("spaces").EnumerateArray().Any(item => item.GetString() == "appDataFolder")
      && (!value.TryGetProperty("trashed", out var trashed) || trashed.ValueKind == JsonValueKind.False));
    if (expected.TryGetProperty("sha256", out _)) Check(Text(value, "size") == JsonRules.Integer(expected, "size").ToString(System.Globalization.CultureInfo.InvariantCulture)
      && (!value.TryGetProperty("sha256Checksum", out _) || Text(value, "sha256Checksum") == Text(expected, "sha256")));
  }
  private static string Prop(string key, string value) => "appProperties has { key='" + key + "' and value='" + value + "' }";
  public static byte[] DeleteBatch(JsonElement value)
  {
    Check(value.ValueKind == JsonValueKind.Array && value.GetArrayLength() is >= 1 and <= 100);
    var ids = value.EnumerateArray().Select(item => item.ValueKind == JsonValueKind.String ? item.GetString()! : "").ToArray();
    Check(ids.Distinct(StringComparer.Ordinal).Count() == ids.Length && ids.All(id => FileId(id) && id is not ("root" or "appDataFolder")));
    var body = string.Concat(ids.Select((id, index) => $"--pin_it_anywhere_delete\r\nContent-Type: application/http\r\nContent-ID: wf-{index}\r\n\r\nDELETE /drive/v3/files/{id} HTTP/1.1\r\n\r\n")) + "--pin_it_anywhere_delete--\r\n";
    return Encoding.UTF8.GetBytes(body);
  }
  public static string Query(JsonElement value)
  {
    Check(value.ValueKind == JsonValueKind.Object); var scope = Text(value, "scope"); var keys = new HashSet<string>(["scope"], StringComparer.Ordinal);
    var clauses = new List<string> { "trashed = false" };
    if (scope == "fences") clauses.Add(Prop("piaKind", "reset"));
    else if (scope != "legacy")
    {
      clauses.Add(Prop("piaFormat", Format));
      if (scope is not ("datasets" or "reset-datasets")) { keys.Add("datasetId"); Check(DatasetId(Text(value, "datasetId"))); clauses.Add(Prop("piaDataset", Text(value, "datasetId"))); }
      if (scope is "datasets" or "reset-datasets" or "ready" or "roots")
      {
        clauses.Add(Prop("piaKind", scope is "datasets" or "reset-datasets" ? "dataset" : scope == "roots" ? "dataset-root" : "ready"));
        if (scope == "roots") clauses.Add("'appDataFolder' in parents");
      }
      else if (scope is "current" or "current-all")
      {
        if (scope == "current") { keys.Add("shard"); var shard = Text(value, "shard"); Check(Shards.Contains(shard)); clauses.Add(Prop("piaShard", shard)); }
        clauses.Add("(" + Prop("piaKind", "checkpoint") + " or " + Prop("piaKind", "change") + ")");
      }
      else if (scope is "history" or "children")
      {
        keys.Add("parentId"); Check(FileId(Text(value, "parentId"))); clauses.Add("'" + Text(value, "parentId") + "' in parents");
        if (scope == "history") clauses.Add(Prop("piaKind", "revision"));
      }
      else if (scope is "purges" or "entity-folders" or "entity-data")
      {
        keys.Add("entities"); var ids = value.GetProperty("entities").EnumerateArray().Select(item => item.GetString()!).ToArray();
        Check(ids.Length is > 0 and <= 20 && ids.All(EntityId) && ids.Distinct(StringComparer.Ordinal).Count() == ids.Length);
        clauses.Add(scope == "entity-data" ? "(" + string.Join(" or ", new[] { "revision", "attachment", "folder" }.Select(kind => Prop("piaKind", kind))) + ")"
          : Prop("piaKind", scope == "purges" ? "purge" : "folder")); clauses.Add("(" + string.Join(" or ", ids.Select(id => Prop("piaEntity", id))) + ")");
      }
      else Check(false);
    }
    Check(keys.SetEquals(Keys(value))); return string.Join(" and ", clauses);
  }
}
