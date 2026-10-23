namespace WorkFleet.Windows.Core;

/// <summary>One tray menu row: an action and its HostText key, or a separator when Action is empty.</summary>
/// <param name="Default">The item the icon's own click runs, drawn bold.</param>
/// <param name="Shortcut">The global shortcut that runs the same action, drawn right-aligned.</param>
public sealed record TrayEntry(string Action, string Text, bool Default = false, string? Shortcut = null)
{
  public static readonly TrayEntry Separator = new("", "");
  public bool IsSeparator => Action.Length == 0;
}

/// <summary>
/// ADR-019: the tray menu for the state it opens in, grouped the way Windows menus are. Opening Work Fleet comes first and
/// bold, as the icon's click does it; hiding follows only while the main window shows. Then the desktop actions, offering
/// either adjusting all notes or finishing an adjustment, then checking for updates, and exiting last.
/// </summary>
public static class TrayMenu
{
  /// <param name="shortcuts">The configured global shortcuts as (key, target, Windows' last answer); only keys Windows
  /// registered are shown, not ones it refused or was not asked about yet.</param>
  public static IReadOnlyList<TrayEntry> Entries(bool mainVisible, bool adjusting, bool updates,
    IEnumerable<(string Key, string Target, string Status)> shortcuts)
  {
    var keys = shortcuts.Where(s => s.Status == "available").ToArray();
    string? Key(string target) => keys.FirstOrDefault(s => s.Target == target).Key;
    var entries = new List<TrayEntry> { new("show", "tray.open", Default: true) };
    if (mainVisible) entries.Add(new("@hide", "tray.hideMain"));
    entries.Add(TrayEntry.Separator);
    entries.Add(new("@capture", "tray.quickCapture", Shortcut: Key("@capture")));
    entries.Add(new("@toggle", "tray.toggleDesktop", Shortcut: Key("@toggle")));
    entries.Add(adjusting ? new("@stop", "tray.finishAdjusting") : new("@all", "tray.adjustAll", Shortcut: Key("@all")));
    entries.Add(TrayEntry.Separator);
    if (updates) { entries.Add(new("update", "tray.checkUpdates")); entries.Add(TrayEntry.Separator); }
    entries.Add(new("exit", "tray.exit"));
    return entries;
  }
  /// <summary>
  /// The Fluent theme the menu draws with: high contrast when it is on, otherwise the Windows mode (SystemUsesLightTheme),
  /// which the taskbar follows, not the app mode. A missing value means light, as in Windows.
  /// </summary>
  public static string Theme(bool highContrast, object? systemUsesLightTheme)
    => highContrast ? "HC" : systemUsesLightTheme is 0 ? "Dark" : "Light";
  /// <summary>
  /// Moves a physical anchor on the taskbar into the work area (right and bottom exclusive), so the menu opens beside the
  /// taskbar, as Windows 11's own menus do, instead of over it.
  /// </summary>
  public static (int X, int Y) Anchor(int x, int y, int left, int top, int right, int bottom)
    => (Math.Clamp(x, left, Math.Max(left, right - 1)), Math.Clamp(y, top, Math.Max(top, bottom - 1)));
}
