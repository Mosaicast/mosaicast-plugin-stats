// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.ingest;

import dev.mosaicast.plugin.stats.ingest.Docs.Candidate;
import java.text.Normalizer;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Suggests which episode an analysis belongs to by comparing the analysed file name with episode titles.
 * It only suggests; a podcaster confirms.
 *
 * <p>Words are compared as sets (Dice coefficient). Numbers count extra because episode files and titles
 * usually share a number ("5.01 Jaime I.mp3" vs "5.01 - Jaime I"): equal number sequences raise the
 * score, different ones halve it. The episode's own season and episode number from the feed count as such a
 * sequence too, so "S05E01.mp3" finds an episode whose title has no number in it.
 */
public final class EpisodeMatcher {

    /** Below this a candidate isn't worth showing. */
    static final double MIN_SCORE = 0.3;
    /** How many candidates to keep. */
    static final int MAX_CANDIDATES = 3;

    /**
     * What the matcher knows about an episode.
     *
     * @param title     the feed title
     * @param season    {@code itunes:season}, or null
     * @param episodeNo {@code itunes:episode}, or null
     */
    public record Episode(String title, Integer season, Integer episodeNo) {
    }

    private final Map<String, List<String>> titles = new HashMap<>();
    private final Map<String, Episode> episodes;

    /** @param episodes episode slug to what the feed says about it */
    public EpisodeMatcher(Map<String, Episode> episodes) {
        this.episodes = episodes;
        episodes.forEach((slug, e) -> titles.put(slug, tokens(e.title())));
    }

    public List<Candidate> candidates(String hint) {
        if (hint == null || hint.isBlank()) {
            return List.of();
        }
        List<String> wanted = tokens(stripExtension(hint));
        List<Candidate> out = new ArrayList<>();
        List<String> wantedNumbers = numbers(wanted);
        titles.forEach((slug, have) -> {
            Episode e = episodes.get(slug);
            double score = score(wanted, have);
            if (e.season() != null && e.episodeNo() != null && !wantedNumbers.isEmpty()
                    && wantedNumbers.equals(List.of(String.valueOf(e.season()), String.valueOf(e.episodeNo())))) {
                score = Math.max(score, Math.min(1, 0.5 + score));
            }
            if (score >= MIN_SCORE) {
                out.add(new Candidate(slug, e.title(), Math.round(score * 100) / 100.0));
            }
        });
        out.sort(Comparator.comparingDouble(Candidate::score).reversed().thenComparing(Candidate::slug));
        return out.subList(0, Math.min(MAX_CANDIDATES, out.size()));
    }

    /**
     * Candidates for every chapter of a book. A book usually maps onto one season, so once the clear matches
     * agree on a season, that season's episodes get a lift: "Prolog" then finds this book's prologue rather
     * than the prologue of every other book the show covered.
     *
     * @param headings chapter id → heading
     */
    public Map<String, List<Candidate>> chapterCandidates(Map<String, String> headings) {
        Map<String, List<Candidate>> first = new java.util.LinkedHashMap<>();
        headings.forEach((id, heading) -> first.put(id, candidates(heading)));
        Map<Integer, Integer> votes = new HashMap<>();
        for (List<Candidate> list : first.values()) {
            if (list.isEmpty() || (list.size() > 1 && list.get(0).score() - list.get(1).score() < 0.1)) {
                continue;
            }
            Integer season = episodes.get(list.getFirst().slug()).season();
            if (season != null) {
                votes.merge(season, 1, Integer::sum);
            }
        }
        int clear = votes.values().stream().mapToInt(Integer::intValue).sum();
        Integer dominant = votes.entrySet().stream().max(Map.Entry.comparingByValue())
                .filter(e -> e.getValue() * 2 > clear).map(Map.Entry::getKey).orElse(null);
        if (dominant == null) {
            return first;
        }
        Map<String, List<Candidate>> out = new java.util.LinkedHashMap<>();
        headings.forEach((id, heading) -> {
            List<String> wanted = tokens(heading);
            List<Candidate> list = new ArrayList<>();
            titles.forEach((slug, have) -> {
                double score = score(wanted, have);
                if (dominant.equals(episodes.get(slug).season())) {
                    score = Math.min(1, score + 0.2);
                }
                if (score >= MIN_SCORE) {
                    list.add(new Candidate(slug, episodes.get(slug).title(), Math.round(score * 100) / 100.0));
                }
            });
            list.sort(Comparator.comparingDouble(Candidate::score).reversed().thenComparing(Candidate::slug));
            out.put(id, list.subList(0, Math.min(MAX_CANDIDATES, list.size())));
        });
        return out;
    }

    static double score(List<String> a, List<String> b) {
        if (a.isEmpty() || b.isEmpty()) {
            return 0;
        }
        Map<String, Integer> counts = new HashMap<>();
        a.forEach(t -> counts.merge(t, 1, Integer::sum));
        int shared = 0;
        for (String t : b) {
            Integer left = counts.get(t);
            if (left != null && left > 0) {
                shared++;
                counts.put(t, left - 1);
            }
        }
        double dice = 2.0 * shared / (a.size() + b.size());
        List<String> na = numbers(a);
        List<String> nb = numbers(b);
        if (!na.isEmpty() && !nb.isEmpty()) {
            dice = na.equals(nb) ? Math.min(1, dice + 0.3) : dice * 0.5;
        }
        return dice;
    }

    static List<String> tokens(String text) {
        if (text == null) {
            return List.of();
        }
        String plain = Normalizer.normalize(text, Normalizer.Form.NFKD)
                .replaceAll("\\p{M}+", "")
                // "S05E03" -> "S 05 E 03", so the numbers in it count as numbers
                .replaceAll("(?<=\\p{L})(?=\\p{N})|(?<=\\p{N})(?=\\p{L})", " ")
                .toLowerCase(Locale.ROOT);
        List<String> out = new ArrayList<>();
        for (String t : plain.split("[^\\p{L}\\p{N}]+")) {
            if (t.isEmpty()) {
                continue;
            }
            out.add(t.chars().allMatch(Character::isDigit) ? stripZeros(t) : t);
        }
        return out;
    }

    private static List<String> numbers(List<String> tokens) {
        return tokens.stream().filter(t -> t.chars().allMatch(Character::isDigit)).toList();
    }

    private static String stripZeros(String digits) {
        String s = digits.replaceFirst("^0+", "");
        return s.isEmpty() ? "0" : s;
    }

    static String stripExtension(String name) {
        int dot = name.lastIndexOf('.');
        if (dot > 0 && name.length() - dot <= 6 && name.substring(dot + 1).chars().allMatch(Character::isLetterOrDigit)
                && !name.substring(dot + 1).chars().allMatch(Character::isDigit)) {
            return name.substring(0, dot);
        }
        return name;
    }
}
