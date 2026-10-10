// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import dev.mosaicast.plugin.stats.model.SpeakerStats;
import dev.mosaicast.plugin.stats.read.Archive;
import dev.mosaicast.plugin.stats.read.ReaderRegistry;
import dev.mosaicast.plugin.stats.read.StatsFormatException;
import dev.mosaicast.plugin.stats.read.StatsUnit;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Runs every ZIP in a local folder through the readers and prints what came out. Only runs when asked:
 * {@code ./gradlew test -PstatsSamples=/path/to/results}. Handy before a release, with real results that
 * can't go into the repo.
 */
class LocalResultsTest {

    @Test
    void readsLocalResults() throws Exception {
        String dir = System.getProperty("stats.samples");
        assumeTrue(dir != null && Files.isDirectory(Path.of(dir)), "no -PstatsSamples folder given");
        List<Path> zips;
        try (Stream<Path> files = Files.list(Path.of(dir))) {
            zips = files.filter(p -> p.toString().endsWith(".zip")).sorted().toList();
        }
        assumeTrue(!zips.isEmpty(), "no ZIPs in " + dir);
        ReaderRegistry readers = ReaderRegistry.builtIn();
        for (Path zip : zips) {
            try (InputStream in = Files.newInputStream(zip)) {
                Archive archive = Archive.read(in, Archive.Limits.DEFAULT);
                for (StatsUnit unit : readers.select(archive, null).read(archive)) {
                    if (unit.book() != null) {
                        BookStats b = unit.book();
                        String json = tools.jackson.databind.json.JsonMapper.builder().build().writeValueAsString(b);
                        System.out.printf("%s%n  book %s, %d chapters, %d words, %d KB stored%n", zip.getFileName(),
                                b.title(), b.chapters().size(), b.summary().words(), json.length() / 1024);
                        b.chapters().stream().limit(4).forEach(c -> System.out.printf(
                                "    %-12s %6d words %5s sentences  top %s  new %s%n", c.heading(), c.words(),
                                c.sentences(), c.characters().stream().limit(3).map(e -> e.text()).toList(),
                                c.newCharacters().stream().limit(3).map(e -> e.text()).toList()));
                        Map<String, Long> groups = new TreeMap<>(b.chapters().stream()
                                .filter(c -> c.group() != null)
                                .collect(Collectors.groupingBy(BookStats.Chapter::group, Collectors.counting())));
                        System.out.printf("    chapter groups %s, %d chapters in none%n", groups,
                                b.chapters().stream().filter(c -> c.group() == null).count());
                        continue;
                    }
                    EpisodeStats s = unit.stats();
                    System.out.printf("%s%n  %s, %.0f s, speech %.0f s, silence %s, %d words, %s%n",
                            zip.getFileName(), unit.hint(), s.durationSeconds(), s.speechSeconds(),
                            s.longestSilence(), s.words(), s.warnings());
                    for (SpeakerStats sp : s.speakers()) {
                        System.out.printf("    %-12s %-14s %6.0f s %5.1f %%  %5d words  %5.1f wpm  %d turns  %s?%n",
                                sp.label(), sp.key(), sp.speakingSeconds(), sp.share() * 100, sp.words(), sp.wpm(),
                                sp.turns(), sp.questions());
                    }
                    s.events().forEach(e -> System.out.printf("    event %s x%d%n", e.label(), e.count()));
                    s.entities().forEach(g -> System.out.printf("    %s %s%n", g.label(),
                            g.top().subList(0, Math.min(6, g.top().size()))));
                    assertFalse(s.speakers().isEmpty(), zip.toString());
                }
            } catch (StatsFormatException e) {
                System.out.printf("%s%n  not imported: %s (%s)%n", zip.getFileName(), e.code(), e.getMessage());
            }
        }
    }
}
