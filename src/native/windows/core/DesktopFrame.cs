using System.Text.Json;

namespace WorkFleet.Windows.Core;

public sealed record LogicalRect(double X, double Y, double Width, double Height);
public sealed record PresentedCard(string Id, string Layer, LogicalRect Rect, bool Interactive, bool Operable);

/// <summary>Native input regions are derived only from a complete, validated owner projection. A stage notice only
/// keeps the topmost scene visible; it never becomes an input region. While adjusting, the topmost scene is the
/// modal adjust overlay.</summary>
public sealed partial record DesktopFrame(long Sequence, IReadOnlyList<PresentedCard> Cards, long Topology = 0, LogicalRect? Notice = null, bool Adjusting = false)
{
  public static DesktopFrame Parse(ReadOnlyMemory<byte> bytes, string sessionId, long previous)
  {
    using var document = JsonRules.Parse(bytes); var root = document.RootElement;
    Fields(root, "protocol sessionId sequence topology workspaceRevision layoutRevision groups operationScope activeGroupId cards editor dropTarget fallbacks notice locale");
    // The main window's UI locale, which the scene applies before drawing (docs/i18n.md); only a short language tag.
    if (root.TryGetProperty("locale", out var locale))
      HostError.Require(locale.ValueKind == JsonValueKind.String && LocaleTag().IsMatch(locale.GetString()!), "scene-frame", "The desktop frame locale is invalid.");
    HostError.Require(JsonRules.Integer(root, "protocol") == 1 && JsonRules.Text(root, "sessionId") == sessionId,
      "scene-session", "The desktop frame belongs to an earlier session.");
    var sequence = JsonRules.Integer(root, "sequence");
    HostError.Require(sequence > previous, "scene-order", "The desktop frame is out of date.");
    _ = JsonRules.Integer(root, "workspaceRevision"); _ = JsonRules.Integer(root, "layoutRevision");
    var scope = root.GetProperty("operationScope"); Fields(scope, "kind groupId");
    var kind = JsonRules.Text(scope, "kind");
    HostError.Require(kind is "none" or "group" or "all", "scene-frame", "The desktop adjust scope is invalid.");
    // Imported/concurrent groups beyond the formation limit remain visible until the user merges them.
    HostError.Require(root.GetProperty("groups").ValueKind == JsonValueKind.Array && root.GetProperty("groups").GetArrayLength() <= 20000,
      "scene-frame", "The desktop groups are malformed.");
    foreach (var group in root.GetProperty("groups").EnumerateArray())
    {
      Fields(group, "id name color region"); _ = JsonRules.Text(group, "id", 128); _ = JsonRules.Text(group, "name", SceneTransfers.MaxFrame);
      Color(group);
      if (group.GetProperty("region").ValueKind != JsonValueKind.Null) _ = Rect(group.GetProperty("region"));
    }
    var values = root.GetProperty("cards");
    HostError.Require(values.ValueKind == JsonValueKind.Array && values.GetArrayLength() <= 20000, "scene-frame", "The desktop note count is invalid.");
    var cards = new List<PresentedCard>(); var ids = new HashSet<string>(StringComparer.Ordinal);
    foreach (var card in values.EnumerateArray())
    {
      Fields(card, "id groupId revision summary text format attachmentCount attachments rect layer interactive draggable editing selected completed mine color");
      if (card.TryGetProperty("attachments", out var attachments))
      {
        HostError.Require(attachments.ValueKind == JsonValueKind.Array && attachments.GetArrayLength() <= 20000, "scene-frame", "The attachment list is malformed.");
        foreach (var file in attachments.EnumerateArray()) { Fields(file, "id name"); _ = JsonRules.Text(file, "id", 128); _ = JsonRules.Text(file, "name", LocalDatabase.MaxRecord); }
      }
      var id = JsonRules.Text(card, "id", 128); var layer = JsonRules.Text(card, "layer");
      HostError.Require(ids.Add(id) && layer is "desktop" or "floating" or "wallpaper", "scene-frame", "A desktop note has an invalid ID or layer.");
      _ = JsonRules.Text(card, "groupId", 128); Color(card);
      HostError.Require(card.GetProperty("text").ValueKind == JsonValueKind.String && card.GetProperty("text").GetString()!.Length <= 8 * 1024 * 1024,
        "scene-frame", "The desktop note text is too large.");
      foreach (var flag in new[] { "interactive", "draggable", "editing", "selected", "completed", "mine" }) _ = Boolean(card, flag);
      HostError.Require(layer != "wallpaper" || !Boolean(card, "interactive") && !Boolean(card, "draggable") && !Boolean(card, "editing"),
        "scene-frame", "Wallpaper layer notes must let the mouse pass through. Adjust this group before editing.");
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
    var field = value.GetProperty(key); HostError.Require(field.ValueKind is JsonValueKind.True or JsonValueKind.False, "scene-frame", "The desktop note flags are malformed.");
    return field.GetBoolean();
  }
  private static void Color(JsonElement value)
  {
    var color = JsonRules.Text(value, "color");
    HostError.Require(color.Length == 7 && color[0] == '#' && color.AsSpan(1).ToString().All(Uri.IsHexDigit), "scene-frame", "The desktop color is malformed.");
  }
  public static LogicalRect Rect(JsonElement value)
  {
    double Number(string key)
    {
      HostError.Require(value.TryGetProperty(key, out var field) && field.TryGetDouble(out var number) && double.IsFinite(number), "scene-frame", "The desktop position is invalid.");
      return field.GetDouble();
    }
    var x = Number("x"); var y = Number("y"); var width = Number("width"); var height = Number("height");
    HostError.Require(width > 0 && height > 0, "scene-frame", "The desktop position or size is invalid.");
    return new(x, y, width, height);
  }
  [System.Text.RegularExpressions.GeneratedRegex(@"^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}\z")] private static partial System.Text.RegularExpressions.Regex LocaleTag();
  private static void Fields(JsonElement value, string allowed)
  {
    HostError.Require(value.ValueKind == JsonValueKind.Object, "scene-frame", "The desktop frame is malformed.");
    var names = allowed.Split(' ').ToHashSet(StringComparer.Ordinal);
    HostError.Require(value.EnumerateObject().All(field => names.Contains(field.Name)), "scene-frame", "The desktop frame contains data that isn't for display.");
  }
}
