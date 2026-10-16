package app.workfleet.nativehost;

import java.util.concurrent.TimeUnit;

// A token obtained while choosing another account must never authorize the current workspace's pending uploads.
final class GoogleAccessToken {
    private static final long MAX_AGE_MILLIS = TimeUnit.MINUTES.toMillis(45);
    private String accountId, token;
    private long acquiredAt;

    synchronized void save(String accountId, String token, long now) {
        this.accountId = accountId; this.token = token; acquiredAt = now;
    }
    synchronized String get(String expectedAccount, long now) {
        long age = now - acquiredAt;
        return expectedAccount.equals(accountId) && age >= 0 && age < MAX_AGE_MILLIS ? token : null;
    }
    synchronized String clear() {
        String previous = token; accountId = null; token = null; acquiredAt = 0; return previous;
    }
}
