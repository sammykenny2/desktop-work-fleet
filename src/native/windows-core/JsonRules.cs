using System.Text.Json;

namespace WorkFleet.Windows.Core;

public static class JsonRules
{
  public const long MaxRevision = 9_007_199_254_740_991;
  public static JsonDocument Parse(ReadOnlyMemory<byte> bytes)
  {
    var document = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 128 });
    try { Visit(document.RootElement); return document; }
    catch { document.Dispose(); throw; }
  }
  private static void Visit(JsonElement value)
  {
    if (value.ValueKind == JsonValueKind.Object)
    {
      var names = new HashSet<string>(StringComparer.Ordinal);
      foreach (var field in value.EnumerateObject())
      {
        HostError.Require(names.Add(field.Name), "invalid-json", "資料含重複 JSON 欄位。");
        Visit(field.Value);
      }
    }
    else if (value.ValueKind == JsonValueKind.Array) foreach (var item in value.EnumerateArray()) Visit(item);
  }
  public static string Text(JsonElement value, string key, int maximum = 256)
  {
    HostError.Require(value.TryGetProperty(key, out var field) && field.ValueKind == JsonValueKind.String,
      "invalid-request", "原生請求缺少必要文字欄位。");
    var text = field.GetString()!;
    HostError.Require(text.Length > 0 && text.Length <= maximum, "invalid-request", "原生請求文字長度無效。");
    return text;
  }
  public static long Integer(JsonElement value, string key, long maximum = MaxRevision)
  {
    HostError.Require(value.TryGetProperty(key, out var field) && field.TryGetInt64(out var number)
      && number >= 0 && number <= maximum, "invalid-request", "原生請求數字無效。");
    return field.GetInt64();
  }
  public static long? ExpectedRevision(JsonElement value)
  {
    HostError.Require(value.TryGetProperty("expectedRevision", out var field), "invalid-request", "缺少版本條件。");
    return field.ValueKind == JsonValueKind.Null ? null : Integer(value, "expectedRevision");
  }
}
