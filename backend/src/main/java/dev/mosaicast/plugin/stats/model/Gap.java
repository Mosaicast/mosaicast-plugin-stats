// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

/**
 * A stretch of time: how long it is and where it starts.
 *
 * @param seconds length in seconds
 * @param at      start, in seconds from the beginning of the audio
 */
public record Gap(double seconds, double at) {
}
