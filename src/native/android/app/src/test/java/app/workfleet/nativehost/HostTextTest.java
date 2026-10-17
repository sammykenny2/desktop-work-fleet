package app.workfleet.nativehost;

import org.junit.After;
import org.junit.Test;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import static org.junit.Assert.*;

public final class HostTextTest {
    @After public void restoreLocale() { HostText.setLocale(HostText.ENGLISH); }

    // The same cases as "system languages resolve with the documented rules" in tests/i18n.test.js.
    @Test public void systemLanguagesMatchTheDocumentedRules() {
        String[][] cases = { { "en", "en" }, { "en-US", "en" }, { "EN_gb", "en" }, { "zh", "zh-TW" }, { "zh-TW", "zh-TW" },
            { "zh_TW.UTF-8", "zh-TW" }, { "zh-Hant", "zh-TW" }, { "zh-Hant-TW", "zh-TW" }, { "zh-HK", "zh-TW" }, { "zh-MO", "zh-TW" },
            { "zh-CN", null }, { "zh-Hans-CN", null }, { "zh-SG", null }, { "ja-JP", null }, { "C", null }, { "C.UTF-8", null }, { "", null }, { null, null } };
        for (String[] item : cases) assertEquals(String.valueOf(item[0]), item[1], HostText.match(item[0]));
    }
    @Test public void preferencesResolveAgainstTheSystemLanguagesInOrder() {
        assertEquals("zh-TW", HostText.resolve("auto", Arrays.asList("ja-JP", "zh-CN", "zh-TW", "en-US")));
        assertEquals("en", HostText.resolve("auto", Collections.singletonList("fr-FR")));
        assertEquals("en", HostText.resolve("auto", Collections.<String>emptyList()));
        assertEquals("en", HostText.resolve("auto", null));
        assertEquals("en", HostText.resolve("en", Collections.singletonList("zh-TW")));
        assertEquals("zh-TW", HostText.resolve("zh-TW", Collections.singletonList("en-US")));
        assertEquals("zh-TW", HostText.resolve("fr", Collections.singletonList("zh-TW")));
    }
    @Test public void unknownOrDamagedStoredPreferencesReadAsAuto() {
        for (String value : new String[] { "auto", "en", "zh-TW" }) {
            assertTrue(value, HostText.validPreference(value));
            assertEquals(value, HostText.preference(value));
        }
        for (Object value : new Object[] { null, "", "EN", "zh-tw", "zh-CN", "fr", 1, true }) {
            assertFalse(String.valueOf(value), HostText.validPreference(value));
            assertEquals(String.valueOf(value), "auto", HostText.preference(value));
        }
    }
    @Test public void systemLanguageTagsKeepTheirOrderAndFallBackToTheDefaultLocale() {
        assertEquals(Arrays.asList("zh-Hant-TW", "en-US"), HostText.languageTags("zh-Hant-TW,en-US", "fr-FR"));
        assertEquals(Collections.singletonList("fr-FR"), HostText.languageTags("", "fr-FR"));
        assertEquals(Collections.singletonList("fr-FR"), HostText.languageTags(null, "fr-FR"));
        assertEquals(Collections.<String>emptyList(), HostText.languageTags("", ""));
    }
    @Test public void bothLocaleBlocksHaveTheSameKeysAndPlaceholders() {
        assertFalse(HostText.keys("en").isEmpty());
        assertEquals(HostText.keys("en"), HostText.keys("zh-TW"));
        for (String key : HostText.keys("en")) {
            String english = HostText.in("en", key), chinese = HostText.in("zh-TW", key);
            assertFalse(key, english.trim().isEmpty() || chinese.trim().isEmpty());
            assertEquals(key, placeholders(english), placeholders(chinese));
        }
    }
    @Test public void lookupsFollowTheCurrentLocaleAndFallBack() {
        assertEquals("Close", HostText.get("dialog.close"));
        HostText.setLocale("zh-TW");
        assertEquals("zh-TW", HostText.locale());
        assertEquals(HostText.in("zh-TW", "dialog.close"), HostText.get("dialog.close"));
        assertNotEquals("Close", HostText.get("dialog.close"));
        assertEquals("missing.key", HostText.get("missing.key"));
        HostText.setLocale("fr");
        assertEquals("en", HostText.locale());
        assertEquals("Close", HostText.get("dialog.close"));
    }
    @Test public void placeholdersAreReplacedByName() {
        assertEquals("Close", HostText.get("dialog.close", "name", "value"));
        assertEquals("Saved to Backups $1 \\ in {place}", HostText.format("Saved to {name} in {place}", "name", "Backups $1 \\"));
        assertEquals("{name} stays", HostText.format("{name} stays", "name", null));
    }

    private static List<String> placeholders(String text) {
        List<String> names = new ArrayList<>(); Matcher matcher = Pattern.compile("\\{([A-Za-z0-9_]+)\\}").matcher(text);
        while (matcher.find()) names.add(matcher.group(1));
        Collections.sort(names); return names;
    }
}
