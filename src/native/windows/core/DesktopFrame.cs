using System.Text.Json;

namespace WorkFleet.Windows.Core;

public sealed record LogicalRect(double X, double Y, double Width, double Height);
public sealed record PresentedCard(string Id, string Layer, LogicalRect Rect, bool Interactive, bool Operable);

/// <summary>Native input regions are derived only from a complete, validated owner projection. A stage notice only
/// keeps the topmost scene visible; it never becomes an input region. While adjusting, the topmost scene is the
/// modal adjust overlay.</summary>
public sealed record DesktopFrame(long Sequence, IReadOnlyList<PresentedCard> Cards, long Topology = 0, LogicalRect? Notice = null, bool Adjusting = false)
{
  public static DesktopFrame Parse(ReadOnlyMemory<byte> bytes, string sessionId, long previous)
  {
    using var document = JsonRules.Parse(bytes); var root = document.RootElement;
    Fields(root, "protocol sessionId sequence topology workspaceRevision layoutRevision groups operationScope activeGroupId cards editor dropTarget fallbacks notice");
    HostError.Require(JsonRules.Integer(root, "protocol") == 1 && JsonRules.Text(root, "sessionId") == sessionId,
      "scene-session", "桌面畫面屬於舊工作階段。");
    var sequence = JsonRules.Integer(root, "sequence");
    HostError.Require(sequence > previous, "scene-order", "桌面畫面已過期。");
    _ = JsonRules.Integer(root, "workspaceRevision"); _ = JsonRules.Integer(root, "layoutRevision");
    var scope = root.GetProperty("operationScope"); Fields(scope, "kind groupId");
    var kind = JsonRules.Text(scope, "kind");
    HostError.Require(kind is "none" or "group" or "all", "scene-frame", "桌面調整範圍無效。");
    // Imported/concurrent groups beyond the formation limit remain visible until the user merges them.
    HostError.Require(root.GetProperty("groups").ValueKind == JsonValueKind.Array && root.GetProperty("groups").GetArrayLength() <= 20000,
      "scene-frame", "桌面群組格式無效。");
    foreach (var group in root.GetProperty("groups").EnumerateArray())
    {
      Fields(group, "id name color region"); _ = JsonRules.Text(group, "id", 128); _ = JsonRules.Text(group, "name", SceneTransfers.MaxFrame);
      Color(group);
      if (group.GetProperty("region").ValueKind != JsonValueKind.Null) _ = Rect(group.GetProperty("region"));
    }
    var values = root.GetProperty("cards");
    HostError.Require(values.ValueKind == JsonValueKind.Array && values.GetArrayLength() <= 20000, "scene-frame", "桌面卡片數量無效。");
    var cards = new List<PresentedCard>(); var ids = new HashSet<string>(StringComparer.Ordinal);
    foreach (var card in values.EnumerateArray())
    {
      Fields(card, "id groupId revision summary text format attachmentCount attachments rect layer interactive draggable editing selected completed mine color");
      if (card.TryGetProperty("attachments", out var attachments))
      {
        HostError.Require(attachments.ValueKind == JsonValueKind.Array && attachments.GetArrayLength() <= 20000, "scene-frame", "附件清單格式無效。");
        foreach (var file in attachments.EnumerateArray()) { Fields(file, "id name"); _ = JsonRules.Text(file, "id", 128); _ = JsonRules.Text(file, "name", LocalDatabase.MaxRecord); }
      }
      var id = JsonRules.Text(card, "id", 128); var layer = JsonRules.Text(card, "layer");
      HostError.Require(ids.Add(id) && layer is "desktop" or "floating" or "wallpaper", "scene-frame", "桌面卡片身分或層級無效。");
      _ = JsonRules.Text(card, "groupId", 128); Color(card);
      HostError.Require(card.GetProperty("text").ValueKind == JsonValueKind.String && card.GetProperty("text").GetString()!.Length <= 8 * 1024 * 1024,
        "scene-frame", "桌面文字超過容量上限。");
      foreach (var flag in new[] { "interactive", "draggable", "editing", "selected", "completed", "mine" }) _ = Boolean(card, flag);
      HostError.Require(layer != "wallpaper" || !Boolean(card, "interactive") && !Boolean(card, "draggable") && !Boolean(card, "editing"),
        "scene-frame", "桌布層便箋必須保持滑鼠穿透；請先調整此組再編輯。");
      cards.Add(new(id, layer, Rect(card.GetProperty("rect")), Boolean(card, "interactive"), Boolean(card, "draggable")));
    }
    LogicalRect? notice = null;
    if (root.TryGetProperty("notice", out var value) && value.ValueKind != JsonValueKind.Null)
    {
      Fields(value, "id rect title text step steps");
      _ = JsonRules.Integer(value, "id"); _ = JsonRules.Integer(value, "step"); _ = JsonRules.Integer(value, "steps");
      _ = JsonRules.Text(value, "title", 200); _ = JsonRules.Text(value, "text", 200);
      notice = Rect(value.GetProperty("rect"));
    }
    return new(sequence, cards, root.TryGetProperty("topology", out _) ? JsonRules.Integer(root, "topology") : 0, notice, kind != "none");
  }
  private static bool Boolean(JsonElement value, string key)
  {
    var field = value.GetProperty(key); HostError.Require(field.ValueKind is JsonValueKind.True or JsonValueKind.False, "scene-frame", "桌面政策格式無效。");
    return field.GetBoolean();
  }
  private static void Color(JsonElement value)
  {
    var color = JsonRules.Text(value, "color");
    HostError.Require(color.Length == 7 && color[0] == '#' && color.AsSpan(1).ToString().All(Uri.IsHexDigit), "scene-frame", "桌面色彩格式無效。");
  }
  public static LogicalRect Rect(JsonElement value)
  {
    double Number(string key)
    {
      HostError.Require(value.TryGetProperty(key, out var field) && field.TryGetDouble(out var number) && double.IsFinite(number), "scene-frame", "桌面位置無效。");
      return field.GetDouble();
    }
    var x = Number("x"); var y = Number("y"); var width = Number("width"); var height = Number("height");
    HostError.Require(width > 0 && height > 0, "scene-frame", "桌面位置或尺寸無效。");
    return new(x, y, width, height);
  }
  private static void Fields(JsonElement value, string allowed)
  {
    HostError.Require(value.ValueKind == JsonValueKind.Object, "scene-frame", "桌面畫面格式無效。");
    var names = allowed.Split(' ').ToHashSet(StringComparer.Ordinal);
    HostError.Require(value.EnumerateObject().All(field => names.Contains(field.Name)), "scene-frame", "桌面畫面含非呈現資料。");
  }
}
