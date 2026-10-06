// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.mat;

import static dev.mosaicast.plugin.stats.Zips.utf8;
import static dev.mosaicast.plugin.stats.Zips.zip;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.stats.Zips;
import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import dev.mosaicast.plugin.stats.model.SpeakerStats;
import dev.mosaicast.plugin.stats.read.Archive;
import dev.mosaicast.plugin.stats.read.ReaderRegistry;
import dev.mosaicast.plugin.stats.read.StatsFormatException;
import dev.mosaicast.plugin.stats.read.StatsUnit;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** Against MAT's own example result (format 2.6.0) and a few broken variants of it. */
class MatStatsReaderTest {

    private final MatStatsReader reader = new MatStatsReader();

    private static Archive archive(Map<String, byte[]> files) throws StatsFormatException {
        return Archive.of(zip(files), Archive.Limits.DEFAULT);
    }

    @Test
    void readsTheOfficialExample() throws Exception {
        Archive a = archive(Zips.matExample());
        assertTrue(reader.canRead(a));
        assertEquals("mat", ReaderRegistry.builtIn().select(a, null).id());

        List<StatsUnit> units = reader.read(a);
        assertEquals(1, units.size());
        StatsUnit unit = units.getFirst();
        assertEquals(StatsUnit.Level.EPISODE, unit.level());
        assertEquals("sample.wav", unit.hint());

        EpisodeStats s = unit.stats();
        assertEquals("mat", s.source().reader());
        assertEquals("2.6.0", s.source().format());
        assertEquals("MAT 0.2.0", s.source().tool());
        assertEquals("sample.wav", s.source().inputName());
        assertEquals("en", s.language());
        assertEquals(30.0, s.durationSeconds());
        assertEquals(79, s.words());
        assertEquals(14, s.sentences());
        assertEquals(2, s.speakers().size());
        assertEquals(1.0, s.speakers().stream().mapToDouble(SpeakerStats::share).sum(), 1e-9);
        for (SpeakerStats sp : s.speakers()) {
            assertTrue(sp.speakingSeconds() > 5, sp.label());
            assertNotNull(sp.wpm());
            assertEquals(sp.label(), sp.key(), "no speaker library in the example, so the label is the key");
        }
        assertTrue(s.speechSeconds() <= s.durationSeconds());
        assertNotNull(s.longestSilence());
        assertNotNull(s.timeline());
        assertEquals(2, s.timeline().speakers().size());
        assertTrue(s.warnings().isEmpty(), () -> "unexpected warnings " + s.warnings());
        assertFalse(s.entities().isEmpty());
        assertEquals(Map.of(), s.summary().extra());
        assertNull(s.summary().timeline());
    }

    @Test
    void neverStoresTheProducingMachinesPath() throws Exception {
        EpisodeStats s = reader.read(archive(Zips.matExample())).getFirst().stats();
        assertFalse(s.toString().contains("/data/"), "input.path must not end up in the stats");
    }

    @Test
    void explainsFormatOne() throws Exception {
        Archive a = archive(Map.of("meta.json", utf8("""
                {"version": "1", "MAT_version": "0.2.0", "pipelines": [{"folder": "0.PodcastOutput"}]}""")));
        assertTrue(reader.canRead(a));
        StatsFormatException e = assertThrows(StatsFormatException.class, () -> reader.read(a));
        assertEquals(StatsFormatException.UNSUPPORTED_VERSION, e.code());
    }

    @Test
    void refusesAFutureFormat() throws Exception {
        Archive a = archive(Map.of("meta.json", utf8("""
                {"format": 3, "mat_version": "9.0.0", "pipelines": ["podcast"]}""")));
        StatsFormatException e = assertThrows(StatsFormatException.class, () -> reader.read(a));
        assertEquals(StatsFormatException.UNSUPPORTED_VERSION, e.code());
    }

    @Test
    void readsABookChapterByChapter() throws Exception {
        Archive a = archive(Zips.matBookExample());
        assertTrue(reader.canRead(a));
        List<StatsUnit> units = reader.read(a);
        assertEquals(1, units.size());
        StatsUnit unit = units.getFirst();
        assertEquals(StatsUnit.BOOK, unit.kind());
        assertEquals("Smoke Book", unit.hint());

        BookStats book = unit.book();
        assertEquals(List.of("Chapter 1", "Chapter 2", "Epilogue"),
                book.chapters().stream().map(BookStats.Chapter::heading).toList());
        BookStats.Chapter first = book.chapters().getFirst();
        assertEquals("c0", first.id());
        assertEquals(2, first.paragraphs());
        assertEquals(2, first.sentences());
        assertTrue(first.words() > 0);
        assertEquals(List.of("Alice", "Bob"), first.newCharacters().stream().map(e -> e.text()).sorted().toList());
        assertTrue(book.chapters().get(1).newCharacters().isEmpty(), "they were introduced in chapter 1");
        assertEquals(2, book.chapters().get(1).characters().size());
    }

    @Test
    void keepsNoTextOfTheBook() throws Exception {
        BookStats book = reader.read(archive(Zips.matBookExample())).getFirst().book();
        tools.jackson.databind.json.JsonMapper json = tools.jackson.databind.json.JsonMapper.builder().build();
        String stored = json.writeValueAsString(book);
        // Every paragraph and sentence of the source; none may end up in what the plugin stores.
        tools.jackson.databind.JsonNode source = json.readTree(Zips.resource("/mat-example-book/book/result.json"));
        int checked = 0;
        for (tools.jackson.databind.JsonNode chapter : source.path("chapters").values()) {
            for (tools.jackson.databind.JsonNode p : chapter.path("paragraphs").values()) {
                assertFalse(stored.contains(p.asString()), "paragraph text must not be stored");
                checked++;
            }
            for (tools.jackson.databind.JsonNode sentence : chapter.path("sentences").values()) {
                assertFalse(stored.contains(sentence.path("text").asString()), "sentence text must not be stored");
                checked++;
            }
        }
        assertTrue(checked > 5);
    }

    @Test
    void countsWordsNotPunctuation() {
        assertEquals(4, MatBook.countWords("Hello -- there, \u201eyou\u201c two!"));
    }

    @Test
    void aMissingResultIsBroken() throws Exception {
        Map<String, byte[]> files = new java.util.LinkedHashMap<>(Zips.matExample());
        files.remove("podcast/result.json");
        StatsFormatException e = assertThrows(StatsFormatException.class, () -> reader.read(archive(files)));
        assertEquals(StatsFormatException.BROKEN, e.code());
    }

    @Test
    void invalidJsonIsBroken() throws Exception {
        Map<String, byte[]> files = new java.util.LinkedHashMap<>(Zips.matExample());
        files.put("podcast/result.json", utf8("{\"schema\": \"mat.podcast\", "));
        StatsFormatException e = assertThrows(StatsFormatException.class, () -> reader.read(archive(files)));
        assertEquals(StatsFormatException.BROKEN, e.code());
    }

    @Test
    void doesNotClaimSomebodyElsesArchive() throws Exception {
        Archive a = archive(Map.of("meta.json", utf8("{\"tool\": \"other\"}"), "data.csv", utf8("a,b")));
        assertFalse(reader.canRead(a));
        StatsFormatException e = assertThrows(StatsFormatException.class,
                () -> ReaderRegistry.builtIn().select(a, null));
        assertEquals(StatsFormatException.UNKNOWN_FORMAT, e.code());
    }

    @Test
    void reportsFailedSteps() throws Exception {
        Map<String, byte[]> files = new java.util.LinkedHashMap<>(Zips.matExample());
        files.put("meta.json", utf8("""
                {"format": 2, "format_version": "2.6.0", "mat_version": "0.3.1",
                 "input": {"name": "ep.mp3", "path": "/x/ep.mp3", "sha1": "abc"}, "pipelines": ["podcast"],
                 "failed_steps": [{"pipeline": "podcast", "step": "events", "error": "boom"}]}"""));
        EpisodeStats s = reader.read(archive(files)).getFirst().stats();
        assertEquals("step-failed", s.warnings().getFirst().code());
        assertEquals("podcast/events", s.warnings().getFirst().params().get("step"));
        assertEquals("abc", s.source().inputHash());
    }
}
