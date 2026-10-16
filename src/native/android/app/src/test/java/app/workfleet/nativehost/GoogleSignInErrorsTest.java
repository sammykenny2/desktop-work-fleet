package app.workfleet.nativehost;

import androidx.credentials.exceptions.GetCredentialCancellationException;
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException;
import androidx.credentials.exceptions.NoCredentialException;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.CommonStatusCodes;
import com.google.android.gms.common.api.Status;
import org.junit.Test;
import java.io.IOException;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeoutException;
import static org.junit.Assert.*;

public final class GoogleSignInErrorsTest {
    @Test public void credentialCancellationSurvivesTheAsyncBoundary() {
        Protocol.Failure failure = GoogleSignInErrors.failure(new ExecutionException(new GetCredentialCancellationException("private-provider-detail")));
        assertEquals("google-cancelled", failure.code);
        assertFalse(failure.getMessage().contains("private-provider-detail"));
    }
    @Test public void nativeDenialAndStorageFailuresKeepTheirMeaning() {
        Protocol.Failure denied = new Protocol.Failure("source-permission", "請授權 App 資料。");
        assertSame(denied, GoogleSignInErrors.failure(new ExecutionException(denied)));
    }
    @Test public void missingAccountsAndConfigurationAreActionable() {
        assertEquals("google-account", GoogleSignInErrors.failure(new NoCredentialException("private-provider-detail")).code);
        assertEquals("google-config", GoogleSignInErrors.failure(new GetCredentialProviderConfigurationException("private-provider-detail")).code);
    }
    @Test public void timeoutNetworkAndUnknownFailuresDoNotExposeSdkMessages() {
        Exception[] errors = {new TimeoutException("private-provider-detail"), new IOException("private-provider-detail"), new Exception("private-provider-detail")};
        String[] codes = {"google-timeout", "network", "google-unavailable"};
        for (int i = 0; i < errors.length; i++) {
            Protocol.Failure failure = GoogleSignInErrors.failure(new ExecutionException(errors[i]));
            assertEquals(codes[i], failure.code);
            assertFalse(failure.getMessage().contains("private-provider-detail"));
        }
    }
    @Test public void playServicesErrorsRemainActionableWithoutLeakingTheirMessages() {
        int[] statuses = {CommonStatusCodes.CANCELED, CommonStatusCodes.DEVELOPER_ERROR, CommonStatusCodes.NETWORK_ERROR, CommonStatusCodes.TIMEOUT, CommonStatusCodes.SIGN_IN_REQUIRED};
        String[] codes = {"google-cancelled", "google-config", "network", "google-timeout", "unauthorized"};
        for (int i = 0; i < statuses.length; i++) {
            Protocol.Failure failure = GoogleSignInErrors.failure(new ExecutionException(new ApiException(new Status(statuses[i], "private-provider-detail"))));
            assertEquals(codes[i], failure.code);
            assertFalse(failure.getMessage().contains("private-provider-detail"));
        }
    }
}
