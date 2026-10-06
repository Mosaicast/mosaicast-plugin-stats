// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.mat;

import dev.mosaicast.plugin.stats.mat.MatPodcast.Item;
import dev.mosaicast.plugin.stats.mat.MatPodcast.Speaker;
import dev.mosaicast.plugin.stats.model.EntityGroup;
import dev.mosaicast.plugin.stats.model.EntityGroup.EntityCount;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import dev.mosaicast.plugin.stats.model.EventStats;
import dev.mosaicast.plugin.stats.model.Gap;
import dev.mosaicast.plugin.stats.model.Intervals;
import dev.mosaicast.plugin.stats.model.Intervals.Span;
import dev.mosaicast.plugin.stats.model.Source;
import dev.mosaicast.plugin.stats.model.SpeakerStats;
import dev.mosaicast.plugin.stats.model.Timeline;
import dev.mosaicast.plugin.stats.model.Warning;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/** Computes normalized stats from a parsed MAT podcast result. */
final class MatAnalysis {

    /** Top entities kept per label. */
    static final int TOP_ENTITIES = 15;
    /** Timeline: gaps shorter than this are closed, times rounded to {@link #TIMELINE_STEP}. */
    static final double TIMELINE_GAP = 1.0;
    static final double TIMELINE_STEP = 0.1;
    /**
     * A speaker whose segment time is below this fraction of the time their lines take is treated as
     * broken (see {@link #reconcile}). Lines include short pauses inside a turn, so a healthy speaker sits
     * around 0.8; the broken case seen in the wild is close to 0.
     */
    static final double MISMATCH_RATIO = 0.5;
    /** Below this many seconds of lines a mismatch isn't worth acting on. */
    static final double MISMATCH_MIN_SECONDS = 60;

    private MatAnalysis() {
    }

    static EpisodeStats analyze(MatPodcast p, Source source, List<Warning> warnings) {
        List<Warning> notes = new ArrayList<>(warnings);
        List<Resolved> speakers = reconcile(p, notes);

        Map<String, Integer> wordCounts = new HashMap<>();
        int unattributed = 0;
        for (Item w : p.words()) {
            if (w.speakers().isEmpty()) {
                unattributed++;
            }
            for (String s : new LinkedHashSet<>(w.speakers())) {
                wordCounts.merge(s, 1, Integer::sum);
            }
        }
        boolean hasWords = !p.words().isEmpty();
        boolean hasSentences = !p.sentences().isEmpty();

        double sum = speakers.stream().mapToDouble(r -> Intervals.total(r.speech())).sum();
        List<SpeakerStats> stats = new ArrayList<>();
        List<Span> everyone = new ArrayList<>();
        Map<String, double[]> timeline = new LinkedHashMap<>();
        Set<String> usedKeys = new HashSet<>();
        for (Resolved r : speakers) {
            String key = r.libraryId() != null && !r.libraryId().isBlank() ? r.libraryId() : r.id();
            if (!usedKeys.add(key)) {
                key = key + "#" + r.id();
                usedKeys.add(key);
            }
            double seconds = Intervals.total(r.speech());
            everyone.addAll(r.speech());
            Integer words = hasWords ? wordCounts.getOrDefault(r.id(), 0) : null;
            Double wpm = words != null && seconds > 0 ? round1(words / (seconds / 60.0)) : null;
            int turns = 0;
            Gap longest = null;
            for (Item line : p.lines()) {
                if (!line.timed() || !line.speakers().contains(r.id())) {
                    continue;
                }
                turns++;
                double len = line.end() - line.start();
                if (line.bySingle(r.id()) && (longest == null || len > longest.seconds())) {
                    longest = new Gap(round1(len), round1(line.start()));
                }
            }
            Integer questions = hasSentences ? (int) p.sentences().stream()
                    .filter(s -> s.bySingle(r.id()) && isQuestion(s.text())).count() : null;
            stats.add(new SpeakerStats(key, r.id(), r.name(), round1(seconds), sum > 0 ? seconds / sum : 0,
                    words, wpm, p.lines().isEmpty() ? null : turns, longest, questions));
            timeline.put(key, Intervals.toFlat(Intervals.closeGaps(r.speech(), TIMELINE_GAP).stream()
                    .map(s -> new Span(Intervals.round(s.start(), TIMELINE_STEP),
                            Intervals.round(s.end(), TIMELINE_STEP)))
                    .toList()));
        }
        stats.sort(Comparator.comparingDouble(SpeakerStats::speakingSeconds).reversed());

        List<Span> union = Intervals.union(everyone);
        double speech = Intervals.total(union);
        Gap silence = Intervals.longestGap(union);

        Double duration = p.duration();
        if (duration == null) {
            duration = p.lines().stream().filter(Item::timed).mapToDouble(Item::end).max()
                    .orElse(union.isEmpty() ? Double.NaN : union.getLast().end());
            duration = Double.isNaN(duration) ? null : duration;
        }

        return new EpisodeStats(
                EpisodeStats.MODEL,
                source,
                p.language(),
                duration == null ? null : round1(duration),
                union.isEmpty() ? null : round1(speech),
                union.isEmpty() ? null : round1(Math.max(0, sum - speech)),
                silence == null ? null : new Gap(round1(silence.seconds()), round1(silence.at())),
                p.lines().isEmpty() ? null : floorChanges(p.lines()),
                hasWords ? p.words().size() : null,
                hasWords ? unattributed : null,
                hasSentences ? p.sentences().size() : null,
                hasSentences ? (int) p.sentences().stream().filter(s -> isQuestion(s.text())).count() : null,
                stats,
                events(p),
                entities(p, speakers),
                new Timeline(TIMELINE_STEP, timeline),
                notes,
                p.models().isEmpty() ? Map.of() : Map.of("models", p.models()));
    }

    /** A speaker after reconciliation: the speech we trust for them. */
    record Resolved(String id, String name, String libraryId, List<Span> speech) {
    }

    /**
     * Takes {@code speakers} as the truth, as the format says, except where it contradicts the transcript:
     * a speaker whose segments add up to far less than the lines attributed to them, or one the lines name
     * but {@code speakers} doesn't list. For those, the speech is rebuilt from the diarizer clusters whose
     * words were mostly attributed to that speaker. Every such repair leaves a warning on the import.
     */
    static List<Resolved> reconcile(MatPodcast p, List<Warning> warnings) {
        Map<String, Double> lineTime = new LinkedHashMap<>();
        for (Item line : p.lines()) {
            if (line.timed()) {
                for (String s : line.speakers()) {
                    lineTime.merge(s, line.end() - line.start(), Double::sum);
                }
            }
        }
        Map<String, List<Span>> clusters = null;
        List<Resolved> out = new ArrayList<>();
        Set<String> listed = new HashSet<>();
        for (Speaker s : p.speakers()) {
            listed.add(s.id());
            List<Span> speech = Intervals.union(s.segments());
            double have = Intervals.total(speech);
            double expected = lineTime.getOrDefault(s.id(), 0.0);
            if (expected >= MISMATCH_MIN_SECONDS && have < MISMATCH_RATIO * expected) {
                if (clusters == null) {
                    clusters = clustersBySpeaker(p);
                }
                List<Span> merged = new ArrayList<>(speech);
                merged.addAll(clusters.getOrDefault(s.id(), List.of()));
                List<Span> rebuilt = Intervals.union(merged);
                double now = Intervals.total(rebuilt);
                if (now > have + 1) {
                    warnings.add(warning("speaker-rebuilt", s.id(), have, now));
                    speech = rebuilt;
                } else {
                    warnings.add(warning("speaker-mismatch", s.id(), have, expected));
                }
            }
            out.add(new Resolved(s.id(), s.name(), s.libraryId(), speech));
        }
        for (Map.Entry<String, Double> e : lineTime.entrySet()) {
            String id = e.getKey();
            if (listed.contains(id) || e.getValue() < MISMATCH_MIN_SECONDS) {
                continue;
            }
            if (clusters == null) {
                clusters = clustersBySpeaker(p);
            }
            List<Span> rebuilt = Intervals.union(clusters.getOrDefault(id, List.of()));
            if (!rebuilt.isEmpty()) {
                warnings.add(warning("speaker-added", id, 0, Intervals.total(rebuilt)));
                out.add(new Resolved(id, null, null, rebuilt));
            }
        }
        return out;
    }

    /**
     * Assigns each diarizer cluster to the speaker most of its words are attributed to (more than half of
     * the cluster's attributed words), and returns the clusters' segments per speaker.
     */
    static Map<String, List<Span>> clustersBySpeaker(MatPodcast p) {
        record Owned(Span span, int cluster) {
        }
        List<Owned> spans = new ArrayList<>();
        for (int c = 0; c < p.diarization().size(); c++) {
            for (Span s : p.diarization().get(c).segments()) {
                spans.add(new Owned(s, c));
            }
        }
        spans.sort(Comparator.comparingDouble(o -> o.span().start()));
        List<Map<String, Integer>> votes = new ArrayList<>();
        for (int c = 0; c < p.diarization().size(); c++) {
            votes.add(new HashMap<>());
        }
        for (Item w : p.words()) {
            if (!w.timed() || w.speakers().isEmpty()) {
                continue;
            }
            double mid = (w.start() + w.end()) / 2;
            int lo = 0;
            int hi = spans.size() - 1;
            int found = -1;
            while (lo <= hi) {
                int m = (lo + hi) >>> 1;
                if (spans.get(m).span().start() <= mid) {
                    found = m;
                    lo = m + 1;
                } else {
                    hi = m - 1;
                }
            }
            // Segments of different clusters may overlap, so look back a little for one that contains mid.
            for (int i = found; i >= 0 && i > found - 8; i--) {
                Owned o = spans.get(i);
                if (o.span().end() >= mid) {
                    for (String s : w.speakers()) {
                        votes.get(o.cluster()).merge(s, 1, Integer::sum);
                    }
                    break;
                }
            }
        }
        Map<String, List<Span>> out = new HashMap<>();
        for (int c = 0; c < votes.size(); c++) {
            Map<String, Integer> v = votes.get(c);
            int all = v.values().stream().mapToInt(Integer::intValue).sum();
            List<Span> segments = p.diarization().get(c).segments();
            v.entrySet().stream().max(Map.Entry.comparingByValue())
                    .filter(best -> best.getValue() * 2 > all)
                    .ifPresent(best -> out.computeIfAbsent(best.getKey(), k -> new ArrayList<>()).addAll(segments));
        }
        return out;
    }

    private static int floorChanges(List<Item> lines) {
        int changes = 0;
        List<String> previous = null;
        for (Item line : lines) {
            if (!line.timed() || line.speakers().isEmpty()) {
                continue;
            }
            if (previous != null && !previous.equals(line.speakers())) {
                changes++;
            }
            previous = line.speakers();
        }
        return changes;
    }

    private static List<EventStats> events(MatPodcast p) {
        Map<String, List<MatPodcast.Event>> byLabel = new LinkedHashMap<>();
        for (MatPodcast.Event e : p.events()) {
            byLabel.computeIfAbsent(e.label(), k -> new ArrayList<>()).add(e);
        }
        List<EventStats> out = new ArrayList<>();
        byLabel.forEach((label, list) -> out.add(new EventStats(label, list.size(),
                round1(list.stream().mapToDouble(e -> Math.max(0, e.end() - e.start())).sum()),
                list.stream().map(e -> round1(e.start())).toList())));
        return out;
    }

    /**
     * Most mentioned entities per label, case-insensitive, shown in their most common spelling. The hosts
     * themselves are left out: people address each other by name all the time, and "Alex mentioned Alex
     * 40 times" is noise.
     */
    private static List<EntityGroup> entities(MatPodcast p, List<Resolved> speakers) {
        Set<String> hosts = new HashSet<>();
        for (Resolved r : speakers) {
            hosts.add(fold(r.id()));
            if (r.name() != null) {
                hosts.add(fold(r.name()));
            }
        }
        Map<String, Map<String, Map<String, Integer>>> byLabel = new LinkedHashMap<>();
        for (MatPodcast.Entity e : p.entities()) {
            String key = fold(e.text());
            if (key.isEmpty() || hosts.contains(key)) {
                continue;
            }
            byLabel.computeIfAbsent(e.label(), k -> new LinkedHashMap<>())
                    .computeIfAbsent(key, k -> new LinkedHashMap<>())
                    .merge(e.text(), 1, Integer::sum);
        }
        List<EntityGroup> out = new ArrayList<>();
        byLabel.forEach((label, byKey) -> {
            List<EntityCount> counts = new ArrayList<>();
            byKey.values().forEach(spellings -> {
                int total = spellings.values().stream().mapToInt(Integer::intValue).sum();
                String shown = spellings.entrySet().stream().max(Map.Entry.comparingByValue()).orElseThrow().getKey();
                counts.add(new EntityCount(shown, total));
            });
            counts.sort(Comparator.comparingInt(EntityCount::count).reversed().thenComparing(EntityCount::text));
            out.add(new EntityGroup(label, counts.subList(0, Math.min(TOP_ENTITIES, counts.size()))));
        });
        return out;
    }

    static String fold(String s) {
        return Normalizer.normalize(s, Normalizer.Form.NFKC).strip().toLowerCase(Locale.ROOT);
    }

    private static boolean isQuestion(String text) {
        return text != null && text.strip().endsWith("?");
    }

    private static Warning warning(String code, String speaker, double before, double after) {
        return new Warning(code, Map.of("speaker", speaker,
                "before", String.valueOf(Math.round(before)), "after", String.valueOf(Math.round(after))));
    }

    static double round1(double v) {
        return Intervals.round(v, 0.1);
    }
}
