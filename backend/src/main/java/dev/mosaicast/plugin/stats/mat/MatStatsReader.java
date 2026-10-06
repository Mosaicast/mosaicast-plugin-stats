// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.mat;

import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import dev.mosaicast.plugin.stats.model.Source;
import dev.mosaicast.plugin.stats.model.Warning;
import dev.mosaicast.plugin.stats.read.Archive;
import dev.mosaicast.plugin.stats.read.StatsFormatException;
import dev.mosaicast.plugin.stats.read.StatsReader;
import dev.mosaicast.plugin.stats.read.StatsUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Reads results of <a href="https://github.com/GameOfPods/MAT">MAT</a> (Media Analytics Toolset), result
 * format 2 (written by MAT 0.3 and newer; tested against format 2.6.0). Layout and fields are described in
 * {@code docs/MAT-FORMAT.md}.
 *
 * <p>Podcast results become podcast stats, book results (EPUB analysis) book stats. Format 1 (MAT 0.2 and older, {@code 0.PodcastOutput/} folders) is recognised so the uploader gets a
 * clear "please re-run" rather than "unknown format", but not read: MAT itself calls it unreadable.
 */
public final class MatStatsReader implements StatsReader {

    /** The format major version this reader understands. */
    public static final int FORMAT = 2;

    static final String META = "meta.json";
    static final String PODCAST_RESULT = "podcast/result.json";
    static final String BOOK_RESULT = "book/result.json";

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Override
    public String id() {
        return "mat";
    }

    @Override
    public String name() {
        return "MAT (Media Analytics Toolset)";
    }

    @Override
    public boolean canRead(Archive archive) {
        JsonNode meta = archive.bytes(META).map(MatStatsReader::parseQuietly).orElse(null);
        if (meta == null || !meta.isObject()) {
            return false;
        }
        // Format 2 has mat_version, format 1 had MAT_version. Either way it's ours to explain.
        return meta.has("mat_version") || meta.has("MAT_version");
    }

    @Override
    public List<StatsUnit> read(Archive archive) throws StatsFormatException {
        JsonNode meta = parse(archive, META);
        JsonNode format = meta.get("format");
        if (format == null && meta.has("MAT_version")) {
            throw new StatsFormatException(StatsFormatException.UNSUPPORTED_VERSION,
                    "MAT result format 1 (MAT 0.2 and older) is not supported; re-run with MAT 0.3 or newer");
        }
        if (format == null || !format.isNumber() || format.intValue() != FORMAT) {
            throw new StatsFormatException(StatsFormatException.UNSUPPORTED_VERSION,
                    "MAT result format " + format + " is not supported");
        }
        List<String> pipelines = new ArrayList<>();
        meta.path("pipelines").values().forEach(p -> {
            String name = MatPodcast.text(p);
            if (name != null) {
                pipelines.add(name);
            }
        });
        if (!pipelines.contains("podcast") && !pipelines.contains("book")) {
            throw new StatsFormatException(StatsFormatException.NOTHING_TO_SHOW,
                    "neither a podcast nor a book pipeline in this result (pipelines: " + pipelines + ")");
        }

        JsonNode input = meta.path("input");
        String inputName = baseName(MatPodcast.text(input.get("name")));
        String tool = MatPodcast.text(meta.get("mat_version"));
        String formatVersion = MatPodcast.text(meta.get("format_version"));
        // Deliberately not input.path: an absolute path on the machine that ran MAT is nobody's business.
        Source source = new Source(id(), formatVersion != null ? formatVersion : String.valueOf(FORMAT),
                tool != null ? "MAT " + tool : "MAT", MatPodcast.text(meta.get("created")), inputName,
                MatPodcast.text(input.get("sha1")));

        List<Warning> warnings = new ArrayList<>();
        for (JsonNode failed : meta.path("failed_steps").values()) {
            String step = MatPodcast.text(failed.get("step"));
            if (step != null) {
                String pipeline = MatPodcast.text(failed.get("pipeline"));
                warnings.add(new Warning("step-failed",
                        Map.of("step", pipeline != null ? pipeline + "/" + step : step)));
            }
        }

        List<StatsUnit> units = new ArrayList<>();
        if (pipelines.contains("podcast")) {
            JsonNode result = parse(archive, PODCAST_RESULT);
            requireSchema(result, "mat.podcast");
            EpisodeStats stats = MatAnalysis.analyze(MatPodcast.parse(result), source, warnings);
            units.add(new StatsUnit(StatsUnit.Level.EPISODE, inputName, stats));
        }
        if (pipelines.contains("book")) {
            JsonNode result = parse(archive, BOOK_RESULT);
            requireSchema(result, "mat.book");
            BookStats book = MatBook.read(result, source, warnings);
            String title = book.title() != null && !book.title().isBlank() ? book.title() : inputName;
            units.add(new StatsUnit(StatsUnit.Level.EPISODE, title, null, book));
        }
        return units;
    }

    private static void requireSchema(JsonNode result, String expected) throws StatsFormatException {
        String schema = MatPodcast.text(result.get("schema"));
        if (schema != null && !schema.equals(expected)) {
            throw new StatsFormatException(StatsFormatException.BROKEN, "unexpected schema " + schema);
        }
    }

    private static JsonNode parse(Archive archive, String name) throws StatsFormatException {
        byte[] bytes = archive.bytes(name).orElseThrow(() ->
                new StatsFormatException(StatsFormatException.BROKEN, name + " is missing"));
        try {
            JsonNode node = JSON.readTree(bytes);
            if (node == null || !node.isObject()) {
                throw new StatsFormatException(StatsFormatException.BROKEN, name + " is not a JSON object");
            }
            return node;
        } catch (JacksonException e) {
            throw new StatsFormatException(StatsFormatException.BROKEN, name + " is not valid JSON", e);
        }
    }

    private static JsonNode parseQuietly(byte[] bytes) {
        try {
            return JSON.readTree(bytes);
        } catch (JacksonException e) {
            return null;
        }
    }

    /** The file name without any directory, whichever separator the producing machine used. */
    static String baseName(String name) {
        if (name == null) {
            return null;
        }
        int cut = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        return name.substring(cut + 1);
    }
}
