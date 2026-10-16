package app.workfleet.nativehost;

import org.junit.Test;
import java.util.concurrent.TimeUnit;
import static org.junit.Assert.*;

public final class GoogleAccessTokenTest {
    @Test public void accountSelectionCannotAuthorizeThePreviousWorkspace() {
        GoogleAccessToken cache = new GoogleAccessToken();
        cache.save("first-account", "first-token", 1000);
        assertEquals("first-token", cache.get("first-account", 1001));
        cache.save("second-account", "second-token", 1002);
        assertNull(cache.get("first-account", 1003));
        assertEquals("second-token", cache.get("second-account", 1003));
        cache.save("first-account", "refreshed-first-token", 1004);
        assertEquals("refreshed-first-token", cache.get("first-account", 1005));
        assertNull(cache.get("second-account", 1005));
    }
    @Test public void expiredAndRebootedClocksRequireAuthorizationAgain() {
        GoogleAccessToken cache = new GoogleAccessToken();
        cache.save("account", "token", 1000);
        assertNotNull(cache.get("account", 1000 + TimeUnit.MINUTES.toMillis(45) - 1));
        assertNull(cache.get("account", 1000 + TimeUnit.MINUTES.toMillis(45)));
        assertNull(cache.get("account", 999));
    }
    @Test public void signOutAndUnauthorizedResponsesForgetTheToken() {
        GoogleAccessToken cache = new GoogleAccessToken();
        cache.save("account", "token", 1000);
        assertEquals("token", cache.clear());
        assertNull(cache.get("account", 1001));
        assertNull(cache.clear());
    }
}
