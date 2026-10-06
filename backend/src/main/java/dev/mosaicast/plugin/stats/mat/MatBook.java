// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.mat;

import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.BookStats.Chapter;
import dev.mosaicast.plugin.stats.model.EntityGroup;
import dev.mosaicast.plugin.stats.model.EntityGroup.EntityCount;
import dev.mosaicast.plugin.stats.model.Source;
import dev.mosaicast.plugin.stats.model.Warning;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import tools.jackson.databind.JsonNode;

/**
 * Reads a MAT {@code book/result.json} (format 2) into {@link BookStats}. Text is only counted, never kept:
 * words and sentences per chapter, sentence lengths, direct speech and questions, the character list MAT
 * already built (names and mention counts per chapter heading) and the places and groups its sentences name.
 */
final class MatBook {

    private MatBook() {
    }

    static BookStats read(JsonNode root, Source source, List<Warning> warnings) {
        JsonNode chapters = root.path("chapters");
        List<String> headings = new ArrayList<>();
        Map<String, Integer> indexOf = new HashMap<>();
        for (JsonNode c : chapters.values()) {
            String heading = MatPodcast.text(c.get("heading"));
            if (heading == null || heading.isBlank()) {
                heading = "#" + (headings.size() + 1);
            }
            indexOf.putIfAbsent(heading, headings.size());
            headings.add(heading);
        }

        // Character mentions per chapter, and the chapter each character first shows up in.
        List<Map<String, Integer>> perChapter = new ArrayList<>();
        for (int i = 0; i < headings.size(); i++) {
            perChapter.add(new HashMap<>());
        }
        Map<String, Integer> firstChapter = new HashMap<>();
        Map<String, Integer> total = new HashMap<>();
        for (JsonNode ch : root.path("characters").values()) {
            String name = MatPodcast.text(ch.get("name"));
            if (name == null || name.isBlank()) {
                continue;
            }
            Double mentions = MatPodcast.number(ch.get("mentions"));
            total.put(name, mentions == null ? 0 : mentions.intValue());
            int first = Integer.MAX_VALUE;
            for (Map.Entry<String, JsonNode> e : ch.path("chapters").properties()) {
                Integer idx = indexOf.get(e.getKey());
                Double n = MatPodcast.number(e.getValue());
                if (idx == null || n == null || n <= 0) {
                    continue;
                }
                perChapter.get(idx).merge(name, n.intValue(), Integer::sum);
                first = Math.min(first, idx);
            }
            if (first != Integer.MAX_VALUE) {
                firstChapter.put(name, first);
            }
        }

        List<Chapter> out = new ArrayList<>();
        int i = 0;
        for (JsonNode c : chapters.values()) {
            int words = 0;
            int paragraphs = 0;
            for (JsonNode p : c.path("paragraphs").values()) {
                String text = MatPodcast.text(p);
                if (text != null && !text.isBlank()) {
                    paragraphs++;
                    words += countWords(text);
                }
            }
            Sentences s = sentences(c.path("sentences"));
            Map<String, Integer> mentions = perChapter.get(i);
            final int idx = i;
            List<EntityCount> top = topOf(mentions, Comparator.comparingInt((Map.Entry<String, Integer> e) -> e.getValue()).reversed());
            Map<String, Integer> newcomers = new HashMap<>();
            mentions.forEach((name, n) -> {
                if (firstChapter.getOrDefault(name, -1) == idx) {
                    newcomers.put(name, n);
                }
            });
            // First appearances by how big a part they play in the whole book, so main characters lead.
            List<EntityCount> fresh = topOf(newcomers, Comparator.comparingInt(
                    (Map.Entry<String, Integer> e) -> total.getOrDefault(e.getKey(), 0)).reversed());
            out.add(new Chapter("c" + i, i, headings.get(i), words, s.count, paragraphs, s.longest, s.dialogue,
                    s.questions, top, fresh, s.entities));
            i++;
        }
        if (out.isEmpty()) {
            warnings = new ArrayList<>(warnings);
            warnings.add(new Warning("no-chapters", Map.of()));
        }
        return new BookStats(BookStats.MODEL, source, MatPodcast.text(root.get("title")),
                MatPodcast.text(root.get("language")), out, warnings);
    }

    /** Labels left out of a chapter's names: people come from the character list, the rest is noise. */
    private static final Set<String> SKIPPED_LABELS = Set.of("PERSON", "PER", "DATE", "TIME", "CARDINAL",
            "ORDINAL", "QUANTITY", "PERCENT", "MONEY");

    /** Quotation marks that open or close direct speech. Apostrophes (' ’) are left out on purpose. */
    private static final Pattern SPEECH = Pattern.compile("[\u201E\u201C\u201D\"\u00BB\u00AB\u2039\u203A]");

    /** A question mark at the end, maybe followed by closing quotes or brackets. */
    private static final Pattern QUESTION = Pattern.compile("\\?[\\s\u201C\u201D\"\u00BB\u00AB\u2039\u203A'\u2019)\\]]*$");

    /** What one chapter's sentences add up to; all null when the source didn't split sentences. */
    private record Sentences(Integer count, Integer longest, Integer dialogue, Integer questions,
                             List<EntityGroup> entities) {
    }

    /**
     * Counts a chapter's sentences: how long the longest one is, how many carry direct speech or end in a
     * question, and which places, groups, … they name. The text itself is dropped right here.
     */
    private static Sentences sentences(JsonNode list) {
        if (!list.isArray() || list.isEmpty()) {
            return new Sentences(null, null, null, null, List.of());
        }
        int longest = 0;
        int dialogue = 0;
        int questions = 0;
        Map<String, Map<String, Map<String, Integer>>> byLabel = new LinkedHashMap<>();
        for (JsonNode s : list.values()) {
            String text = MatPodcast.text(s.get("text"));
            if (text != null) {
                longest = Math.max(longest, countWords(text));
                if (SPEECH.matcher(text).find()) {
                    dialogue++;
                }
                if (QUESTION.matcher(text.strip()).find()) {
                    questions++;
                }
            }
            for (JsonNode e : s.path("entities").values()) {
                String label = MatPodcast.text(e.get("label"));
                String name = MatPodcast.text(e.get("text"));
                if (label == null || name == null || SKIPPED_LABELS.contains(label.toUpperCase(Locale.ROOT))) {
                    continue;
                }
                String key = MatAnalysis.fold(name);
                if (key.isEmpty()) {
                    continue;
                }
                byLabel.computeIfAbsent(label, k -> new LinkedHashMap<>())
                        .computeIfAbsent(key, k -> new LinkedHashMap<>())
                        .merge(name.strip(), 1, Integer::sum);
            }
        }
        List<EntityGroup> groups = new ArrayList<>();
        byLabel.forEach((label, byKey) -> {
            List<EntityCount> counts = new ArrayList<>();
            byKey.values().forEach(spellings -> {
                int n = spellings.values().stream().mapToInt(Integer::intValue).sum();
                String shown = spellings.entrySet().stream().max(Map.Entry.comparingByValue()).orElseThrow().getKey();
                counts.add(new EntityCount(shown, n));
            });
            counts.sort(Comparator.comparingInt(EntityCount::count).reversed().thenComparing(EntityCount::text));
            groups.add(new EntityGroup(label, counts.subList(0, Math.min(BookStats.TOP, counts.size()))));
        });
        return new Sentences(list.size(), longest, dialogue, questions, groups);
    }

    private static List<EntityCount> topOf(Map<String, Integer> counts,
                                           Comparator<Map.Entry<String, Integer>> order) {
        return counts.entrySet().stream()
                .sorted(order.thenComparing(Map.Entry.comparingByKey()))
                .limit(BookStats.TOP)
                .map(e -> new EntityCount(e.getKey(), e.getValue()))
                .toList();
    }

    /** Whitespace-separated tokens that contain at least one letter or digit. */
    static int countWords(String text) {
        int n = 0;
        for (String token : text.split("\\s+")) {
            if (token.codePoints().anyMatch(Character::isLetterOrDigit)) {
                n++;
            }
        }
        return n;
    }
}
