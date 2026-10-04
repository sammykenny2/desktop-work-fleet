package app.workfleet.nativehost;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.view.View;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.credentials.CredentialManager;
import androidx.credentials.CredentialManagerCallback;
import androidx.credentials.GetCredentialRequest;
import androidx.credentials.GetCredentialResponse;
import androidx.credentials.exceptions.GetCredentialException;
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption;
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import org.json.JSONObject;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

public final class FleetActivity extends Activity {
    static final String ORIGIN = "https://appassets.androidplatform.net";
    static final String DOCUMENT = ORIGIN + "/assets/app/index.html";
    private final ExecutorService storageWorker = Executors.newSingleThreadExecutor();
    private final ExecutorService networkWorker = Executors.newSingleThreadExecutor();
    private WebView web;
    private FleetDatabase database;
    private FleetBridge bridge;
    private GoogleFiles google;
    private JSONObject config;
    private String profile;
    private volatile long epoch;
    private volatile boolean destroyed;
    private CompletableFuture<Uri> directoryPicker;
    private CompletableFuture<AuthorizationResult> authorization;
    private ValueCallback<Uri[]> attachmentPicker;
    private JavaScriptReplyProxy ownerProxy;
    private int admitted;
    private boolean finishing;
    private FleetExports exports;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        exports = new FleetExports(this);
        try {
            byte[] bytes; try (java.io.InputStream stream = getAssets().open("config/public.json")) { bytes = Protocol.bytes(stream, 65536); }
            config = Protocol.json(bytes); profile = getPreferences(MODE_PRIVATE).getString("profile", "local"); openStore();
            Protocol.require(WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER), "native-version", "請更新 Android System WebView 後再開啟。");
            web = new WebView(this); setContentView(web); WebView.setWebContentsDebuggingEnabled(false);
            web.getSettings().setJavaScriptEnabled(true); web.getSettings().setDomStorageEnabled(false);
            web.getSettings().setAllowFileAccess(false); web.getSettings().setAllowContentAccess(true);
            web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            web.getSettings().setJavaScriptCanOpenWindowsAutomatically(false); web.getSettings().setSupportMultipleWindows(false);
            web.getSettings().setSafeBrowsingEnabled(true);
            WebViewAssetLoader loader = new WebViewAssetLoader.Builder().addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
            web.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    Uri uri = request.getUrl();
                    if (request.getMethod().equals("GET") && uri.getScheme().equals("https") && uri.getHost().equals("appassets.androidplatform.net") && uri.getPath().startsWith("/assets/")) {
                        WebResourceResponse response = loader.shouldInterceptRequest(uri); if (response != null) return response;
                    }
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    if (request.isForMainFrame() && request.getUrl().toString().equals(DOCUMENT)) return false;
                    if (request.isForMainFrame() && request.hasGesture()) external(request.getUrl()); return true;
                }
                @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) { ownerProxy = null; }
            });
            web.setWebChromeClient(new WebChromeClient() {
                @Override public void onPermissionRequest(android.webkit.PermissionRequest request) { request.deny(); }
                @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                    if (attachmentPicker != null) attachmentPicker.onReceiveValue(null); attachmentPicker = callback;
                    Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                    intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE); startActivityForResult(intent, 20); return true;
                }
            });
            web.setDownloadListener((url, agent, disposition, mime, length) -> { if (url.startsWith("https://")) external(Uri.parse(url)); });
            WebViewCompat.addWebMessageListener(web, "workFleet", Collections.singleton(ORIGIN), (view, message, origin, mainFrame, proxy) -> {
                if (destroyed || !mainFrame || !origin.toString().equals(ORIGIN) || !DOCUMENT.equals(view.getUrl())) return;
                String json = message.getData(); if (json == null || json.getBytes(StandardCharsets.UTF_8).length > 1024 * 1024 || admitted >= 32) return;
                try {
                    JSONObject request = Protocol.json(json); String id = Protocol.text(request, "id", 36), method = Protocol.text(request, "method", 64);
                    Protocol.require(Protocol.uuid(id) && Protocol.number(request, "v", 1) == 1 && request.opt("params") instanceof JSONObject, "invalid-request", "原生協定格式無效。");
                    ownerProxy = proxy; admitted++; final long current = epoch; final FleetBridge session = bridge; final GoogleFiles account = google;
                    (method.startsWith("google.") ? networkWorker : storageWorker).execute(() -> handle(id, method, request.optJSONObject("params"), session, account, current, proxy));
                } catch (Exception error) { /* Only bounded, well-formed requests are admitted. */ }
            });
            web.setOnApplyWindowInsetsListener((view, insets) -> {
                if (android.os.Build.VERSION.SDK_INT >= 30) { android.graphics.Insets system = insets.getInsets(android.view.WindowInsets.Type.systemBars() | android.view.WindowInsets.Type.ime()); view.setPadding(system.left, system.top, system.right, system.bottom); }
                else view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(), insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
                return insets;
            });
            web.loadUrl(DOCUMENT);
        } catch (Exception error) { new AlertDialog.Builder(this).setMessage(error instanceof Protocol.Failure ? error.getMessage() : "無法開啟安全工作空間；請保留 App 資料並重試。").setPositiveButton("關閉", (dialog, which) -> finish()).show(); }
    }
    private void openStore() throws Exception { database = new FleetDatabase(this, profile); bridge = new FleetBridge(database, this); google = new GoogleFiles(this, database, config); }
    private void handle(String id, String method, JSONObject args, FleetBridge session, GoogleFiles account, long current, JavaScriptReplyProxy proxy) {
        JSONObject response; String switchTo = null;
        try {
            Protocol.require(!destroyed && current == epoch, "stale-session", "原生工作階段已結束。"); Object result;
            if (method.startsWith("google.")) {
                switch (method) {
                    case "google.status": result = account.status(); break;
                    case "google.signIn": result = account.signIn(); break;
                    case "google.open": switchTo = account.open(Protocol.text(args, "accountId", 255)); result = Protocol.object("profileId", switchTo); break;
                    case "google.signOut": account.signOut(); switchTo = "local"; result = Protocol.object("profileId", switchTo); break;
                    case "google.local": switchTo = "local"; result = Protocol.object("profileId", switchTo); break;
                    default: result = account.invoke(method, args, session);
                }
            } else if (method.equals("file.export")) result = exports.export(args, session);
            else result = session.invoke(method, args);
            response = Protocol.object("v", 1, "id", id, "ok", true, "result", result);
        } catch (Exception error) {
            switchTo = null;
            try { response = Protocol.object("v", 1, "id", id, "ok", false, "error", Protocol.object("code", error instanceof Protocol.Failure ? ((Protocol.Failure) error).code : "native-unavailable", "message", error instanceof Protocol.Failure ? error.getMessage() : "原生操作未完成，請保留草稿後重試。")); }
            catch (Exception impossible) { return; }
        }
        final String reply = response.toString(), nextProfile = switchTo;
        runOnUiThread(() -> {
            admitted--; if (destroyed || current != epoch || !DOCUMENT.equals(web.getUrl())) return;
            proxy.postMessage(reply);
            if (nextProfile != null) switchProfile(nextProfile);
            else if (method.equals("host.closeCancel")) finishing = false;
            else if (session.closeReady && finishing) finish();
        });
    }
    private void switchProfile(String next) {
        epoch++; ownerProxy = null; bridge.close(); google.close();
        storageWorker.execute(() -> {
            try { database.close(); profile = next; openStore(); Protocol.require(getPreferences(MODE_PRIVATE).edit().putString("profile", next).commit(), "native-storage", "未能保存帳號選擇。"); runOnUiThread(() -> web.loadUrl(DOCUMENT)); }
            catch (Exception error) { runOnUiThread(() -> new AlertDialog.Builder(this).setMessage("帳號切換未完成；資料仍保留，請重新開啟。").setPositiveButton("關閉", (dialog, which) -> finish()).show()); }
        });
    }
    private void lifecycleEvent(String name) {
        if (!destroyed && ownerProxy != null) {
            try { ownerProxy.postMessage(Protocol.object("v", 1, "event", name).toString()); } catch (Exception ignored) { }
        }
    }
    @Override protected void onPause() { lifecycleEvent("host-background"); super.onPause(); }
    @Override protected void onResume() { super.onResume(); lifecycleEvent("host-foreground"); }
    boolean googleConfigured() {
        try { JSONObject clients = config.getJSONObject("google").getJSONObject("clients"); return !clients.optString("android").isEmpty() && !clients.optString("web").isEmpty(); } catch (Exception error) { return false; }
    }
    String selectGoogleEmail() throws Exception {
        Protocol.require(googleConfigured(), "google-config", "請填寫 .env 的 Android 與 Web Google client ID 後重新建置。");
        CompletableFuture<String> result = new CompletableFuture<>(); CancellationSignal cancellation = new CancellationSignal();
        runOnUiThread(() -> {
            try {
                String client = config.getJSONObject("google").getJSONObject("clients").getString("web");
                GetSignInWithGoogleOption option = new GetSignInWithGoogleOption.Builder(client).build();
                GetCredentialRequest request = new GetCredentialRequest.Builder().addCredentialOption(option).build();
                CredentialManager.create(this).getCredentialAsync(this, request, cancellation, getMainExecutor(), new CredentialManagerCallback<GetCredentialResponse, GetCredentialException>() {
                    @Override public void onResult(GetCredentialResponse response) {
                        try { GoogleIdTokenCredential credential = GoogleIdTokenCredential.createFrom(response.getCredential().getData()); result.complete(credential.getId()); }
                        catch (Exception error) { result.completeExceptionally(error); }
                    }
                    @Override public void onError(GetCredentialException error) { result.completeExceptionally(error); }
                });
            } catch (Exception error) { result.completeExceptionally(error); }
        });
        try { return result.get(110, TimeUnit.SECONDS); } finally { cancellation.cancel(); }
    }
    AuthorizationResult authorize(AuthorizationRequest request, boolean interactive) throws Exception {
        CompletableFuture<AuthorizationResult> result = new CompletableFuture<>();
        runOnUiThread(() -> Identity.getAuthorizationClient(this).authorize(request).addOnSuccessListener(value -> {
            if (!value.hasResolution()) result.complete(value);
            else if (!interactive) result.completeExceptionally(new Protocol.Failure("unauthorized", "Google 授權需要重新確認，請按登入 Google。"));
            else {
                try { authorization = result; startIntentSenderForResult(value.getPendingIntent().getIntentSender(), 30, null, 0, 0, 0); }
                catch (Exception error) { authorization = null; result.completeExceptionally(error); }
            }
        }).addOnFailureListener(result::completeExceptionally));
        try { return result.get(110, TimeUnit.SECONDS); } finally { if (authorization == result) authorization = null; }
    }
    Uri chooseDirectory() throws Exception {
        CompletableFuture<Uri> result = new CompletableFuture<>(); runOnUiThread(() -> {
            if (directoryPicker != null) { result.completeExceptionally(new IllegalStateException("Picker busy")); return; }
            directoryPicker = result; startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION), 10);
        });
        try { return result.get(110, TimeUnit.SECONDS); } finally { if (directoryPicker == result) directoryPicker = null; }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 10 && directoryPicker != null) {
            CompletableFuture<Uri> pending = directoryPicker; directoryPicker = null;
            try {
                Protocol.require(result == RESULT_OK && data != null && data.getData() != null, "backup-cancelled", "已取消選擇。"); Uri tree = data.getData();
                getContentResolver().takePersistableUriPermission(tree, data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION)); pending.complete(tree);
            } catch (Exception error) { pending.completeExceptionally(error); }
        } else if (request == 20 && attachmentPicker != null) {
            ValueCallback<Uri[]> pending = attachmentPicker; attachmentPicker = null; pending.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
        } else if (request == 40) {
            exports.selected(result, data);
        } else if (request == 30 && authorization != null) {
            CompletableFuture<AuthorizationResult> pending = authorization; authorization = null;
            try { pending.complete(Identity.getAuthorizationClient(this).getAuthorizationResultFromIntent(data)); } catch (Exception error) { pending.completeExceptionally(error); }
        }
    }
    private void external(Uri uri) { if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { } }
    @Override public void onBackPressed() {
        if (bridge != null && bridge.ready && ownerProxy != null) {
            finishing = true; try { ownerProxy.postMessage(Protocol.object("v", 1, "event", "host-close-requested").toString()); } catch (Exception ignored) { }
        } else super.onBackPressed();
    }
    @Override protected void onDestroy() {
        destroyed = true; epoch++; if (attachmentPicker != null) attachmentPicker.onReceiveValue(null);
        if (exports != null) exports.close();
        if (directoryPicker != null) directoryPicker.completeExceptionally(new IllegalStateException("Activity closed"));
        if (authorization != null) authorization.completeExceptionally(new IllegalStateException("Activity closed"));
        if (google != null) google.close(); storageWorker.execute(() -> { try { if (bridge != null) bridge.close(); if (database != null) database.close(); } catch (Exception ignored) { } });
        storageWorker.shutdown(); networkWorker.shutdown(); if (web != null) web.destroy(); super.onDestroy();
    }
}
