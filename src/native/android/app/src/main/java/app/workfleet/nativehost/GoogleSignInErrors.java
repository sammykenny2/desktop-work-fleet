package app.workfleet.nativehost;

import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException;
import androidx.credentials.exceptions.NoCredentialException;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import java.io.IOException;
import java.util.concurrent.CancellationException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;

final class GoogleSignInErrors {
    static Protocol.Failure failure(Exception error) {
        Throwable cause = error;
        while (cause instanceof ExecutionException && cause.getCause() != null) cause = cause.getCause();
        if (cause instanceof Protocol.Failure) return (Protocol.Failure) cause;
        if (cause instanceof GetCredentialCancellationException || cause instanceof CancellationException)
            return new Protocol.Failure("google-cancelled", "Google sign-in was cancelled.");
        if (cause instanceof TimeoutException)
            return new Protocol.Failure("google-timeout", "Google sign-in timed out. Try again.");
        if (cause instanceof NoCredentialException)
            return new Protocol.Failure("google-account", "Couldn't choose a Google account. Make sure this device has a Google account and Google Play services are available.");
        if (cause instanceof GetCredentialProviderConfigurationException)
            return new Protocol.Failure("google-config", "Google sign-in isn't fully configured in this version. Update the app and try again.");
        if (cause instanceof IOException)
            return new Protocol.Failure("network", "Couldn't reach Google. Check your connection and try again.");
        if (cause instanceof ApiException) {
            switch (((ApiException) cause).getStatusCode()) {
                case CommonStatusCodes.CANCELED: return new Protocol.Failure("google-cancelled", "Google sign-in was cancelled.");
                case CommonStatusCodes.DEVELOPER_ERROR: return new Protocol.Failure("google-config", "Google sign-in settings don't match this version. Update the app and try again.");
                case CommonStatusCodes.NETWORK_ERROR: return new Protocol.Failure("network", "Couldn't reach Google. Check your connection and try again.");
                case CommonStatusCodes.TIMEOUT: return new Protocol.Failure("google-timeout", "Google sign-in timed out. Try again.");
                case CommonStatusCodes.SIGN_IN_REQUIRED: return new Protocol.Failure("unauthorized", "Google authorization has expired. Sign in again.");
            }
        }
        return new Protocol.Failure("google-unavailable", "Google sign-in didn't finish. Try again later.");
    }
}
