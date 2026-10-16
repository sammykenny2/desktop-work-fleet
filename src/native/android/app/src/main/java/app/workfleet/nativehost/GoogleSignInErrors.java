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
            return new Protocol.Failure("google-cancelled", "已取消 Google 登入。");
        if (cause instanceof TimeoutException)
            return new Protocol.Failure("google-timeout", "Google 登入等候逾時，請重試。");
        if (cause instanceof NoCredentialException)
            return new Protocol.Failure("google-account", "無法選取 Google 帳號，請確認裝置已加入帳號及 Google Play 服務可用。");
        if (cause instanceof GetCredentialProviderConfigurationException)
            return new Protocol.Failure("google-config", "這個版本的 Google 登入設定不完整，請更新 App 後重試。");
        if (cause instanceof IOException)
            return new Protocol.Failure("network", "無法連接 Google，請確認網路後重試。");
        if (cause instanceof ApiException) {
            switch (((ApiException) cause).getStatusCode()) {
                case CommonStatusCodes.CANCELED: return new Protocol.Failure("google-cancelled", "已取消 Google 登入。");
                case CommonStatusCodes.DEVELOPER_ERROR: return new Protocol.Failure("google-config", "這個版本的 Google 登入設定不符，請更新 App 後重試。");
                case CommonStatusCodes.NETWORK_ERROR: return new Protocol.Failure("network", "無法連接 Google，請確認網路後重試。");
                case CommonStatusCodes.TIMEOUT: return new Protocol.Failure("google-timeout", "Google 登入等候逾時，請重試。");
                case CommonStatusCodes.SIGN_IN_REQUIRED: return new Protocol.Failure("unauthorized", "Google 授權已失效，請重新登入。");
            }
        }
        return new Protocol.Failure("google-unavailable", "Google 登入未完成，請稍後重試。");
    }
}
