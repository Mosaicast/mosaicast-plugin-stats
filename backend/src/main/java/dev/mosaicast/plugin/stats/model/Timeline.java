// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import java.util.Map;

/**
 * Who speaks when, simplified for drawing: per speaker key a flat list {@code [start, end, start, end, ...]}
 * in seconds, with short gaps closed and times rounded.
 *
 * @param resolution the rounding step in seconds
 * @param speakers   speaker key to flat interval list
 */
public record Timeline(double resolution, Map<String, double[]> speakers) {

    public Timeline {
        speakers = speakers == null ? Map.of() : Map.copyOf(speakers);
    }
}
