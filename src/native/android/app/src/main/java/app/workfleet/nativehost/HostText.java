package app.workfleet.nativehost;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Text the Android host draws itself (dialogs, chooser titles, descriptive values it returns for the page to show) and
 * the display-language rules of docs/i18n.md. Plain Java with no Android types, so JVM unit tests load it as is.
 * tests/i18n.test.js reads the two locale blocks below: one entry per line, the key first, identical keys and
 * placeholders in both blocks.
 */
final class HostText {
    static final String AUTO = "auto", ENGLISH = "en", TRADITIONAL_CHINESE = "zh-TW";
    static final List<String> LOCALES = Collections.unmodifiableList(Arrays.asList(ENGLISH, TRADITIONAL_CHINESE));
    static final List<String> PREFERENCES = Collections.unmodifiableList(Arrays.asList(AUTO, ENGLISH, TRADITIONAL_CHINESE));
    private static final List<String> TRADITIONAL = Arrays.asList("zh", "zh-tw", "zh-hant", "zh-hk", "zh-mo");
    private static final List<String> TRADITIONAL_PREFIXES = Arrays.asList("zh-tw-", "zh-hant-", "zh-hk-", "zh-mo-");
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([A-Za-z0-9_]+)\\}");
    private static final Map<String, Map<String, String>> TABLES = new HashMap<>();
    static {
        TABLES.put(ENGLISH, Collections.unmodifiableMap(english()));
        TABLES.put(TRADITIONAL_CHINESE, Collections.unmodifiableMap(traditionalChinese()));
    }
    private static volatile String locale = ENGLISH;

    private HostText() { }

    private static Map<String, String> english() {
        Map<String, String> table = new HashMap<>();
        // i18n:en
        table.put("dialog.close", "Close");
        table.put("dialog.ok", "OK");
        table.put("dialog.openFailed", "Couldn't open the secure workspace. Keep the app's data and try again.");
        table.put("dialog.webViewOutdated", "Update Android System WebView, then open Work Fleet again.");
        table.put("dialog.alreadyOpen", "The workspace is already open in another window.");
        table.put("dialog.accountSwitchFailed", "The account switch didn't finish. Your data is kept; reopen Work Fleet.");
        table.put("share.notReceivedTitle", "Share not received");
        table.put("share.readFailed", "Couldn't read the shared content. Keep the original file and try again.");
        table.put("share.inboxUnavailable", "The Share inbox isn't available right now. Keep the original and try again.");
        table.put("share.tooLarge", "The Share inbox is full, or this share is too large. Accept or discard items in the Share inbox, or share less at once.");
        table.put("share.fileUnreadable", "Couldn't read the shared file. Shared files must come from a system document provider.");
        table.put("share.damagedPreview", "Shared content can't be read");
        table.put("share.textChooser", "Share text");
        table.put("share.fileChooser", "Share file");
        table.put("backup.authorizedFolder", "Authorized backup folder");
        // i18n:end
        return table;
    }

    private static Map<String, String> traditionalChinese() {
        Map<String, String> table = new HashMap<>();
        // i18n:zh-TW
        table.put("dialog.close", "關閉");
        table.put("dialog.ok", "確定");
        table.put("dialog.openFailed", "無法開啟安全工作空間；請保留 App 資料並重試。");
        table.put("dialog.webViewOutdated", "請更新 Android System WebView 後再開啟。");
        table.put("dialog.alreadyOpen", "工作空間已在另一個視窗開啟。");
        table.put("dialog.accountSwitchFailed", "帳號切換未完成；資料仍保留，請重新開啟。");
        table.put("share.notReceivedTitle", "分享尚未接收");
        table.put("share.readFailed", "無法讀取分享內容，請保留原檔後重試。");
        table.put("share.inboxUnavailable", "分享收件匣目前不可用，請保留原內容後重試。");
        table.put("share.tooLarge", "分享收件匣已滿或分享內容超限，請先接收或捨棄既有項目，或減少分享內容。");
        table.put("share.fileUnreadable", "無法讀取分享檔案；分享檔案必須由系統文件提供者授權。");
        table.put("share.damagedPreview", "分享內容無法讀取");
        table.put("share.textChooser", "分享文字");
        table.put("share.fileChooser", "分享檔案");
        table.put("backup.authorizedFolder", "已授權的備份資料夾");
        // i18n:end
        return table;
    }

    /**
     * Maps one BCP 47 tag or POSIX locale name to a supported locale, or null, exactly like matchLocale in
     * src/i18n/index.js: English variants are en; unmarked or Traditional Chinese is zh-TW; Simplified Chinese and every
     * other language do not match. Case is ignored, '_' counts as '-', and a POSIX encoding or modifier is dropped.
     */
    static String match(String tag) {
        if (tag == null) return null;
        String value = tag.trim().replaceAll("[.@].*$", "").replace('_', '-').toLowerCase(Locale.ROOT);
        if (value.equals("en") || value.startsWith("en-")) return ENGLISH;
        if (TRADITIONAL.contains(value)) return TRADITIONAL_CHINESE;
        for (String prefix : TRADITIONAL_PREFIXES) if (value.startsWith(prefix)) return TRADITIONAL_CHINESE;
        return null;
    }

    /** A pinned locale wins; auto (or anything else) takes the first system language that matches, then English. */
    static String resolve(String preference, Iterable<String> languages) {
        if (LOCALES.contains(preference)) return preference;
        if (languages != null) for (String tag : languages) {
            String matched = match(tag);
            if (matched != null) return matched;
        }
        return ENGLISH;
    }

    static boolean validPreference(Object value) { return value instanceof String && PREFERENCES.contains(value); }

    /** A stored preference; a missing, unknown or damaged value reads as auto so startup never blocks on it. */
    static String preference(Object stored) { return validPreference(stored) ? (String) stored : AUTO; }

    /** Splits LocaleList.toLanguageTags() output, most preferred first; an empty list falls back to the default locale's tag. */
    static List<String> languageTags(String joined, String fallback) {
        List<String> tags = new ArrayList<>();
        if (joined != null) for (String tag : joined.split(",")) if (!tag.trim().isEmpty()) tags.add(tag.trim());
        if (tags.isEmpty() && fallback != null && !fallback.trim().isEmpty()) tags.add(fallback.trim());
        return tags;
    }

    static void setLocale(String value) { locale = LOCALES.contains(value) ? value : ENGLISH; }
    static String locale() { return locale; }
    static Set<String> keys(String value) { return TABLES.get(value).keySet(); }

    /** The key's text in the current locale; values are name/value pairs for {name} placeholders. */
    static String get(String key, Object... values) { return in(locale, key, values); }

    /** Falls back to English, then to the key itself so a gap stays visible; a placeholder without a value stays as is. */
    static String in(String value, String key, Object... values) {
        Map<String, String> table = TABLES.get(LOCALES.contains(value) ? value : ENGLISH);
        String text = table.containsKey(key) ? table.get(key) : TABLES.get(ENGLISH).get(key);
        return text == null ? key : format(text, values);
    }

    /** Replaces each {name} that has a value; values are name/value pairs. */
    static String format(String text, Object... values) {
        if (values.length == 0) return text;
        Map<String, String> named = new HashMap<>();
        for (int i = 0; i + 1 < values.length; i += 2) if (values[i] != null && values[i + 1] != null) named.put(values[i].toString(), values[i + 1].toString());
        Matcher matcher = PLACEHOLDER.matcher(text); StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String replacement = named.get(matcher.group(1));
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement == null ? matcher.group() : replacement));
        }
        matcher.appendTail(result); return result.toString();
    }
}
