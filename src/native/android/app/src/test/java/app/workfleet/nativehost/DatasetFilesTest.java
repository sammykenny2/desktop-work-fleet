package app.workfleet.nativehost;

import org.junit.Test;
import static org.junit.Assert.*;

public final class DatasetFilesTest {
    @Test public void batchDeletionIsBoundedAndCannotInjectPaths() throws Exception {
        String body = new String(DatasetFiles.deleteBatchIds(java.util.Arrays.asList("old-one", "old-two")), java.nio.charset.StandardCharsets.US_ASCII);
        assertTrue(body.contains("Content-ID: wf-0\r\n\r\nDELETE /drive/v3/files/old-one HTTP/1.1"));
        assertTrue(body.contains("Content-ID: wf-1\r\n\r\nDELETE /drive/v3/files/old-two HTTP/1.1"));
        assertTrue(body.endsWith("--work_fleet_delete--\r\n"));
        for (java.util.List<String> ids : java.util.Arrays.asList(java.util.Arrays.asList("root"), java.util.Arrays.asList("appDataFolder"),
                java.util.Arrays.asList("one", "one"), java.util.Arrays.asList("bad\r\nDELETE /"), java.util.Collections.<String>emptyList(), java.util.Collections.nCopies(101, "one"))) {
            try { DatasetFiles.deleteBatchIds(ids); fail("Invalid deletion IDs accepted"); }
            catch (Protocol.Failure expected) { assertEquals("invalid-source-file", expected.code); }
        }
    }
    @Test public void identitiesCannotChangePathsOrTypedQueryStructure() {
        assertTrue(DatasetFiles.fileId("reserved-file_1"));
        assertTrue(DatasetFiles.datasetId("11111111-2222-3333-4444-555555555555"));
        for (String value : new String[] {"", "../file", "file\n", "a' or true", "__proto__", "constructor"}) {
            assertFalse(DatasetFiles.fileId(value)); assertFalse(DatasetFiles.entityId(value)); assertFalse(DatasetFiles.datasetId(value));
        }
        assertFalse(DatasetFiles.datasetId("11111111-2222-3333-4444-555555555555\n"));
        assertEquals(17, DatasetFiles.SHARDS.size());
    }
}
