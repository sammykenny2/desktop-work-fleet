import Foundation

/// Text the Apple hosts draw themselves: the menu bar and app menus, alerts, the Share Extension sheet, and reasons the
/// page shows as they are. Error replies to the page stay English; the page has catalog text for their codes.
/// docs/i18n.md describes the two blocks below, which tests/i18n.test.js compares: one entry per line, the same keys
/// and {name} placeholders in both.
enum FleetText {
    static let preferences = ["auto", "en", "zh-TW"]

    // i18n:en
    static let en: [String: String] = [
        "menuBar.open": "Open Work Fleet",
        "menuBar.quickCapture": "Quick capture",
        "menuBar.adjustAll": "Adjust all groups",
        "menuBar.toggleDesktop": "Show or hide desktop notes",
        "menuBar.checkUpdates": "Check for updates…",
        "menuBar.quit": "Save and quit",
        "menu.quit": "Save and quit Work Fleet",
        "menu.edit": "Edit",
        "menu.undo": "Undo",
        "menu.cut": "Cut",
        "menu.copy": "Copy",
        "menu.paste": "Paste",
        "menu.selectAll": "Select all",
        "dialog.ok": "OK",
        "dialog.close": "Close",
        "dialog.openFailed": "Couldn't open the secure workspace.",
        "dialog.openFailedRetry": "Couldn't open the secure workspace. Keep the app's data and try again.",
        "dialog.alreadyOpen": "This workspace is already open in another Work Fleet window.",
        "dialog.newerData": "This data uses a newer format. Update Work Fleet.",
        "dialog.viewStopped": "The window's content stopped. The last saved data is kept; reopen Work Fleet.",
        "dialog.updateTitle": "Work Fleet update",
        "dialog.upToDate": "Work Fleet {version} is up to date.",
        "dialog.updateFailed": "The update didn't finish. Try again later.",
        "reason.loginItemUnknown": "macOS reported an unknown login item state. Check Login Items in System Settings.",
        "reason.updateNoSource": "This version has no update source.",
        "reason.updateNoKey": "This version has no update signing key, so it can't update in the app.",
        "reason.updateNeedsDeveloperId": "Only versions signed with Developer ID can update in the app.",
        "update.rateLimited": "GitHub is limiting requests for now. Try again later.",
        "update.providerRejected": "GitHub returned an error ({status}). Try again later.",
        "update.offline": "Couldn't connect to GitHub. Check your network and try again.",
        "update.installFailed": "The update didn't finish: {detail}",
        "update.invalidFeed": "The update information isn't in the expected format. Nothing was downloaded.",
        "update.noPlatformRelease": "The update source lists no version for this platform. Check the Releases page.",
        "desktop.displaysUnreadable": "Couldn't read the current displays. Your data and edited text are kept; retry desktop notes from the main window.",
        "desktop.viewLost": "A desktop notes view stopped. The last confirmed draft is kept in the main window.",
        "share.title": "Share to Work Fleet",
        "share.hint": "Shared content goes to the Share inbox first. Open the app to choose a group for it.",
        "share.save": "Save to inbox",
        "share.cancel": "Cancel",
        "share.cancelled": "Sharing was cancelled.",
        "share.saving": "Saving shared content…",
        "share.notSaved": "The shared content wasn't saved. Keep the original and try again.",
        "share.inboxUnavailable": "The Share inbox isn't available right now. Unlock the device and try again.",
        "share.inboxFull": "The Share inbox is full. Receive or discard items in Work Fleet first.",
        "share.overLimit": "Shared content is over the limit of 256 KiB of text, 16 files or 25 MiB.",
        "share.tooManyItems": "You can share up to 16 items at a time.",
        "share.textTooLong": "Shared text is over 256 KiB.",
        "share.textUnreadable": "Couldn't read the shared text.",
        "share.linkUnsupported": "This kind of link can't be shared.",
        "share.formatUnsupported": "This kind of content can't be shared.",
        "share.fileUnreadable": "Couldn't read the shared file.",
        "share.fileLocation": "The shared file's location isn't valid.",
        "share.filesTooLarge": "Shared files are over 25 MiB in total.",
        "share.filesTooLargeOrUnsupported": "Shared files are over 25 MiB in total, or their format isn't supported.",
        "share.damagedPreview": "This shared item can't be read",
    ]
    // i18n:end

    // i18n:zh-TW
    static let zhTW: [String: String] = [
        "menuBar.open": "開啟 Work Fleet",
        "menuBar.quickCapture": "快速記錄",
        "menuBar.adjustAll": "調整所有群組",
        "menuBar.toggleDesktop": "顯示／隱藏桌面便箋",
        "menuBar.checkUpdates": "檢查更新…",
        "menuBar.quit": "保存並結束",
        "menu.quit": "保存並結束 Work Fleet",
        "menu.edit": "編輯",
        "menu.undo": "復原",
        "menu.cut": "剪下",
        "menu.copy": "拷貝",
        "menu.paste": "貼上",
        "menu.selectAll": "全選",
        "dialog.ok": "確定",
        "dialog.close": "關閉",
        "dialog.openFailed": "無法開啟安全工作空間。",
        "dialog.openFailedRetry": "無法開啟安全工作空間，請保留 App 資料並重試。",
        "dialog.alreadyOpen": "工作空間已在另一個 Work Fleet 視窗開啟。",
        "dialog.newerData": "資料格式較新，請更新 Work Fleet。",
        "dialog.viewStopped": "畫面程序已停止；最後已保存的資料仍保留，請重新開啟。",
        "dialog.updateTitle": "Work Fleet 更新",
        "dialog.upToDate": "Work Fleet {version} 已是最新版本。",
        "dialog.updateFailed": "更新沒有完成，請稍後再試。",
        "reason.loginItemUnknown": "macOS 回報未知的登入項目狀態，請到系統設定的「登入項目」確認。",
        "reason.updateNoSource": "這個版本沒有設定更新來源。",
        "reason.updateNoKey": "這個版本沒有更新簽章公鑰，無法使用 App 內更新。",
        "reason.updateNeedsDeveloperId": "只有以 Developer ID 簽章的版本支援 App 內更新。",
        "update.rateLimited": "GitHub 暫時限制查詢次數，請稍後再試。",
        "update.providerRejected": "GitHub 回應錯誤（{status}），請稍後再試。",
        "update.offline": "無法連線到 GitHub，請確認網路後再試。",
        "update.installFailed": "更新沒有完成：{detail}",
        "update.invalidFeed": "更新資訊格式不符，未下載任何檔案。",
        "update.noPlatformRelease": "來源未列出這個平台的版本，請至 Releases 頁面確認。",
        "desktop.displaysUnreadable": "無法讀取目前螢幕，已保留資料與編輯文字；請在主畫面重試桌面呈現。",
        "desktop.viewLost": "桌面畫面程序已停止，最後確認的草稿仍保留於主畫面。",
        "share.title": "分享至 Work Fleet",
        "share.hint": "內容先保存至分享收件匣，開啟 App 後選擇群組接收。",
        "share.save": "保存到收件匣",
        "share.cancel": "取消",
        "share.cancelled": "已取消分享。",
        "share.saving": "正在保存分享內容…",
        "share.notSaved": "分享內容尚未保存，請保留原檔後重試。",
        "share.inboxUnavailable": "分享收件匣目前無法使用，請解鎖裝置後重試。",
        "share.inboxFull": "分享收件匣已滿，請先接收或捨棄既有項目。",
        "share.overLimit": "分享內容超過 256 KiB 文字／16 個檔案／25 MiB 容量。",
        "share.tooManyItems": "一次最多分享 16 個項目。",
        "share.textTooLong": "分享文字超過 256 KiB。",
        "share.textUnreadable": "無法讀取分享文字。",
        "share.linkUnsupported": "分享網址格式不支援。",
        "share.formatUnsupported": "此分享內容格式不支援。",
        "share.fileUnreadable": "無法讀取分享檔案。",
        "share.fileLocation": "分享檔案位置無效。",
        "share.filesTooLarge": "分享檔案總容量超過 25 MiB。",
        "share.filesTooLargeOrUnsupported": "分享檔案總容量超過 25 MiB 或格式不支援。",
        "share.damagedPreview": "分享內容無法讀取",
    ]
    // i18n:end

    /// One BCP 47 tag or POSIX locale name to a supported locale, or nil; the same rules as matchLocale in
    /// src/i18n/index.js. Traditional or unmarked Chinese is zh-TW; Simplified Chinese is not supported yet.
    static func match(_ tag: String) -> String? {
        var value = tag.trimmingCharacters(in: .whitespacesAndNewlines)
        if let end = value.firstIndex(where: { $0 == "." || $0 == "@" }) { value = String(value[..<end]) }
        value = value.replacingOccurrences(of: "_", with: "-").lowercased()
        if value == "en" || value.hasPrefix("en-") { return "en" }
        let chinese = ["zh", "zh-tw", "zh-hant", "zh-hk", "zh-mo"], prefixes = ["zh-tw-", "zh-hant-", "zh-hk-", "zh-mo-"]
        if chinese.contains(value) || prefixes.contains(where: { value.hasPrefix($0) }) { return "zh-TW" }
        return nil
    }
    /// A pinned preference wins; auto takes the first system language that matches, and nothing matching means English.
    static func resolve(_ preference: String, _ languages: [String]) -> String {
        if preference == "en" || preference == "zh-TW" { return preference }
        for tag in languages { if let locale = match(tag) { return locale } }
        return "en"
    }
    /// The system's preferred UI languages, most preferred first, as BCP 47 tags.
    static var system: [String] { Locale.preferredLanguages }

    private static let lock = NSLock()
    nonisolated(unsafe) private static var chosen = "auto"
    nonisolated(unsafe) private static var resolved = "en"
    /// The applied preference: auto, en or zh-TW.
    static var preference: String { lock.lock(); defer { lock.unlock() }; return chosen }
    /// The locale of host-drawn text: en or zh-TW.
    static var locale: String { lock.lock(); defer { lock.unlock() }; return resolved }
    /// Hosts apply the stored preference before drawing anything, and again after host.language.set. Unknown values are auto.
    static func apply(_ preference: String) {
        let value = preferences.contains(preference) ? preference : "auto", next = resolve(value, system)
        lock.lock(); chosen = value; resolved = next; lock.unlock()
    }
    /// The language object of host.info and the host.language.set reply.
    static func describe() -> [String: Any] { ["preference": preference, "system": system] }
    /// The text for a key in the host locale with {name} values filled in; a missing key falls back to English, then the key.
    static func text(_ key: String, _ values: [String: String] = [:]) -> String {
        var text = (locale == "zh-TW" ? zhTW[key] : nil) ?? en[key] ?? key
        for (name, value) in values { text = text.replacingOccurrences(of: "{" + name + "}", with: value) }
        return text
    }

    /// Failures a host dialog shows in the host locale. Any other failure keeps its English message; anything that is not
    /// a FleetFailure shows the fallback key's text.
    private static let dialogs = ["native-already-open": "dialog.alreadyOpen", "storage-version": "dialog.newerData", "native-view": "dialog.viewStopped"]
    static func dialog(_ error: Error, fallback: String) -> String {
        guard let failure = error as? FleetFailure else { return text(fallback) }
        if let key = dialogs[failure.code] { return text(key) }
        return failure.message
    }

    #if os(iOS)
    /// iOS keeps the preference in the app's user defaults and mirrors it into the App Group's defaults, which the Share
    /// Extension reads so its sheet matches the app. Without an App Group the extension follows the system languages.
    private static let storageKey = "language"
    private static var shared: UserDefaults? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FleetCaptureAppGroup") as? String, !group.isEmpty else { return nil }
        return UserDefaults(suiteName: group)
    }
    static func storedPreference() -> String { shared?.string(forKey: storageKey) ?? UserDefaults.standard.string(forKey: storageKey) ?? "auto" }
    static func store(_ preference: String) { UserDefaults.standard.set(preference, forKey: storageKey); shared?.set(preference, forKey: storageKey) }
    #endif
}
