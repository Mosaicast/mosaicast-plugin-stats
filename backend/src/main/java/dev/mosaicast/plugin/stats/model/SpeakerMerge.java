// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Renames speaker keys and folds speakers that end up under the same key into one. Used when a podcaster
 * says "{@code sprecher_1} in this episode is Alex".
 */
final class SpeakerMerge {

    private SpeakerMerge() {
    }

    static EpisodeStats apply(EpisodeStats stats, Map<String, String> renames) {
        Map<String, List<SpeakerStats>> byKey = new LinkedHashMap<>();
        for (SpeakerStats s : stats.speakers()) {
            String key = renames.getOrDefault(s.key(), s.key());
            byKey.computeIfAbsent(key, k -> new ArrayList<>()).add(s);
        }
        double total = stats.speakers().stream().mapToDouble(SpeakerStats::speakingSeconds).sum();
        List<SpeakerStats> merged = new ArrayList<>();
        byKey.forEach((key, group) -> merged.add(fold(key, group, total)));
        merged.sort(Comparator.comparingDouble(SpeakerStats::speakingSeconds).reversed());

        Timeline timeline = stats.timeline();
        if (timeline != null) {
            Map<String, List<double[]>> parts = new LinkedHashMap<>();
            timeline.speakers().forEach((key, flat) ->
                    parts.computeIfAbsent(renames.getOrDefault(key, key), k -> new ArrayList<>()).add(flat));
            Map<String, double[]> joined = new LinkedHashMap<>();
            parts.forEach((key, flats) -> joined.put(key, Intervals.toFlat(
                    Intervals.union(flats.stream().flatMap(f -> Intervals.fromFlat(f).stream()).toList()))));
            timeline = new Timeline(timeline.resolution(), joined);
        }
        return new EpisodeStats(stats.model(), stats.source(), stats.language(), stats.durationSeconds(),
                stats.speechSeconds(), stats.overlapSeconds(), stats.longestSilence(), stats.turns(),
                stats.words(), stats.unattributedWords(), stats.sentences(), stats.questions(), merged,
                stats.events(), stats.entities(), timeline, stats.warnings(), stats.extra());
    }

    private static SpeakerStats fold(String key, List<SpeakerStats> group, double total) {
        SpeakerStats first = group.getFirst();
        if (group.size() == 1) {
            return new SpeakerStats(key, first.label(), first.name(), first.speakingSeconds(), first.share(),
                    first.words(), first.wpm(), first.turns(), first.longestTurn(), first.questions());
        }
        double seconds = 0;
        Integer words = null;
        Integer turns = null;
        Integer questions = null;
        Gap longest = null;
        String name = null;
        for (SpeakerStats s : group) {
            seconds += s.speakingSeconds();
            words = add(words, s.words());
            turns = add(turns, s.turns());
            questions = add(questions, s.questions());
            if (s.longestTurn() != null && (longest == null || s.longestTurn().seconds() > longest.seconds())) {
                longest = s.longestTurn();
            }
            if (name == null) {
                name = s.name();
            }
        }
        Double wpm = words != null && seconds > 0 ? words / (seconds / 60.0) : null;
        double share = total > 0 ? seconds / total : 0;
        return new SpeakerStats(key, first.label(), name, seconds, share, words, wpm, turns, longest, questions);
    }

    private static Integer add(Integer a, Integer b) {
        if (a == null) {
            return b;
        }
        return b == null ? a : a + b;
    }
}
