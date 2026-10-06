// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.read;

import java.util.List;

/**
 * Turns one kind of analysis output into normalized {@link dev.mosaicast.plugin.stats.model.EpisodeStats}.
 *
 * <p>Adding a source means adding an implementation and registering it in {@link ReaderRegistry}; the
 * upload flow, the storage and every view stay as they are. Readers get the archive already unpacked and
 * size-checked, so they only deal with their own files.
 */
public interface StatsReader {

    /** Stable id, stored with every import and offered in the manual reader override. */
    String id();

    /** A human name for the admin UI, e.g. "MAT (Media Analytics Toolset)". */
    String name();

    /**
     * Cheap sniff: whether this archive looks like this reader's format. Should not parse more than a
     * small marker file. A {@code true} here followed by a failing {@link #read} is fine and reported as
     * that reader's error.
     */
    boolean canRead(Archive archive);

    /**
     * Parses and normalizes the archive.
     *
     * @return one unit per thing that has stats (usually exactly one episode); never empty
     * @throws StatsFormatException with a code the UI can show when the content can't be used
     */
    List<StatsUnit> read(Archive archive) throws StatsFormatException;
}
