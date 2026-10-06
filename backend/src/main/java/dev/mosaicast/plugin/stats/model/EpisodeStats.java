// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.model;

import java.util.List;
import java.util.Map;

/**
 * The normalized, source-agnostic stats of one unit (usually an episode). This is what the doc store
 * holds; a {@link dev.mosaicast.plugin.stats.read.StatsReader} turns whatever a tool wrote into it.
 *
 * <p>Every number is optional: a source that cannot say something leaves it {@code null} and the UI hides
 * that tile. None of it is authoritative for the core display (ARCHITECTURE §4.2): the runtime here is
 * what the analysis measured, not what the feed declares.
 *
 * @param model             {@link #MODEL}; bumped only if a field changes meaning
 * @param source            where the numbers came from
 * @param language          detected language (ISO 639-1), if the source knows it
 * @param durationSeconds   measured length of the audio
 * @param speechSeconds     seconds in which at least one person speaks
 * @param overlapSeconds    seconds in which two or more people speak at once
 * @param longestSilence    the longest pause between two stretches of speech
 * @param turns             how often the floor changed hands
 * @param words             words in the transcript
 * @param unattributedWords words no speaker could be assigned to
 * @param sentences         sentences in the transcript
 * @param questions         sentences ending in a question mark
 * @param speakers          one entry per speaker, largest share first
 * @param events            sound events (laughter, jingles, ...), by label
 * @param entities          most mentioned names, places, ... by entity label
 * @param timeline          who speaks when, for the timeline strip; dropped from the site index
 * @param warnings          things the reader had to work around
 * @param extra             source-specific extras that have no field (yet)
 */
public record EpisodeStats(
        int model,
        Source source,
        String language,
        Double durationSeconds,
        Double speechSeconds,
        Double overlapSeconds,
        Gap longestSilence,
        Integer turns,
        Integer words,
        Integer unattributedWords,
        Integer sentences,
        Integer questions,
        List<SpeakerStats> speakers,
        List<EventStats> events,
        List<EntityGroup> entities,
        Timeline timeline,
        List<Warning> warnings,
        Map<String, Object> extra) {

    /** The current model version. */
    public static final int MODEL = 1;

    public EpisodeStats {
        speakers = speakers == null ? List.of() : List.copyOf(speakers);
        events = events == null ? List.of() : List.copyOf(events);
        entities = entities == null ? List.of() : List.copyOf(entities);
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
        extra = extra == null ? Map.of() : Map.copyOf(extra);
    }

    /** The same stats without the heavy parts (timeline, event times): what lists and the site index keep. */
    public EpisodeStats summary() {
        List<EventStats> slimEvents = events.stream()
                .map(e -> new EventStats(e.label(), e.count(), e.seconds(), List.of()))
                .toList();
        return new EpisodeStats(model, source, language, durationSeconds, speechSeconds, overlapSeconds,
                longestSilence, turns, words, unattributedWords, sentences, questions, speakers, slimEvents,
                entities, null, warnings, Map.of());
    }

    /** These stats with speaker keys renamed, merging speakers that end up under the same key. */
    public EpisodeStats withSpeakerKeys(Map<String, String> renames) {
        if (renames == null || renames.isEmpty()) {
            return this;
        }
        return SpeakerMerge.apply(this, renames);
    }
}
