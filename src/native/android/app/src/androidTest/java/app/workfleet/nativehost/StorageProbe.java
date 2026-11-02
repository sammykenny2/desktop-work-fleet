package app.workfleet.nativehost;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.ContextWrapper;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import android.os.Bundle;
import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;
import javax.crypto.spec.SecretKeySpec;

/** Real Android SQLite/CursorWindow/AES-GCM; no activity, account, production database or Keystore access. */
public final class StorageProbe extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        Bundle result = new Bundle(); File directory = null;
        try {
            directory = Files.createTempDirectory(getTargetContext().getCacheDir().toPath(), "storage-probe-").toFile();
            final File root = directory;
            Context isolated = new ContextWrapper(getTargetContext()) {
                @Override public File getFilesDir() { return root; }
                @Override public File getDatabasePath(String name) { return new File(root, name); }
                @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory) {
                    return SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name), factory);
                }
                @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory, DatabaseErrorHandler handler) {
                    return SQLiteDatabase.openOrCreateDatabase(getDatabasePath(name).getPath(), factory, handler);
                }
            };
            SecretKeySpec key = new SecretKeySpec(new byte[32], "AES");
            for (int size : new int[] { 3 * 1024 * 1024, Protocol.ATTACHMENT }) {
                byte[] bytes = new byte[size]; Arrays.fill(bytes, (byte) 79);
                String digest = Protocol.digest(bytes);
                try (FleetDatabase database = new FleetDatabase(isolated, "local", key)) {
                    database.putAttachment(database.stage("attachment", bytes, digest));
                    if (!Arrays.equals(database.attachment(digest), bytes)) throw new AssertionError("Attachment changed before reopen");
                }
                try (FleetDatabase database = new FleetDatabase(isolated, "local", key)) {
                    if (!Arrays.equals(database.attachment(digest), bytes)) throw new AssertionError("Attachment changed after reopen");
                    database.reset();
                }
            }
            result.putString("stream", "PASS Android 3 MiB and 25 MiB encrypted attachment read/reopen\n");
            finish(Activity.RESULT_OK, result);
        } catch (Throwable error) {
            result.putString("stream", "FAIL " + android.util.Log.getStackTraceString(error)); finish(Activity.RESULT_CANCELED, result);
        } finally {
            if (directory != null) {
                File[] files = directory.listFiles(); if (files != null) for (File file : files) file.delete();
                directory.delete();
            }
        }
    }
}
