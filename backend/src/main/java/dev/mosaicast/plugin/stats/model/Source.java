// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

/**
 * Provenance of a set of stats.
 *
 * @param reader     id of the reader that produced it, e.g. {@code mat}
 * @param format     the source's own format version, e.g. {@code 2.6.0}
 * @param tool       the tool and version that wrote the input, e.g. {@code MAT 0.3.1}
 * @param createdAt  when the tool wrote it, as the tool reported it
 * @param inputName  file name of the analysed media, without any directory
 * @param inputHash  a hash of the analysed media, used to spot re-uploads of the same episode
 */
public record Source(String reader, String format, String tool, String createdAt, String inputName,
                     String inputHash) {
}
