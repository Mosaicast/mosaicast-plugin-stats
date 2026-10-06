// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

/**
 * One speaker in one unit.
 *
 * @param key             stable identity across episodes (a speaker library id where the source has one,
 *                        else the raw label); the site's name mapping is keyed by this
 * @param label           the raw label in this result, e.g. {@code alex} or {@code SPEAKER_00}
 * @param name            a name the source knows for this speaker, if any
 * @param speakingSeconds seconds this speaker talks (overlaps counted for everyone involved)
 * @param share           share of all speaking time, 0..1
 * @param words           words attributed to this speaker
 * @param wpm             words per minute of speaking time
 * @param turns           how often this speaker took the floor
 * @param longestTurn     the longest uninterrupted stretch
 * @param questions       sentences by this speaker ending in a question mark
 */
public record SpeakerStats(String key, String label, String name, double speakingSeconds, double share,
                           Integer words, Double wpm, Integer turns, Gap longestTurn, Integer questions) {
}
