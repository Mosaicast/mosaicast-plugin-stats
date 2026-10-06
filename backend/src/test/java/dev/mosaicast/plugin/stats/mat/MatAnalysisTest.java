// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.mat;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.stats.model.EntityGroup;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import dev.mosaicast.plugin.stats.model.SpeakerStats;
import dev.mosaicast.plugin.stats.model.Warning;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * The computations, on small hand-built results. The shapes mirror real MAT output, including the case
 * where {@code speakers} lost most of a speaker's time while the words still name them (GameOfPods/MAT#4).
 */
class MatAnalysisTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** A result builder small enough to read in a test. */
    private static final class Result {
        final ObjectNode root = JSON.createObjectNode();

        Result() {
            root.put("schema", "mat.podcast");
            root.put("language", "de");
            root.putObject("media").put("duration", 320.0);
            root.putArray("speakers");
            root.putArray("diarization");
            root.putArray("words");
            root.putArray("segments");
            root.putArray("sentences");
            root.putArray("events");
            root.putArray("entities");
        }

        Result speaker(String list, String id, String name, String library, double... startEnd) {
            ObjectNode s = ((ArrayNode) root.get(list)).addObject();
            s.put("id", id);
            s.put("name", name);
            s.put("library_id", library);
            ArrayNode segs = s.putArray("segments");
            for (int i = 0; i + 1 < startEnd.length; i += 2) {
                segs.addObject().put("start", startEnd[i]).put("end", startEnd[i + 1]);
            }
            return this;
        }

        /** A line of speech, plus one word per second inside it. */
        Result line(String speaker, double start, double end, String text) {
            item("segments", speaker, start, end, text);
            for (double t = start; t + 1 <= end; t += 1) {
                item("words", speaker, t, t + 0.5, "w");
            }
            return this;
        }

        Result sentence(String speaker, double start, double end, String text) {
            item("sentences", speaker, start, end, text);
            return this;
        }

        Result entity(String label, String text) {
            ((ArrayNode) root.get("entities")).addObject().put("label", label).put("text", text);
            return this;
        }

        Result event(String label, double start, double end) {
            ((ArrayNode) root.get("events")).addObject().put("label", label).put("start", start).put("end", end);
            return this;
        }

        private void item(String list, String speaker, double start, double end, String text) {
            ObjectNode n = ((ArrayNode) root.get(list)).addObject();
            n.put("start", start);
            n.put("end", end);
            n.put("text", text);
            ArrayNode sp = n.putArray("speakers");
            if (speaker != null) {
                sp.add(speaker);
            }
        }

        EpisodeStats analyze() {
            return MatAnalysis.analyze(MatPodcast.parse(root), null, List.of());
        }
    }

    private static SpeakerStats speaker(EpisodeStats s, String label) {
        return s.speakers().stream().filter(sp -> sp.label().equals(label)).findFirst().orElseThrow();
    }

    @Test
    void computesSharesPausesAndPace() {
        EpisodeStats s = new Result()
                .speaker("speakers", "alex", "Alex", "alex-1", 0, 60, 70, 100)
                .speaker("speakers", "max", "Max", "max-1", 100, 130, 125, 150)
                .line("alex", 0, 60, "a").line("alex", 70, 100, "b").line("max", 100, 150, "c")
                .sentence("alex", 0, 10, "Why?").sentence("max", 100, 110, "Because.")
                .event("laughter", 40, 45).event("laughter", 140, 150).event("jingle", 0, 10)
                .analyze();

        assertEquals(List.of("alex-1", "max-1"), s.speakers().stream().map(SpeakerStats::key).toList());
        SpeakerStats alex = speaker(s, "alex");
        assertEquals(90.0, alex.speakingSeconds());
        assertEquals(90.0 / 140.0, alex.share(), 1e-9);
        assertEquals(50.0, speaker(s, "max").speakingSeconds());
        assertEquals(140.0, s.speechSeconds());
        assertEquals(0.0, s.overlapSeconds(), "100–130 and 125–150 overlap only within one speaker");
        assertEquals(10.0, s.longestSilence().seconds());
        assertEquals(60.0, s.longestSilence().at());
        assertEquals(1, alex.questions());
        assertEquals(1, s.questions());
        assertEquals(1, s.turns());
        assertEquals(60.0, alex.longestTurn().seconds());
        assertEquals(90, alex.words());
        assertEquals(60.0, alex.wpm());
        assertEquals(2, s.events().getFirst().count());
        assertEquals("laughter", s.events().getFirst().label());
        assertEquals(List.of(40.0, 140.0), s.events().getFirst().at());
        assertTrue(s.warnings().isEmpty());
    }

    @Test
    void countsOverlapBetweenSpeakers() {
        EpisodeStats s = new Result()
                .speaker("speakers", "a", null, null, 0, 10)
                .speaker("speakers", "b", null, null, 5, 15)
                .analyze();
        assertEquals(15.0, s.speechSeconds());
        assertEquals(5.0, s.overlapSeconds());
    }

    @Test
    void rebuildsASpeakerThatLostTheirSegments() {
        EpisodeStats s = new Result()
                .speaker("speakers", "alex", "alex", "alex-1", 0, 0.1)
                .speaker("speakers", "max", "max", "max-1", 100, 200)
                .speaker("diarization", "sprecher_0", null, null, 0, 0.1)
                .speaker("diarization", "sprecher_1", null, null, 1, 90)
                .speaker("diarization", "sprecher_2", null, null, 100, 200)
                .line("alex", 1, 90, "x").line("max", 100, 200, "y")
                .analyze();

        assertEquals(89.1, speaker(s, "alex").speakingSeconds(), 0.01);
        assertEquals(100.0, speaker(s, "max").speakingSeconds());
        Warning w = s.warnings().getFirst();
        assertEquals("speaker-rebuilt", w.code());
        assertEquals(Map.of("speaker", "alex", "before", "0", "after", "89"), w.params());
    }

    @Test
    void addsASpeakerOnlyTheTranscriptKnows() {
        EpisodeStats s = new Result()
                .speaker("speakers", "max", "max", "max-1", 100, 200)
                .speaker("diarization", "sprecher_0", null, null, 210, 300)
                .speaker("diarization", "sprecher_1", null, null, 100, 200)
                .line("max", 100, 200, "y").line("sprecher_0", 210, 300, "z")
                .analyze();

        assertEquals(90.0, speaker(s, "sprecher_0").speakingSeconds());
        assertEquals("speaker-added", s.warnings().getFirst().code());
    }

    @Test
    void leavesAHealthySpeakerAlone() {
        EpisodeStats s = new Result()
                .speaker("speakers", "alex", null, null, 0, 70)
                .speaker("diarization", "sprecher_0", null, null, 0, 100)
                .line("alex", 0, 100, "pauses inside the line are normal")
                .analyze();
        assertEquals(70.0, speaker(s, "alex").speakingSeconds());
        assertTrue(s.warnings().isEmpty());
    }

    @Test
    void mostMentionedNamesLeaveTheHostsOut() {
        EpisodeStats s = new Result()
                .speaker("speakers", "alex", "Alex", null, 0, 10)
                .entity("PERSON", "Jon").entity("PERSON", "Jon").entity("PERSON", "jon")
                .entity("PERSON", "Alex").entity("PERSON", "Arya").entity("LOCATION", "Winterfell")
                .analyze();
        EntityGroup people = s.entities().stream().filter(g -> g.label().equals("PERSON")).findFirst().orElseThrow();
        assertEquals("Jon", people.top().getFirst().text());
        assertEquals(3, people.top().getFirst().count());
        assertEquals(2, people.top().size(), "Alex is a host, not a topic");
    }

    @Test
    void survivesAnAlmostEmptyResult() {
        ObjectNode root = JSON.createObjectNode();
        root.put("schema", "mat.podcast");
        EpisodeStats s = MatAnalysis.analyze(MatPodcast.parse(root), null, List.of());
        assertTrue(s.speakers().isEmpty());
        assertEquals(null, s.durationSeconds());
        assertEquals(null, s.words());
        assertNotNull(s.timeline());
    }

    @Test
    void mergesSpeakersOnRequest() {
        EpisodeStats s = new Result()
                .speaker("speakers", "alex", null, "alex-1", 0, 60)
                .speaker("speakers", "sprecher_1", null, null, 70, 100)
                .speaker("speakers", "max", null, "max-1", 100, 140)
                .analyze()
                .withSpeakerKeys(Map.of("sprecher_1", "alex-1"));
        assertEquals(2, s.speakers().size());
        SpeakerStats alex = s.speakers().getFirst();
        assertEquals("alex-1", alex.key());
        assertEquals(90.0, alex.speakingSeconds());
        assertEquals(90.0 / 130.0, alex.share(), 1e-9);
        assertEquals(4, s.timeline().speakers().get("alex-1").length);
    }
}
