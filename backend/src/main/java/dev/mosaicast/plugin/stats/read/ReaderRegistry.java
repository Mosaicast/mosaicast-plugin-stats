// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.read;

import dev.mosaicast.plugin.stats.mat.MatStatsReader;
import java.util.List;
import java.util.Optional;

/**
 * The readers this plugin knows, in detection order: the first whose {@link StatsReader#canRead} says yes
 * reads the archive, unless the uploader picked one by hand.
 */
public final class ReaderRegistry {

    private final List<StatsReader> readers;

    public ReaderRegistry(List<StatsReader> readers) {
        this.readers = List.copyOf(readers);
    }

    /** The built-in readers. */
    public static ReaderRegistry builtIn() {
        return new ReaderRegistry(List.of(new MatStatsReader()));
    }

    public List<StatsReader> all() {
        return readers;
    }

    public Optional<StatsReader> byId(String id) {
        return readers.stream().filter(r -> r.id().equals(id)).findFirst();
    }

    /**
     * Picks the reader for an archive: the requested one if given (and known), else the first that
     * recognises it.
     *
     * @throws StatsFormatException {@link StatsFormatException#UNKNOWN_FORMAT} when nothing fits
     */
    public StatsReader select(Archive archive, String requested) throws StatsFormatException {
        if (requested != null && !requested.isBlank()) {
            return byId(requested).orElseThrow(() -> new StatsFormatException(
                    StatsFormatException.UNKNOWN_FORMAT, "no reader called " + requested));
        }
        for (StatsReader reader : readers) {
            if (reader.canRead(archive)) {
                return reader;
            }
        }
        throw new StatsFormatException(StatsFormatException.UNKNOWN_FORMAT, "no reader recognises this archive");
    }
}
