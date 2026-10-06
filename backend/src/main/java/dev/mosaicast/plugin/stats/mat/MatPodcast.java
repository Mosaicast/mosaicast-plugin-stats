// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.mat;

import dev.mosaicast.plugin.stats.model.Intervals.Span;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import tools.jackson.databind.JsonNode;

/**
 * The parts of a MAT {@code podcast/result.json} (format 2) this plugin uses, read defensively: every list
 * may be missing or empty, every number may be null, unknown fields are ignored (the spec says newer
 * results may add some).
 */
record MatPodcast(
        String language,
        Double duration,
        Double speechDuration,
        List<Speaker> speakers,
        List<Speaker> diarization,
        List<Item> words,
        List<Item> lines,
        List<Item> sentences,
        List<Event> events,
        List<Entity> entities,
        Map<String, String> models) {

    /** A speaker as MAT lists it: id, optional name and library id, segments. */
    record Speaker(String id, String name, String libraryId, List<Span> segments) {
    }

    /** A word, line ("segment" in MAT) or sentence: times may be null, speakers may be empty or several. */
    record Item(Double start, Double end, String text, List<String> speakers) {

        boolean timed() {
            return start != null && end != null && end >= start;
        }

        boolean bySingle(String speaker) {
            return speakers.size() == 1 && speakers.getFirst().equals(speaker);
        }
    }

    /** A sound event. */
    record Event(String label, double start, double end) {
    }

    /** A named entity mention. */
    record Entity(String label, String text) {
    }

    static MatPodcast parse(JsonNode root) {
        JsonNode media = root.path("media");
        return new MatPodcast(
                text(root.get("language")),
                number(media.get("duration")),
                number(media.get("speech_duration")),
                speakers(root.path("speakers")),
                speakers(root.path("diarization")),
                items(root.path("words")),
                items(root.path("segments")),
                items(root.path("sentences")),
                events(root.path("events")),
                entities(root.path("entities")),
                models(root.path("models")));
    }

    private static List<Speaker> speakers(JsonNode array) {
        List<Speaker> out = new ArrayList<>();
        for (JsonNode s : array.values()) {
            String id = text(s.get("id"));
            if (id == null || id.isBlank()) {
                continue;
            }
            List<Span> segments = new ArrayList<>();
            for (JsonNode seg : s.path("segments").values()) {
                Double start = number(seg.get("start"));
                Double end = number(seg.get("end"));
                if (start != null && end != null) {
                    segments.add(new Span(start, end));
                }
            }
            out.add(new Speaker(id, text(s.get("name")), text(s.get("library_id")), segments));
        }
        return out;
    }

    private static List<Item> items(JsonNode array) {
        List<Item> out = new ArrayList<>(array.size());
        for (JsonNode w : array.values()) {
            List<String> speakers = new ArrayList<>(1);
            for (JsonNode sp : w.path("speakers").values()) {
                String id = text(sp);
                if (id != null && !id.isBlank()) {
                    speakers.add(id);
                }
            }
            out.add(new Item(number(w.get("start")), number(w.get("end")), text(w.get("text")), speakers));
        }
        return out;
    }

    private static List<Event> events(JsonNode array) {
        List<Event> out = new ArrayList<>();
        for (JsonNode e : array.values()) {
            String label = text(e.get("label"));
            Double start = number(e.get("start"));
            Double end = number(e.get("end"));
            if (label != null && start != null && end != null) {
                out.add(new Event(label, start, end));
            }
        }
        return out;
    }

    private static List<Entity> entities(JsonNode array) {
        List<Entity> out = new ArrayList<>();
        for (JsonNode e : array.values()) {
            String label = text(e.get("label"));
            String text = text(e.get("text"));
            if (label != null && text != null && !text.isBlank()) {
                out.add(new Entity(label, text.strip()));
            }
        }
        return out;
    }

    /** Step name to "backend model", e.g. {@code transcriber -> whisper large-v3}. */
    private static Map<String, String> models(JsonNode node) {
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<String, JsonNode> step : node.properties()) {
            String backend = text(step.getValue().get("backend"));
            String model = text(step.getValue().get("model"));
            String joined = String.join(" ", java.util.stream.Stream.of(backend, model)
                    .filter(v -> v != null && !v.isBlank()).toList());
            if (!joined.isEmpty()) {
                out.put(step.getKey(), joined);
            }
        }
        return out;
    }

    static String text(JsonNode node) {
        return node != null && node.isString() ? node.stringValue() : null;
    }

    static Double number(JsonNode node) {
        if (node == null || !node.isNumber()) {
            return null;
        }
        double v = node.doubleValue();
        return Double.isFinite(v) ? v : null;
    }
}
