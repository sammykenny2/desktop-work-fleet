package app.workfleet.nativehost;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import androidx.core.content.FileProvider;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

final class FleetExports implements AutoCloseable {
    private final FleetActivity activity;
    private volatile CompletableFuture<Uri> picker;
    private volatile boolean closed;
    FleetExports(FleetActivity activity) { this.activity = activity; }
    static String filename(String name) {
        String value = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (value.isEmpty() || value.equals(".") || value.equals("..")) return "work-fleet-export";
        return value.substring(0, Math.min(180, value.length()));
    }
    Object export(JSONObject args, FleetBridge bridge) throws Exception {
        String name = filename(Protocol.text(args, "name", 240)), action = Protocol.text(args, "action", 16);
        Protocol.require(!closed && (action.equals("save") || action.equals("share") || action.equals("shareText")), "file-export", "檔案匯出操作無效。");
        byte[] bytes = bridge.upload(args, "backup");
        try {
            if (action.equals("shareText")) {
                Protocol.require(bytes.length <= 128 * 1024, "file-capacity", "文字分享容量超限，請改用檔案分享。");
                String text = StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString();
                CompletableFuture<Void> launched = new CompletableFuture<>();
                activity.runOnUiThread(() -> {
                    try {
                        Protocol.require(!closed, "native-closed", "原生工作階段已結束。");
                        activity.startActivity(Intent.createChooser(new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text), "分享文字"));
                        launched.complete(null);
                    } catch (Exception error) { launched.completeExceptionally(error); }
                });
                launched.get(110, TimeUnit.SECONDS); return Protocol.object("completed", true, "shared", true);
            }
            if (action.equals("share")) {
                File root = new File(activity.getCacheDir(), "exports");
                Protocol.require(root.isDirectory() || root.mkdir(), "file-export", "無法建立分享暫存。");
                long total = 0; int count = 0;
                File[] folders = root.listFiles();
                if (folders != null) for (File folder : folders) {
                    if (!Protocol.uuid(folder.getName()) || !folder.isDirectory() || !folder.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) continue;
                    File[] files = folder.listFiles(); if (files == null) continue;
                    boolean expired = System.currentTimeMillis() - folder.lastModified() > 24L * 60 * 60 * 1000;
                    for (File file : files) {
                        if (!file.getCanonicalFile().getParentFile().equals(folder.getCanonicalFile())) continue;
                        if (expired && file.isFile() && file.delete()) continue;
                        total += file.length();
                    }
                    if (expired && folder.delete()) continue;
                    count++;
                }
                Protocol.require(count < 32 && total + bytes.length <= 256L * 1024 * 1024, "file-capacity", "分享暫存已滿，請稍後再試或改用匯出檔案。");
                File folder = new File(root, Protocol.uuid()); Protocol.require(folder.mkdir(), "file-export", "無法建立分享暫存。");
                File file = new File(folder, name);
                try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(bytes); stream.flush(); stream.getFD().sync(); }
                Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".exports", file);
                CompletableFuture<Void> launched = new CompletableFuture<>();
                activity.runOnUiThread(() -> {
                    try {
                        Protocol.require(!closed, "native-closed", "原生工作階段已結束。");
                        Intent share = new Intent(Intent.ACTION_SEND).setType("application/octet-stream").putExtra(Intent.EXTRA_STREAM, uri)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        share.setClipData(ClipData.newRawUri(name, uri));
                        activity.startActivity(Intent.createChooser(share, "分享檔案")); launched.complete(null);
                    } catch (Exception error) { launched.completeExceptionally(error); }
                });
                launched.get(110, TimeUnit.SECONDS); return Protocol.object("completed", true, "shared", true);
            }
            CompletableFuture<Uri> result = new CompletableFuture<>();
            activity.runOnUiThread(() -> {
                try {
                    Protocol.require(!closed && picker == null, "file-busy", "選檔器目前使用中。"); picker = result;
                    activity.startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE, name), 40);
                } catch (Exception error) { result.completeExceptionally(error); }
            });
            Uri destination;
            try { destination = result.get(110, TimeUnit.SECONDS); }
            finally { if (picker == result) picker = null; }
            if (destination == null) return Protocol.object("completed", false);
            ParcelFileDescriptor descriptor = activity.getContentResolver().openFileDescriptor(destination, "w");
            Protocol.require(descriptor != null, "file-export", "無法寫入選擇的檔案。");
            try (ParcelFileDescriptor.AutoCloseOutputStream stream = new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)) { stream.write(bytes); stream.flush(); }
            return Protocol.object("completed", true, "shared", false);
        } finally { Arrays.fill(bytes, (byte) 0); }
    }
    void selected(int result, Intent data) {
        CompletableFuture<Uri> pending = picker; picker = null;
        if (pending != null) pending.complete(result == Activity.RESULT_OK && data != null ? data.getData() : null);
    }
    @Override public void close() { closed = true; CompletableFuture<Uri> pending = picker; picker = null; if (pending != null) pending.completeExceptionally(new IllegalStateException("Activity closed")); }
}
