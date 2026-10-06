// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import java.util.List;

/**
 * The most mentioned entities of one label.
 *
 * @param label {@code PERSON}, {@code LOCATION}, {@code ORGANIZATION}, ... as the source labels them
 * @param top   the most mentioned first
 */
public record EntityGroup(String label, List<EntityCount> top) {

    public EntityGroup {
        top = top == null ? List.of() : List.copyOf(top);
    }

    /**
     * One entity and how often it was mentioned.
     *
     * @param text  the most common spelling
     * @param count mentions
     */
    public record EntityCount(String text, int count) {
    }
}
