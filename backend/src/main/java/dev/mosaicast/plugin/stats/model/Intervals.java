// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Small helpers for lists of time intervals ({@code [start, end]} in seconds). Readers use them to turn
 * speaker segments into speaking time, pauses and the timeline.
 */
public final class Intervals {

    private Intervals() {
    }

    /** An interval in seconds. Ends before starts are dropped by {@link #union}. */
    public record Span(double start, double end) {

        public double length() {
            return end - start;
        }
    }

    /** Sorted, non-overlapping union. Invalid spans (NaN, end before start) are dropped. */
    public static List<Span> union(List<Span> spans) {
        return closeGaps(spans, 0);
    }

    /** Like {@link #union}, but also joins spans separated by less than {@code tolerance} seconds. */
    public static List<Span> closeGaps(List<Span> spans, double tolerance) {
        List<Span> sorted = new ArrayList<>(spans.size());
        for (Span s : spans) {
            if (Double.isFinite(s.start()) && Double.isFinite(s.end()) && s.end() > s.start()) {
                sorted.add(s);
            }
        }
        sorted.sort(Comparator.comparingDouble(Span::start));
        List<Span> out = new ArrayList<>();
        Span current = null;
        for (Span s : sorted) {
            if (current == null) {
                current = s;
            } else if (s.start() <= current.end() + tolerance) {
                current = new Span(current.start(), Math.max(current.end(), s.end()));
            } else {
                out.add(current);
                current = s;
            }
        }
        if (current != null) {
            out.add(current);
        }
        return out;
    }

    /** Total length of a union. */
    public static double total(List<Span> union) {
        double sum = 0;
        for (Span s : union) {
            sum += s.length();
        }
        return sum;
    }

    /** The longest gap between two consecutive spans of a union, or {@code null} with fewer than two. */
    public static Gap longestGap(List<Span> union) {
        Gap best = null;
        for (int i = 1; i < union.size(); i++) {
            double gap = union.get(i).start() - union.get(i - 1).end();
            if (best == null || gap > best.seconds()) {
                best = new Gap(gap, union.get(i - 1).end());
            }
        }
        return best;
    }

    /** Flattens a union to {@code [s0, e0, s1, e1, ...]}. */
    public static double[] toFlat(List<Span> union) {
        double[] flat = new double[union.size() * 2];
        for (int i = 0; i < union.size(); i++) {
            flat[2 * i] = union.get(i).start();
            flat[2 * i + 1] = union.get(i).end();
        }
        return flat;
    }

    /** The reverse of {@link #toFlat}; a trailing odd value is ignored. */
    public static List<Span> fromFlat(double[] flat) {
        List<Span> spans = new ArrayList<>(flat.length / 2);
        for (int i = 0; i + 1 < flat.length; i += 2) {
            spans.add(new Span(flat[i], flat[i + 1]));
        }
        return spans;
    }

    /** Rounds to a step such as 0.1 s, so stored numbers stay short. The step must divide 1. */
    public static double round(double value, double step) {
        double perUnit = Math.rint(1 / step);
        return Math.round(value * perUnit) / perUnit;
    }
}
