// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats;

import static dev.mosaicast.plugin.stats.Zips.utf8;
import static dev.mosaicast.plugin.stats.Zips.zip;
import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.stats.read.Archive;
import dev.mosaicast.plugin.stats.read.StatsFormatException;
import java.io.ByteArrayInputStream;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

class ArchiveTest {

    private static final Archive.Limits SMALL = new Archive.Limits(64 * 1024, 4, 2048, 4096);

    @Test
    void readsEntries() throws Exception {
        Archive a = Archive.of(zip(Map.of("meta.json", utf8("{}"), "podcast/result.json", utf8("[]"))),
                Archive.Limits.DEFAULT);
        assertEquals(Set.of("meta.json", "podcast/result.json"), a.names());
        assertArrayEquals(utf8("[]"), a.bytes("podcast/result.json").orElseThrow());
    }

    @Test
    void treatsASingleTopFolderAsTheRoot() throws Exception {
        Map<String, byte[]> files = new LinkedHashMap<>();
        files.put("episode_2026/meta.json", utf8("{}"));
        files.put("episode_2026/podcast/result.json", utf8("{}"));
        Archive a = Archive.of(zip(files), Archive.Limits.DEFAULT);
        assertTrue(a.has("meta.json"));
        assertTrue(a.has("podcast/result.json"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"../evil.json", "podcast/../../evil.json", "/etc/passwd", "C:/evil.json",
            "a\\b.json", "./../x"})
    void refusesEntriesThatLeaveTheArchive(String name) {
        StatsFormatException e = assertThrows(StatsFormatException.class,
                () -> Archive.of(zip(Map.of(name, utf8("x"))), Archive.Limits.DEFAULT));
        assertEquals(StatsFormatException.UNSAFE_PATH, e.code());
    }

    @Test
    void stopsAnEntryThatInflatesPastTheLimit() {
        byte[] bomb = zip(Map.of("meta.json", new byte[100_000]));   // compresses to almost nothing
        assertTrue(bomb.length < SMALL.maxEntryBytes());
        StatsFormatException e = assertThrows(StatsFormatException.class, () -> Archive.of(bomb, SMALL));
        assertEquals(StatsFormatException.TOO_LARGE, e.code());
    }

    @Test
    void stopsWhenTheTotalGetsTooBig() {
        Map<String, byte[]> files = new LinkedHashMap<>();
        for (int i = 0; i < 3; i++) {
            files.put("f" + i, new byte[2000]);
        }
        StatsFormatException e = assertThrows(StatsFormatException.class, () -> Archive.of(zip(files), SMALL));
        assertEquals(StatsFormatException.TOO_LARGE, e.code());
    }

    @Test
    void stopsTooManyEntries() {
        Map<String, byte[]> files = new LinkedHashMap<>();
        for (int i = 0; i < 5; i++) {
            files.put("f" + i, utf8("x"));
        }
        StatsFormatException e = assertThrows(StatsFormatException.class, () -> Archive.of(zip(files), SMALL));
        assertEquals(StatsFormatException.TOO_LARGE, e.code());
    }

    @Test
    void stopsAnOversizedUploadBeforeUnpacking() {
        byte[] big = new byte[70 * 1024];
        big[0] = 'P';
        big[1] = 'K';
        StatsFormatException e = assertThrows(StatsFormatException.class,
                () -> Archive.read(new ByteArrayInputStream(big), SMALL));
        assertEquals(StatsFormatException.TOO_LARGE, e.code());
    }

    @Test
    void refusesWhatIsNotAZip() {
        StatsFormatException e = assertThrows(StatsFormatException.class,
                () -> Archive.of(utf8("{\"format\": 2}"), Archive.Limits.DEFAULT));
        assertEquals(StatsFormatException.NOT_AN_ARCHIVE, e.code());
    }
}
