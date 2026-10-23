using System.Globalization;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace WorkFleet.Windows.Core;

/// <summary>
/// Text the Windows host draws itself (tray, dialogs, picker titles, fatal-error text) and descriptive text it returns for
/// the page, in the host's display language. The language rules repeat matchLocale/resolveLocale in src/i18n/index.js
/// (docs/i18n.md); tests/i18n.test.js checks that the two tables below have the same keys and placeholders.
/// Error replies to the page stay English HostError messages; the page shows its own catalog text for their codes.
/// </summary>
public static partial class HostText
{
  public const string DefaultLocale = "en";
  public static IReadOnlyList<string> Locales { get; } = ["en", "zh-TW"];
  /// <summary>"auto" follows the system languages; the others pin a locale. Stored per data directory in host-preferences.json.</summary>
  public static IReadOnlyList<string> Preferences { get; } = ["auto", .. Locales];

  private sealed record State(string Preference, IReadOnlyList<string> System, string Locale);
  private static readonly object gate = new();
  private static volatile State state = Start();
  /// <summary>Raised on the thread that called Apply when the resolved locale changes; listeners redraw host-drawn text.</summary>
  public static event Action? Changed;

  public static string Preference => state.Preference;
  /// <summary>The Windows display languages, most preferred first, as last read by Apply.</summary>
  public static IReadOnlyList<string> System => state.System;
  public static string Locale => state.Locale;
  /// <summary>The host.info `language` value and the host.language.set reply.</summary>
  public static object Describe() { var current = state; return new { preference = current.Preference, system = current.System }; }

  public static bool ValidPreference(string? value) => value is not null && Preferences.Contains(value, StringComparer.Ordinal);

  /// <summary>
  /// One BCP 47 tag or POSIX locale name to a supported locale, or null. English variants map to en; Traditional or
  /// unmarked Chinese (zh, zh-TW, zh-Hant, zh-HK, zh-MO) maps to zh-TW; Simplified Chinese is not supported yet.
  /// </summary>
  public static string? Match(string? tag)
  {
    if (tag is null) return null;
    var value = PosixSuffix().Replace(tag.Trim(), "").Replace('_', '-').ToLowerInvariant();
    if (value == "en" || value.StartsWith("en-", StringComparison.Ordinal)) return "en";
    if (value is "zh" or "zh-tw" or "zh-hant" or "zh-hk" or "zh-mo"
      || new[] { "zh-tw-", "zh-hant-", "zh-hk-", "zh-mo-" }.Any(prefix => value.StartsWith(prefix, StringComparison.Ordinal))) return "zh-TW";
    return null;
  }

  /// <summary>A pinned locale wins; "auto" (or anything unknown) takes the first matching system language, else English.</summary>
  public static string Resolve(string? preference, IEnumerable<string?>? languages)
  {
    if (preference is not null && Locales.Contains(preference, StringComparer.Ordinal)) return preference;
    foreach (var tag in languages ?? []) if (Match(tag) is { } locale) return locale;
    return DefaultLocale;
  }

  /// <summary>Stores the preference for this process and re-resolves the locale against freshly read system languages.</summary>
  public static void Apply(string? preference, IReadOnlyList<string>? system = null)
  {
    bool changed;
    lock (gate)
    {
      var value = ValidPreference(preference) ? preference! : "auto";
      var languages = system ?? SystemLanguages();
      var next = new State(value, languages, Resolve(value, languages));
      changed = next.Locale != state.Locale; state = next;
    }
    if (changed) Changed?.Invoke();
  }

  /// <summary>The text for the key in the host locale, with {name} placeholders filled; English when a key is missing.</summary>
  public static string Get(string key, params (string Name, object? Value)[] values) => Format(Locale, key, values);
  public static string Format(string locale, string key, params (string Name, object? Value)[] values)
  {
    var text = (locale == "zh-TW" ? TraditionalChinese : English).TryGetValue(key, out var found) ? found
      : English.TryGetValue(key, out var fallback) ? fallback : key;
    if (values.Length == 0) return text;
    return Placeholder().Replace(text, match =>
    {
      foreach (var (name, value) in values)
        if (name == match.Groups[1].Value && value is not null) return Convert.ToString(value, CultureInfo.InvariantCulture) ?? "";
      return match.Value;
    });
  }
  public static IReadOnlyDictionary<string, string> Table(string locale) => locale == "zh-TW" ? TraditionalChinese : English;

  /// <summary>The user's Windows display-language list; the current UI culture when Windows does not report one.</summary>
  public static IReadOnlyList<string> SystemLanguages()
  {
    try
    {
      uint size = 0;
      if (GetUserPreferredUILanguages(MuiLanguageName, out _, null, ref size) && size is > 0 and <= 4096)
      {
        var buffer = new char[size];
        if (GetUserPreferredUILanguages(MuiLanguageName, out _, buffer, ref size))
        {
          var tags = new string(buffer, 0, (int)Math.Min(size, (uint)buffer.Length)).Split('\0', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
          if (tags.Length > 0) return tags.Take(32).ToArray();
        }
      }
    }
    catch (Exception error) when (error is DllNotFoundException or EntryPointNotFoundException) { }
    var culture = CultureInfo.CurrentUICulture.Name;
    return culture.Length > 0 ? [culture] : [];
  }
  private static State Start()
  {
    var languages = SystemLanguages(); return new("auto", languages, Resolve("auto", languages));
  }
  private const uint MuiLanguageName = 0x8;
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetUserPreferredUILanguages(uint flags, out uint count, char[]? buffer, ref uint size);
  [GeneratedRegex(@"[.@].*\z")] private static partial Regex PosixSuffix();
  [GeneratedRegex(@"\{([A-Za-z0-9_]+)\}")] private static partial Regex Placeholder();

  // One entry per line: the key, then its text. Both tables keep the same keys and {name} placeholders.
  private static readonly Dictionary<string, string> English = new(StringComparer.Ordinal)
  {
    // i18n:en
    ["tray.tip"] = "Work Fleet · Capture and desktop notes",
    ["tray.tipDownloading"] = "Work Fleet · Downloading update {percent}%",
    ["tray.openMain"] = "Open main window",
    ["tray.quickCapture"] = "Quick capture",
    ["tray.adjustAll"] = "Adjust all notes",
    ["tray.finishAdjusting"] = "Done adjusting",
    ["tray.toggleDesktop"] = "Show or hide desktop notes",
    ["tray.hideMain"] = "Hide main window",
    ["tray.checkUpdates"] = "Check for updates…",
    ["tray.quit"] = "Save and quit Work Fleet",
    ["window.openFailed"] = "Work Fleet could not open its workspace. Make sure the WebView2 Runtime is installed, keep your data as it is and try again.",
    ["window.rendererStopped"] = "The window's display process stopped. Saved data is still on this device; reopen Work Fleet.",
    ["window.switchFailed"] = "Switching accounts did not finish. Saved data is kept; reopen Work Fleet.",
    ["dialog.backupFolderTitle"] = "Choose a backup folder (local NTFS; each backup is a new file)",
    ["dialog.separateData"] = "Found separate local data from an earlier, ZIP or Debug version. This MSIX keeps its own data: export a backup from the earlier or ZIP version first, then import it here. The original data is not deleted.",
    ["dialog.startFailed"] = "Work Fleet could not open the local workspace. Make sure the WebView2 Runtime is installed, keep your data as it is and try again.",
    ["dialog.alreadyOpen"] = "This data location is already open in another Work Fleet window. Use that window.",
    ["dialog.newerDatabase"] = "The database is from a newer version. Update Work Fleet.",
    ["dialog.packageDataUnknown"] = "Windows did not report where this app keeps its data. Keep your data as it is and try again.",
    ["dialog.updateTitle"] = "Work Fleet update",
    ["dialog.updateAvailable"] = "Version {version} is available (you have {current}).\n\nUpdate and restart Work Fleet now? Unsaved text is saved first.",
    ["dialog.updateAvailableSummary"] = "Version {version} is available (you have {current}).\n\n{summary}\n\nUpdate and restart Work Fleet now? Unsaved text is saved first.",
    ["dialog.upToDate"] = "Work Fleet {version} is up to date.",
    ["dialog.installFailed"] = "The update did not finish. Work Fleet will reopen; saved data is not affected.\n\n{detail}",
    ["reason.startupUnreadable"] = "Windows can't read the start-at-sign-in setting right now.",
    ["reason.startupNeedsMsix"] = "Only the installed version (MSIX) can start at sign-in.",
    ["reason.updatesNeedMsix"] = "Only the installed version (MSIX) supports in-app updates.",
    ["reason.updatesNoSource"] = "This version has no update source.",
    ["update.failed"] = "The update didn't finish. Try again later.",
    ["update.busy"] = "The update can't be installed right now.",
    ["update.notReady"] = "No update has been downloaded yet.",
    ["update.closeDialogsFirst"] = "Finish or close the open dialog and edits first, then install the update.",
    ["update.timeout"] = "The connection timed out. Try again later.",
    ["update.offline"] = "Can't reach GitHub. Check your network and try again.",
    ["update.saveFailed"] = "Couldn't save the downloaded update. Check your disk space and try again.",
    ["update.invalidMetadata"] = "The update information is not in the expected format; nothing was downloaded.",
    ["update.invalidChannel"] = "The update information is not in the expected format; nothing was downloaded. This update channel is not supported.",
    ["update.releaseMissing"] = "The update information is not in the expected format; nothing was downloaded. The source lists no Work Fleet version; check the Releases page.",
    ["update.invalidFileName"] = "The update information is not in the expected format; nothing was downloaded. The download file name is invalid.",
    ["update.architectureMissing"] = "The update information is not in the expected format; nothing was downloaded. There is no installer for this architecture.",
    ["update.invalidDownloadUrl"] = "The update information has an invalid download location.",
    ["update.metadataTooLarge"] = "The update information is too large.",
    ["update.sizeMismatch"] = "The downloaded file has the wrong size and was deleted.",
    ["update.checksumMismatch"] = "The downloaded file does not match the update information and was deleted.",
    ["update.changed"] = "The downloaded update has changed. Download it again.",
    ["update.otherApp"] = "The downloaded installer is for another app and was not installed.",
    ["update.versionMismatch"] = "The downloaded installer has the wrong version or architecture and was not installed.",
    ["update.identityMissing"] = "The downloaded installer has no package identity and was not installed.",
    ["update.identityInvalid"] = "The downloaded installer has an invalid package identity and was not installed.",
    ["update.notInstaller"] = "The downloaded file is not a valid installer and was not installed.",
    ["update.locationRejected"] = "The update source pointed to a location that is not allowed, so the update stopped.",
    ["update.redirected"] = "The update source redirected, so the update stopped.",
    ["update.tooManyRedirects"] = "The update source redirected too many times, so the update stopped.",
    ["update.rateLimited"] = "GitHub is limiting requests for now. Try again later.",
    ["update.providerError"] = "GitHub returned an error ({status}). Try again later.",
    ["desktop.windowTitle"] = "Work Fleet desktop",
    ["desktop.displaysUnreadable"] = "Can't read the displays right now. Your data and edits are kept; retrying.",
    ["desktop.shellRestarted"] = "The desktop host restarted. Rebuilding the desktop notes; your data is kept.",
    ["desktop.sceneStartFailed"] = "A desktop window could not start. Saved data is still in the main window.",
    ["desktop.sceneStopped"] = "A desktop window's display process stopped. The last confirmed draft is kept; continue in the main window.",
    ["backup.folderName"] = "Backup folder",
    ["dataFailure.title"] = "Work Fleet can't open your notes",
    ["dataFailure.data-damaged"] = "The local data is damaged.",
    ["dataFailure.data-full"] = "The disk is full. Free some space, then start Work Fleet again.",
    ["dataFailure.data-in-use"] = "Another program is using the local data. Close it, for example a backup or sync tool, then start Work Fleet again.",
    ["dataFailure.data-denied"] = "Windows doesn't let Work Fleet open its data folder. Check the folder's permissions, then start Work Fleet again.",
    ["dataFailure.data-key"] = "The local data can't be decrypted under this Windows account. It can be read only by the Windows account, on the PC, that used Work Fleet before.",
    ["dataFailure.data-unreadable"] = "Work Fleet couldn't open the local data, and it can't tell why.",
    ["dataFailure.folder"] = "The data is in this folder:",
    ["dataFailure.openFolder"] = "Open folder",
    ["dataFailure.setAside"] = "Set aside and start again…",
    ["dataFailure.close"] = "Close",
    ["dataFailure.confirm"] = "Set the local data aside and start with empty data?\n\nThe database moves into a dated \"set-aside\" folder inside the data folder; nothing is deleted.\n\nGoogle workspaces get their notes, groups and attachments back from Drive after you sign in again. This PC's desktop positions, colours, shortcuts and drafts not yet synced stay only in the set-aside copy. The local workspace comes back only by restoring a backup ZIP.",
    ["dataFailure.setAsideFailed"] = "The data couldn't be set aside, and nothing was deleted. Close other programs that use it and try again.",
    ["dataFailure.setAsideIncomplete"] = "Part of the local data moved into a set-aside folder and couldn't be put back. Nothing was deleted. Move those files back into the data folder before starting Work Fleet again.",
    // i18n:end
  };

  private static readonly Dictionary<string, string> TraditionalChinese = new(StringComparer.Ordinal)
  {
    // i18n:zh-TW
    ["tray.tip"] = "Work Fleet · 記錄與桌面便箋",
    ["tray.tipDownloading"] = "Work Fleet · 下載更新 {percent}%",
    ["tray.openMain"] = "開啟主畫面",
    ["tray.quickCapture"] = "快速記錄",
    ["tray.adjustAll"] = "調整所有便箋",
    ["tray.finishAdjusting"] = "完成調整",
    ["tray.toggleDesktop"] = "顯示／隱藏桌面便箋",
    ["tray.hideMain"] = "收起主畫面",
    ["tray.checkUpdates"] = "檢查更新…",
    ["tray.quit"] = "保存並結束 Work Fleet",
    ["window.openFailed"] = "無法開啟原生工作空間。請確認 WebView2 Runtime 已安裝，並保留原資料後重試。",
    ["window.rendererStopped"] = "畫面程序已停止。已提交資料仍保留於本機；請重新開啟 Work Fleet。",
    ["window.switchFailed"] = "帳號切換未完成。已保存資料仍保留，請重新開啟 Work Fleet。",
    ["dialog.backupFolderTitle"] = "選擇備份資料夾（本機 NTFS；每次建立新檔）",
    ["dialog.separateData"] = "找到舊版或 ZIP／Debug 版的獨立本機資料。本次 MSIX 使用自己的資料區；請先以舊版或 ZIP 版匯出備份，再於此版本匯入。原資料不會被刪除。",
    ["dialog.startFailed"] = "Work Fleet 無法開啟本機工作空間。請確認 WebView2 Runtime 已安裝，並保留原資料後重試。",
    ["dialog.alreadyOpen"] = "此資料位置已在另一個 Work Fleet 視窗開啟。請使用原視窗。",
    ["dialog.newerDatabase"] = "資料庫版本較新，請更新 Work Fleet。",
    ["dialog.packageDataUnknown"] = "無法確認 Windows 套件資料位置，請保留原資料後重試。",
    ["dialog.updateTitle"] = "Work Fleet 更新",
    ["dialog.updateAvailable"] = "有新版本 {version}（目前 {current}）。\n\n要現在更新並重新啟動 Work Fleet 嗎？未保存的文字會先保存。",
    ["dialog.updateAvailableSummary"] = "有新版本 {version}（目前 {current}）。\n\n{summary}\n\n要現在更新並重新啟動 Work Fleet 嗎？未保存的文字會先保存。",
    ["dialog.upToDate"] = "Work Fleet {version} 已是最新版本。",
    ["dialog.installFailed"] = "更新沒有完成，Work Fleet 會重新開啟；已保存的資料不受影響。\n\n{detail}",
    ["reason.startupUnreadable"] = "Windows 目前無法讀取登入啟動設定。",
    ["reason.startupNeedsMsix"] = "只有安裝版（MSIX）支援登入時啟動。",
    ["reason.updatesNeedMsix"] = "只有安裝版（MSIX）支援 App 內更新。",
    ["reason.updatesNoSource"] = "這個版本沒有設定更新來源。",
    ["update.failed"] = "更新沒有完成，請稍後再試。",
    ["update.busy"] = "目前不能安裝更新。",
    ["update.notReady"] = "還沒有下載好的更新。",
    ["update.closeDialogsFirst"] = "請先完成或關閉目前的對話框與編輯，再安裝更新。",
    ["update.timeout"] = "連線逾時，請稍後再試。",
    ["update.offline"] = "無法連線到 GitHub，請確認網路後再試。",
    ["update.saveFailed"] = "無法保存下載的更新，請確認磁碟空間後再試。",
    ["update.invalidMetadata"] = "更新資訊格式不符，未下載任何檔案。",
    ["update.invalidChannel"] = "更新資訊格式不符，未下載任何檔案。不支援這個更新頻道。",
    ["update.releaseMissing"] = "更新資訊格式不符，未下載任何檔案。來源未列出任何 Work Fleet 版本，請至 Releases 頁面確認。",
    ["update.invalidFileName"] = "更新資訊格式不符，未下載任何檔案。下載檔名無效。",
    ["update.architectureMissing"] = "更新資訊格式不符，未下載任何檔案。沒有這個架構的安裝檔。",
    ["update.invalidDownloadUrl"] = "更新資訊的下載位置無效。",
    ["update.metadataTooLarge"] = "更新資訊超過容量上限。",
    ["update.sizeMismatch"] = "下載的檔案大小不符，已刪除。",
    ["update.checksumMismatch"] = "下載的檔案與更新資訊不符，已刪除。",
    ["update.changed"] = "下載的更新已變更，請重新下載。",
    ["update.otherApp"] = "下載的安裝檔不是這個 App，未安裝。",
    ["update.versionMismatch"] = "下載的安裝檔版本或架構不符，未安裝。",
    ["update.identityMissing"] = "下載的安裝檔缺少套件身分，未安裝。",
    ["update.identityInvalid"] = "下載的安裝檔套件身分無效，未安裝。",
    ["update.notInstaller"] = "下載的檔案不是有效的安裝檔，未安裝。",
    ["update.locationRejected"] = "更新來源指向未允許的位置，已停止。",
    ["update.redirected"] = "更新來源轉址，已停止。",
    ["update.tooManyRedirects"] = "更新來源轉址次數過多，已停止。",
    ["update.rateLimited"] = "GitHub 暫時限制查詢次數，請稍後再試。",
    ["update.providerError"] = "GitHub 回應錯誤（{status}），請稍後再試。",
    ["desktop.windowTitle"] = "Work Fleet 桌面",
    ["desktop.displaysUnreadable"] = "目前無法讀取顯示器，已保留資料及編輯文字；正在重試。",
    ["desktop.shellRestarted"] = "桌面宿主已重新啟動，正在重新建立便箋畫面；資料保留。",
    ["desktop.sceneStartFailed"] = "桌面視窗未能啟動，已保存資料仍保留於主畫面。",
    ["desktop.sceneStopped"] = "桌面畫面程序已停止。最後確認的草稿仍保留，請在主畫面繼續。",
    ["backup.folderName"] = "備份資料夾",
    ["dataFailure.title"] = "Work Fleet 無法開啟你的便箋",
    ["dataFailure.data-damaged"] = "本機資料已損壞。",
    ["dataFailure.data-full"] = "磁碟已滿。請先清出一些空間，再重新啟動 Work Fleet。",
    ["dataFailure.data-in-use"] = "另一個程式正在使用本機資料。請先關閉它（例如備份或同步工具），再重新啟動 Work Fleet。",
    ["dataFailure.data-denied"] = "Windows 不允許 Work Fleet 開啟資料夾。請檢查資料夾權限，再重新啟動 Work Fleet。",
    ["dataFailure.data-key"] = "本機資料無法在這個 Windows 帳號下解密。只有之前使用 Work Fleet 的那台電腦、那個 Windows 帳號才能讀取。",
    ["dataFailure.data-unreadable"] = "Work Fleet 無法開啟本機資料，也無法判斷原因。",
    ["dataFailure.folder"] = "資料在這個資料夾：",
    ["dataFailure.openFolder"] = "開啟資料夾",
    ["dataFailure.setAside"] = "移到一旁並重新開始…",
    ["dataFailure.close"] = "關閉",
    ["dataFailure.confirm"] = "要把本機資料移到一旁，從空白資料重新開始嗎？\n\n資料庫會移到資料夾內一個標有日期的「set-aside」資料夾，不會刪除任何東西。\n\nGoogle 工作空間重新登入後，便箋、群組與附件會從 Drive 回來；這台電腦的桌面位置、顏色、快捷鍵與尚未同步的草稿只留在移到一旁的副本裡。本機工作空間只能從備份 ZIP 還原。",
    ["dataFailure.setAsideFailed"] = "資料無法移到一旁，也沒有刪除任何東西。請關閉正在使用它的程式後再試一次。",
    ["dataFailure.setAsideIncomplete"] = "部分本機資料已移到 set-aside 資料夾，卻沒能移回來。沒有刪除任何東西。請先把那些檔案移回資料夾，再啟動 Work Fleet。",
    // i18n:end
  };
}
