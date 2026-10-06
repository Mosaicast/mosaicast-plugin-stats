// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import java.util.List;

/**
 * A kind of sound event in one unit.
 *
 * @param label   what was heard, e.g. {@code laughter}, {@code jingle}
 * @param count   how often
 * @param seconds total length
 * @param at      start of each occurrence, in seconds; empty in the site index
 */
public record EventStats(String label, int count, double seconds, List<Double> at) {

    public EventStats {
        at = at == null ? List.of() : List.copyOf(at);
    }
}
