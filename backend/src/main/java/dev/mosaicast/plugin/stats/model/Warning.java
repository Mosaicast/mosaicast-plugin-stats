// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import java.util.Map;

/**
 * Something a reader noticed and worked around. The {@code code} is stable so the UI can translate it.
 *
 * @param code   e.g. {@code speaker-rebuilt}
 * @param params values for the message, e.g. the speaker and the seconds before and after
 */
public record Warning(String code, Map<String, String> params) {

    public Warning {
        params = params == null ? Map.of() : Map.copyOf(params);
    }
}
