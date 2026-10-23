"""Text the Linux host draws itself: tray, dialogs, pickers and the reasons it returns for the page to show.

The display-language preference and its matching rules are the renderer's (matchLocale and resolveLocale in
src/i18n/index.js, docs/i18n.md), so the tray and dialogs always match the window. Each table below sits between
marker comments that tests/i18n.test.js reads; both tables have the same keys and {name} placeholders.
Pure Python, no GTK, so the rules are tested anywhere."""
import os
import re

LOCALES = ("en", "zh-TW")
DEFAULT_LOCALE = "en"
# "auto" follows the system languages; the others pin a locale.
PREFERENCES = ("auto", *LOCALES)

# i18n:en
EN = {
    "tray.open": "Open Work Fleet",
    "tray.quickCapture": "Quick capture",
    "tray.adjustAll": "Adjust all groups",
    "tray.toggleDesktop": "Show or hide desktop notes",
    "tray.checkUpdates": "Check for updates…",
    "tray.saveAndQuit": "Save and quit",
    "shortcut.adjustGroup": "Adjust a specific group",
    "window.opening": "Opening your secure workspace…",
    "picker.backupFolder": "Choose a backup folder",
    "picker.choose": "Choose",
    "picker.saveFile": "Save file",
    "picker.save": "Save",
    "picker.cancel": "Cancel",
    "dialog.xwaylandTitle": "Use XWayland to show desktop notes?",
    "dialog.xwaylandBody": "GNOME Wayland doesn't offer the desktop layers Work Fleet needs, so desktop notes can appear only through XWayland. The main window's input method and scaling then go through XWayland too. You can change this later on the Desktop page in Settings.",
    "dialog.xwaylandKeep": "Keep the current mode",
    "dialog.xwaylandRestart": "Restart with XWayland",
    "dialog.updateTitle": "Work Fleet update",
    "dialog.updateAvailable": "Version {version} is available (you have {current}).",
    "dialog.updateConfirm": "Update and restart Work Fleet now? Installing asks for your system password, and unsaved text is saved first.",
    "dialog.upToDate": "Work Fleet {version} is up to date.",
    "fatal.workspace": "Work Fleet couldn't open your workspace. Keep the app data and the local key, then try again.",
    "fatal.viewStopped": "The window's page process stopped. Data that was confirmed saved is kept; reopen Work Fleet.",
    "fatal.workspaceOwned": "Work Fleet is already open with this data. Use the window that's already open.",
    "fatal.storageAccess": "Work Fleet can't use its data folder or local key because the owner, permissions or format isn't valid. Keep the app data and check the file permissions.",
    "fatal.dataVersion": "This version of Work Fleet can't open the local data. Keep the data, then update the app or export a backup with a matching version.",
    "fatal.keyringLocked": "The system keyring is locked. Unlock it, then try again.",
    "fatal.keyMissing": "The existing data needs its original key, which the system keyring can't provide. Keep the app data and restore the original keyring or a portable backup.",
    "fatal.keyUnverified": "The original key can't verify the existing data, so nothing was migrated or replaced. Keep the app data and the original keyring.",
    "fatal.googleConfig": "The Google client secret in this build's settings isn't valid.",
    "reason.desktopUnsupported": "This desktop doesn't offer what desktop notes need; you can still save notes in the main window.",
    "reason.desktopDisplays": "There are more displays than desktop notes support; your data is kept.",
    "reason.desktopUnavailable": "Desktop notes can't start right now; you can still save notes in the main window.",
    "desktop.displaysUnreadable": "Work Fleet can't read the displays right now. Your data and the text you're editing are kept; try showing desktop notes again.",
    "desktop.viewLost": "A desktop notes process stopped. The last confirmed draft is kept in the main window.",
    "startup.sourceRun": "Starting at sign-in isn't available when Work Fleet runs from source. Use the DEB or the packaged build.",
    "startup.entryComment": "Shows Work Fleet desktop notes after you sign in",
    "sync.keyringLocked": "The system keyring is locked, so sync is paused. Choose Sync now to open the system unlock prompt; sync continues once it's unlocked. Your notes still work offline.",
    "sync.keyringUnavailable": "The system's secure storage can't be read right now, so sync is paused. Your notes still work.",
    "sync.unlockTimedOut": "The system unlock timed out, so sync stays paused. Choose Sync now to try again.",
    "sync.unlockCancelled": "The unlock was cancelled or didn't finish, so sync stays paused. Your notes still work.",
    "sync.secretsUnverified": "Secrets saved by an older version can't be verified. The original data is kept; related sync and encrypted backups are paused.",
    "signIn.returnToApp": "Return to Work Fleet to finish signing in.",
    "update.debOnly": "Only the version installed from the DEB supports in-app updates.",
    "update.noSource": "This build has no update source set.",
    "update.noTools": "Updates can't be installed because pkexec or dpkg-deb is missing.",
    "update.metadataInvalid": "The update information isn't in the expected format, so nothing was downloaded.",
    "update.channelUnsupported": "The update information isn't in the expected format, so nothing was downloaded. This update channel isn't supported.",
    "update.releaseMissing": "The update information isn't in the expected format, so nothing was downloaded. The source lists no Work Fleet version; check the Releases page.",
    "update.fileNameInvalid": "The update information isn't in the expected format, so nothing was downloaded. The download file name isn't valid.",
    "update.architectureMissing": "The update information isn't in the expected format, so nothing was downloaded. There's no installer for this architecture.",
    "update.metadataTooLarge": "The update information isn't in the expected format, so nothing was downloaded. It's larger than the size limit.",
    "update.sourceNotAllowed": "The update source pointed to a location that isn't allowed, so the update stopped.",
    "update.sourceRedirected": "The update source redirected, so the update stopped.",
    "update.tooManyRedirects": "The update source redirected too many times, so the update stopped.",
    "update.rateLimited": "GitHub is limiting requests for now. Try again later.",
    "update.githubError": "GitHub returned an error ({status}). Try again later.",
    "update.offline": "Can't connect to GitHub. Check your network and try again.",
    "update.timeout": "The connection timed out. Try again later.",
    "update.downloadTimeout": "The download timed out. Try again later.",
    "update.sizeMismatch": "The downloaded file's size didn't match, so it was deleted.",
    "update.checksumMismatch": "The downloaded file didn't match the update information, so it was deleted.",
    "update.downloadChanged": "The downloaded update has changed. Download it again.",
    "update.notDeb": "The downloaded file isn't a valid DEB, so it wasn't installed.",
    "update.wrongPackage": "The downloaded installer isn't for this app, so it wasn't installed.",
    "update.wrongVersion": "The downloaded installer's version or architecture doesn't match, so it wasn't installed.",
    "update.saveFailed": "The downloaded update couldn't be saved. Check the free disk space and try again.",
    "update.installTimeout": "The installation timed out and didn't finish.",
    "update.installFailed": "The installation didn't finish: {detail}",
    "update.authorizationCancelled": "System authorization wasn't given, so the update wasn't installed.",
    "update.notReady": "No update has finished downloading yet.",
    "update.unknown": "The update didn't finish. Try again later.",
}
# i18n:end

# i18n:zh-TW
ZH_TW = {
    "tray.open": "開啟 Work Fleet",
    "tray.quickCapture": "快速記錄",
    "tray.adjustAll": "調整所有群組",
    "tray.toggleDesktop": "顯示／隱藏桌面便箋",
    "tray.checkUpdates": "檢查更新…",
    "tray.saveAndQuit": "保存並結束",
    "shortcut.adjustGroup": "調整指定群組",
    "window.opening": "正在開啟安全工作空間…",
    "picker.backupFolder": "選擇備份資料夾",
    "picker.choose": "選擇",
    "picker.saveFile": "保存檔案",
    "picker.save": "保存",
    "picker.cancel": "取消",
    "dialog.xwaylandTitle": "要改用 XWayland 顯示桌面便箋嗎？",
    "dialog.xwaylandBody": "GNOME Wayland 沒有 Work Fleet 需要的桌面圖層，桌面便箋要經 XWayland 才能顯示；改用後主畫面的輸入法與縮放也會改走 XWayland。之後可在設定的「桌面」頁變更。",
    "dialog.xwaylandKeep": "維持目前方式",
    "dialog.xwaylandRestart": "改用 XWayland 重新啟動",
    "dialog.updateTitle": "Work Fleet 更新",
    "dialog.updateAvailable": "有新版本 {version}（目前 {current}）。",
    "dialog.updateConfirm": "要現在更新並重新啟動 Work Fleet 嗎？安裝需要系統密碼，未保存的文字會先保存。",
    "dialog.upToDate": "Work Fleet {version} 已是最新版本。",
    "fatal.workspace": "無法開啟工作空間，請保留 App 資料與本機金鑰後重試。",
    "fatal.viewStopped": "畫面程序已停止；已確認保存的資料仍保留，請重新開啟。",
    "fatal.workspaceOwned": "請使用已開啟的 Work Fleet 視窗。",
    "fatal.storageAccess": "App 資料或本機金鑰的檔案身分、權限或格式無效；請保留 App 資料後檢查檔案權限。",
    "fatal.dataVersion": "本機資料版本不受此版本支援；請保留原資料，並更新 App 或使用對應版本匯出備份。",
    "fatal.keyringLocked": "系統金鑰圈已鎖定；解鎖金鑰圈後重試即可。",
    "fatal.keyMissing": "現有資料缺少原金鑰；請保留 App 資料並恢復原金鑰圈或可攜備份。",
    "fatal.keyUnverified": "原金鑰無法驗證舊資料；未遷移或更換金鑰，請保留 App 資料與原金鑰圈。",
    "fatal.googleConfig": "Google client secret 設定無效。",
    "reason.desktopUnsupported": "此桌面環境未提供可用的桌面呈現能力；仍可在主畫面保存便箋。",
    "reason.desktopDisplays": "螢幕數量超過支援容量，資料仍保留。",
    "reason.desktopUnavailable": "桌面呈現目前無法啟動；仍可在主畫面保存便箋。",
    "desktop.displaysUnreadable": "目前無法讀取螢幕，已保留資料與編輯文字；請重試桌面呈現。",
    "desktop.viewLost": "桌面畫面程序已停止，最後確認的草稿仍保留於主畫面。",
    "startup.sourceRun": "從原始碼執行時不支援登入時啟動，請使用 DEB 或封裝版本。",
    "startup.entryComment": "登入後顯示 Work Fleet 桌面便箋",
    "sync.keyringLocked": "系統金鑰圈已鎖定，同步暫停。按「立即同步」可開啟系統解鎖視窗，完成後會接續同步。便箋仍可離線使用。",
    "sync.keyringUnavailable": "系統安全儲存目前無法讀取；同步暫停，便箋仍可使用。",
    "sync.unlockTimedOut": "系統解鎖已逾時；同步維持暫停，請按「立即同步」重試。",
    "sync.unlockCancelled": "已取消或未完成解鎖；同步維持暫停，便箋仍可使用。",
    "sync.secretsUnverified": "舊版秘密無法驗證；保留原資料，相關同步或加密備份已暫停。",
    "signIn.returnToApp": "請返回 Work Fleet 完成登入。",
    "update.debOnly": "只有以 DEB 安裝的版本支援 App 內更新。",
    "update.noSource": "這個版本沒有設定更新來源。",
    "update.noTools": "系統缺少 pkexec 或 dpkg-deb，無法安裝更新。",
    "update.metadataInvalid": "更新資訊格式不符，未下載任何檔案。",
    "update.channelUnsupported": "更新資訊格式不符，未下載任何檔案。不支援這個更新頻道。",
    "update.releaseMissing": "更新資訊格式不符，未下載任何檔案。來源未列出任何 Work Fleet 版本，請至 Releases 頁面確認。",
    "update.fileNameInvalid": "更新資訊格式不符，未下載任何檔案。下載檔名無效。",
    "update.architectureMissing": "更新資訊格式不符，未下載任何檔案。沒有這個架構的安裝檔。",
    "update.metadataTooLarge": "更新資訊格式不符，未下載任何檔案。超過容量上限。",
    "update.sourceNotAllowed": "更新來源指向未允許的位置，已停止。",
    "update.sourceRedirected": "更新來源轉址，已停止。",
    "update.tooManyRedirects": "更新來源轉址次數過多，已停止。",
    "update.rateLimited": "GitHub 暫時限制查詢次數，請稍後再試。",
    "update.githubError": "GitHub 回應錯誤（{status}），請稍後再試。",
    "update.offline": "無法連線到 GitHub，請確認網路後再試。",
    "update.timeout": "連線逾時，請稍後再試。",
    "update.downloadTimeout": "下載逾時，請稍後再試。",
    "update.sizeMismatch": "下載的檔案大小不符，已刪除。",
    "update.checksumMismatch": "下載的檔案與更新資訊不符，已刪除。",
    "update.downloadChanged": "下載的更新已變更，請重新下載。",
    "update.notDeb": "下載的檔案不是有效的 DEB，未安裝。",
    "update.wrongPackage": "下載的安裝檔不是這個 App，未安裝。",
    "update.wrongVersion": "下載的安裝檔版本或架構不符，未安裝。",
    "update.saveFailed": "無法保存下載的更新，請確認磁碟空間後再試。",
    "update.installTimeout": "安裝逾時，未完成。",
    "update.installFailed": "安裝沒有完成：{detail}",
    "update.authorizationCancelled": "沒有取得系統授權，未安裝更新。",
    "update.notReady": "還沒有下載好的更新。",
    "update.unknown": "更新沒有完成，請稍後再試。",
}
# i18n:end

TABLES = {"en": EN, "zh-TW": ZH_TW}
_locale = DEFAULT_LOCALE


def match_locale(tag):
    """
    One BCP 47 tag or POSIX locale name as a supported locale, or None: English variants are en; Chinese that is
    Traditional or unmarked (zh, zh-TW, zh-Hant, zh-HK, zh-MO) is zh-TW; Simplified Chinese is not supported yet.
    """
    if not isinstance(tag, str):
        return None
    value = re.sub(r"[.@].*$", "", tag.strip()).replace("_", "-").lower()
    if value == "en" or value.startswith("en-"):
        return "en"
    if value in ("zh", "zh-tw", "zh-hant", "zh-hk", "zh-mo") or value.startswith(("zh-tw-", "zh-hant-", "zh-hk-", "zh-mo-")):
        return "zh-TW"
    return None


def resolve_locale(preference, languages=()):
    """A pinned preference wins; "auto" takes the first system language that matches, else English."""
    if preference in LOCALES:
        return preference
    for tag in languages or ():
        locale = match_locale(tag)
        if locale:
            return locale
    return DEFAULT_LOCALE


def system_languages(environ=os.environ):
    """
    The session's UI languages, most preferred first, as BCP 47 tags: LANGUAGE (a colon-separated list), then LC_ALL,
    LC_MESSAGES and LANG. Empty values, C and POSIX name no language; the encoding and modifier are dropped.
    """
    values = environ.get("LANGUAGE", "").split(":") + [environ.get(name, "") for name in ("LC_ALL", "LC_MESSAGES", "LANG")]
    result = []
    for value in values:
        tag = re.sub(r"[.@].*$", "", value.strip()).replace("_", "-")
        if tag and tag.upper() not in ("C", "POSIX") and tag not in result:
            result.append(tag)
    return result


def set_locale(locale):
    global _locale
    _locale = locale if locale in LOCALES else DEFAULT_LOCALE


def get_locale():
    return _locale


def t(key, /, **values):
    """The key's text in the current locale, then English; a missing key returns itself, like the renderer's t()."""
    value = TABLES[_locale].get(key, EN.get(key))
    if value is None:
        return key
    return re.sub(r"\{([A-Za-z0-9_]+)\}", lambda match: match.group(0) if values.get(match.group(1)) is None else str(values[match.group(1)]), value)


def translations(key):
    """The key's text in every locale, for files the system reads in its own language (the autostart entry)."""
    return {locale: table[key] for locale, table in TABLES.items()}
