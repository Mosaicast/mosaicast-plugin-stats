// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.read;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.Serial;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipException;
import java.util.zip.ZipInputStream;

/**
 * An uploaded ZIP, unpacked into memory under hard limits. Nothing is ever written to disk, so there is
 * no extraction directory to escape, but entry names are still checked as if there were: a name that
 * climbs out ({@code ../}), is absolute, uses backslashes or appears twice is refused outright rather than
 * normalised, because an archive built like that wasn't written by a tool we want to read.
 *
 * <p>The limits count the bytes actually inflated, not what the entry headers claim, so a zip bomb with
 * lying headers stops at the limit too.
 */
public final class Archive {

    /** Limits for one archive. */
    public record Limits(long maxArchiveBytes, int maxEntries, long maxEntryBytes, long maxTotalBytes) {

        /** Generous for an analysis result (a few MB of JSON), far below anything that would hurt the host. */
        public static final Limits DEFAULT = new Limits(64L << 20, 512, 96L << 20, 192L << 20);
    }

    private final Map<String, byte[]> entries;

    private Archive(Map<String, byte[]> entries) {
        this.entries = entries;
    }

    /**
     * Reads a whole archive from a stream (the stream is read but not closed).
     *
     * @throws StatsFormatException with {@link StatsFormatException#NOT_AN_ARCHIVE},
     *         {@link StatsFormatException#TOO_LARGE} or {@link StatsFormatException#UNSAFE_PATH}
     */
    public static Archive read(InputStream in, Limits limits) throws StatsFormatException {
        byte[] raw;
        try {
            raw = readCapped(in, limits.maxArchiveBytes(), "archive");
        } catch (CappedException e) {
            throw new StatsFormatException(StatsFormatException.TOO_LARGE, e.getMessage());
        } catch (IOException e) {
            throw new StatsFormatException(StatsFormatException.NOT_AN_ARCHIVE, "cannot read upload", e);
        }
        return of(raw, limits);
    }

    /** Unpacks archive bytes that are already in memory. */
    public static Archive of(byte[] raw, Limits limits) throws StatsFormatException {
        if (raw.length > limits.maxArchiveBytes()) {
            throw new StatsFormatException(StatsFormatException.TOO_LARGE, "archive is " + raw.length + " bytes");
        }
        if (raw.length < 4 || raw[0] != 'P' || raw[1] != 'K') {
            throw new StatsFormatException(StatsFormatException.NOT_AN_ARCHIVE, "not a ZIP archive");
        }
        Map<String, byte[]> entries = new LinkedHashMap<>();
        long total = 0;
        try (ZipInputStream zip = new ZipInputStream(new ByteArrayInputStream(raw))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                String name = checkName(entry.getName());
                if (entry.isDirectory() || name.endsWith("/")) {
                    continue;
                }
                if (entries.size() >= limits.maxEntries()) {
                    throw new StatsFormatException(StatsFormatException.TOO_LARGE,
                            "more than " + limits.maxEntries() + " entries");
                }
                if (entries.containsKey(name)) {
                    throw new StatsFormatException(StatsFormatException.UNSAFE_PATH, "duplicate entry " + name);
                }
                byte[] data = readCapped(zip, Math.min(limits.maxEntryBytes(), limits.maxTotalBytes() - total),
                        name);
                total += data.length;
                entries.put(name, data);
            }
        } catch (ZipException e) {
            throw new StatsFormatException(StatsFormatException.NOT_AN_ARCHIVE, "damaged archive", e);
        } catch (CappedException e) {
            throw new StatsFormatException(StatsFormatException.TOO_LARGE, e.getMessage());
        } catch (IOException e) {
            throw new StatsFormatException(StatsFormatException.NOT_AN_ARCHIVE, "cannot read archive", e);
        }
        if (entries.isEmpty()) {
            throw new StatsFormatException(StatsFormatException.NOT_AN_ARCHIVE, "empty archive");
        }
        return new Archive(stripSingleTopFolder(entries));
    }

    /** Entry names, as relative paths with forward slashes. */
    public Set<String> names() {
        return Collections.unmodifiableSet(entries.keySet());
    }

    /** Whether the archive contains this exact path. */
    public boolean has(String name) {
        return entries.containsKey(name);
    }

    /** The bytes of one entry. */
    public Optional<byte[]> bytes(String name) {
        return Optional.ofNullable(entries.get(name));
    }

    /**
     * Someone zipping the result folder by hand often zips the folder itself, so everything sits below one
     * top-level directory. Treat that the same as files at the root.
     */
    private static Map<String, byte[]> stripSingleTopFolder(Map<String, byte[]> entries) {
        String prefix = null;
        for (String name : entries.keySet()) {
            int slash = name.indexOf('/');
            if (slash < 0) {
                return entries;
            }
            String top = name.substring(0, slash + 1);
            if (prefix == null) {
                prefix = top;
            } else if (!prefix.equals(top)) {
                return entries;
            }
        }
        Map<String, byte[]> stripped = new LinkedHashMap<>();
        for (Map.Entry<String, byte[]> e : entries.entrySet()) {
            stripped.put(e.getKey().substring(prefix.length()), e.getValue());
        }
        return stripped;
    }

    private static String checkName(String raw) throws StatsFormatException {
        if (raw == null || raw.isEmpty() || raw.indexOf('\\') >= 0 || raw.indexOf('\0') >= 0
                || raw.startsWith("/") || raw.contains(":")) {
            throw new StatsFormatException(StatsFormatException.UNSAFE_PATH, "unsafe entry name");
        }
        String name = raw.startsWith("./") ? raw.substring(2) : raw;
        for (String segment : name.split("/", -1)) {
            if (segment.equals("..") || segment.equals(".")) {
                throw new StatsFormatException(StatsFormatException.UNSAFE_PATH, "unsafe entry name");
            }
        }
        return name;
    }

    private static byte[] readCapped(InputStream in, long cap, String what) throws IOException {
        byte[] data = in.readNBytes((int) Math.min(Integer.MAX_VALUE - 8, Math.max(0, cap) + 1));
        if (data.length > cap) {
            throw new CappedException(what + " exceeds " + cap + " bytes");
        }
        return data;
    }

    /** Internal signal that a size cap was hit while reading. */
    private static final class CappedException extends IOException {

        @Serial
        private static final long serialVersionUID = 1L;

        CappedException(String message) {
            super(message);
        }
    }
}
