package app.workfleet.nativehost;

import org.junit.Test;
import static org.junit.Assert.*;

public final class DatasetFilesTest {
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
