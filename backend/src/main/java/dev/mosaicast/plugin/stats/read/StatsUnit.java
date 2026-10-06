// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.read;

import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import dev.mosaicast.plugin.stats.model.Source;

/**
 * One set of stats out of an archive, with what it describes. Exactly one of {@code stats} and {@code book}
 * is set, and that decides the unit's kind.
 *
 * @param level what kind of thing the stats belong to
 * @param hint  something to match it against, typically the analysed file name; used to suggest an episode
 * @param stats podcast stats (speaking time, pauses, …), or null
 * @param book  book stats (chapters), or null
 */
public record StatsUnit(Level level, String hint, EpisodeStats stats, BookStats book) {

    /** Kind of a unit with podcast stats. */
    public static final String PODCAST = "podcast";
    /** Kind of a unit with book stats. */
    public static final String BOOK = "book";

    public StatsUnit {
        if ((stats == null) == (book == null)) {
            throw new IllegalArgumentException("a unit carries either podcast or book stats");
        }
    }

    /** A unit with podcast stats. */
    public StatsUnit(Level level, String hint, EpisodeStats stats) {
        this(level, hint, stats, null);
    }

    /** {@link #PODCAST} or {@link #BOOK}. */
    public String kind() {
        return book != null ? BOOK : PODCAST;
    }

    /** Provenance, whichever kind this is. */
    public Source source() {
        return book != null ? book.source() : stats.source();
    }

    /** What a unit of stats describes. Episode-level stats also feed the season and feed aggregates. */
    public enum Level {
        EPISODE, SEASON, FEED;

        /** The lower-case name used in documents and the UI. */
        public String id() {
            return name().toLowerCase(java.util.Locale.ROOT);
        }
    }
}
