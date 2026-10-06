// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.read;

import java.io.Serial;

/**
 * An upload that can't be turned into stats. The {@link #code()} is stable and goes to the UI, which
 * translates it; the message is for the log.
 */
public class StatsFormatException extends Exception {

    @Serial
    private static final long serialVersionUID = 1L;

    /** Not a ZIP archive, or a damaged one. */
    public static final String NOT_AN_ARCHIVE = "not-an-archive";
    /** Over one of the archive limits (size, entries, compression ratio). */
    public static final String TOO_LARGE = "too-large";
    /** An entry name that would leave the archive (zip slip) or is otherwise not a plain relative path. */
    public static final String UNSAFE_PATH = "unsafe-path";
    /** No registered reader recognises the archive. */
    public static final String UNKNOWN_FORMAT = "unknown-format";
    /** A reader recognises the tool but not this version of its format. */
    public static final String UNSUPPORTED_VERSION = "unsupported-version";
    /** The archive is valid but holds nothing this plugin shows (e.g. a book analysis). */
    public static final String NOTHING_TO_SHOW = "nothing-to-show";
    /** A file the reader needs is missing or isn't valid JSON. */
    public static final String BROKEN = "broken";

    private final String code;

    public StatsFormatException(String code, String message) {
        super(message);
        this.code = code;
    }

    public StatsFormatException(String code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    /** The stable error code, one of the constants above. */
    public String code() {
        return code;
    }
}
