// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.ingest;

import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import java.util.List;
import java.util.Map;

/**
 * The documents this plugin keeps, and their keys. Everything lives in the SITE scope except the published
 * stats, which sit on the scope they describe ({@code episode/<slug>/stats:<bundle>}).
 *
 * <ul>
 *   <li>the uploaded archives themselves, as blobs readable by podcasters only. Any archive no import
 *       refers to is read on the next tick, so uploading is all it takes; it's kept afterwards so the
 *       import can be read again when a reader improves</li>
 *   <li>{@code cmd:<id>} — written by the manage page, read and deleted by the backend ({@link Command})</li>
 *   <li>{@code import:<id>} — one per uploaded result, backend-owned ({@link ImportRecord})</li>
 *   <li>{@code staged:<id>} — the full stats of an import, backend-owned</li>
 *   <li>{@code index} — summaries of all published stats, for cards and aggregates, backend-owned</li>
 *   <li>{@code readers} — the readers this backend offers, backend-owned</li>
 *   <li>{@code bundles} — the site's stat bundles ({@link BundleSettings}), written by podcasters</li>
 *   <li>{@code speakers} — display names and colours per speaker key, written by podcasters</li>
 *   <li>{@code stats:<bundle>} on an episode/season/feed scope — published stats, backend-owned</li>
 * </ul>
 */
public final class Docs {

    public static final String CMD = "cmd:";
    public static final String IMPORT = "import:";
    public static final String STAGED = "staged:";
    public static final String INDEX = "index";
    public static final String READERS = "readers";
    public static final String BUNDLES = "bundles";
    /** Published stats, one key per bundle. */
    public static final String STATS = "stats:";
    /** Where published stats lived before bundles (0.1 development builds); removed on migration. */
    public static final String LEGACY_STATS = "stats";

    private Docs() {
    }

    /** The key published stats of a bundle live under on their target. */
    public static String statsKey(String bundle) {
        return STATS + bundle;
    }

    /**
     * Something the manage page asks the backend to do. Plugins author no routes, so the page drops a command
     * into the doc store and the backend works the queue.
     *
     * @param type     {@code reread}, {@code assign}, {@code unassign}, {@code discard}, or {@code ingest} to
     *                 read a new upload with a {@code reader} picked by hand (without it, uploads are found
     *                 and read on their own)
     * @param at       when the page wrote it (ISO-8601), for ordering
     * @param ref      ingest: the blob ref of the uploaded archive
     * @param fileName ingest: the uploaded file's name
     * @param reader   ingest: a reader id to use instead of detection, or null
     * @param importId reread/assign/unassign/discard: the import to act on
     * @param target   assign: where the stats go; unassign: which assignment to remove (all when null)
     * @param bundle   assign: the bundle; null means the import's suggested one
     * @param parts    assign, books only: the chapter ids that belong to the target; null means all
     * @param merge    assign, podcasts only: speaker keys to rename, e.g. {@code sprecher_1 -> alex-0b0601}
     */
    public record Command(String type, String at, String ref, String fileName, String reader, String importId,
                          Target target, String bundle, List<String> parts, Map<String, String> merge) {
    }

    /**
     * A scope stats can be assigned to.
     *
     * @param type {@code episode}, {@code season} or {@code feed}
     * @param id   the scope id (an episode slug, {@code <feed>:<n>}, a feed slug)
     */
    public record Target(String type, String id) {
    }

    /**
     * An episode that might be the one an import (or one of its chapters) describes.
     *
     * @param slug  the episode
     * @param title its feed title, for the UI
     * @param score 0..1, how well the names match
     */
    public record Candidate(String slug, String title, double score) {
    }

    /**
     * One place an import's stats are shown.
     *
     * @param target      the episode, season or feed
     * @param bundle      the bundle they're shown in
     * @param parts       books: the chapters that belong to this target (null: all)
     * @param live        whether they're published right now (false while the episode isn't released)
     * @param unavailable the target doesn't exist (any more): a cancelled plan, a removed feed
     */
    public record Assignment(Target target, String bundle, List<String> parts, Boolean live, Boolean unavailable) {

        public Assignment {
            parts = parts == null || parts.isEmpty() ? null : List.copyOf(parts);
        }

        boolean isLive() {
            return Boolean.TRUE.equals(live);
        }

        Assignment withState(boolean live, boolean unavailable) {
            return new Assignment(target, bundle, parts, live, unavailable ? Boolean.TRUE : null);
        }
    }

    /**
     * What the manage page lists: one uploaded result and where it stands.
     *
     * @param id                import id
     * @param status            {@code ready} (read, not assigned), {@code assigned} or {@code failed}
     * @param fileName          the uploaded file's name
     * @param uploadedAt        when it was uploaded
     * @param processedAt       when the backend last touched it
     * @param reader            the reader that read it
     * @param level             {@code episode}, {@code season} or {@code feed}
     * @param kind              {@code podcast} or {@code book}
     * @param hint              what the result says it analysed (the audio file name, the book title)
     * @param summary           podcast stats without the timeline; null otherwise
     * @param book              book chapters (headings and lengths); null otherwise
     * @param candidates        podcasts: best matching episodes, best first
     * @param chapterCandidates books: per chapter id, best matching episodes
     * @param suggestedBundle   the bundle a file-name rule (or the default) picks
     * @param assignments       where it's shown
     * @param merge             podcasts: speaker renames applied when publishing
     * @param error             why it failed, or why the last command on it failed
     * @param archive           blob ref of the uploaded archive, kept for reading it again
     * @param target            before bundles: the one target; migrated into {@code assignments}
     * @param live              before bundles: whether that target was live; migrated
     */
    public record ImportRecord(String id, String status, String fileName, String uploadedAt, String processedAt,
                               String reader, String level, String kind, String hint, EpisodeStats summary,
                               BookStats.Outline book, List<Candidate> candidates,
                               Map<String, List<Candidate>> chapterCandidates, String suggestedBundle,
                               List<Assignment> assignments, Map<String, String> merge, Problem error,
                               String archive, Target target, Boolean live) {

        public ImportRecord {
            candidates = candidates == null ? List.of() : List.copyOf(candidates);
            chapterCandidates = chapterCandidates == null ? Map.of() : Map.copyOf(chapterCandidates);
            assignments = assignments == null ? List.of() : List.copyOf(assignments);
            merge = merge == null ? Map.of() : Map.copyOf(merge);
        }

        /** {@code podcast} unless it says otherwise (records from before books default to podcast). */
        public String kindOrDefault() {
            return kind != null ? kind : book != null ? "book" : "podcast";
        }

        boolean hasData() {
            return summary != null || book != null;
        }

        ImportRecord withAssignments(List<Assignment> next, String now) {
            String nextStatus = !hasData() ? "failed" : next.isEmpty() ? "ready" : "assigned";
            return new ImportRecord(id, nextStatus, fileName, uploadedAt, now, reader, level, kindOrDefault(), hint,
                    summary, book, candidates, chapterCandidates, suggestedBundle, next, merge, error, archive, null,
                    null);
        }

        ImportRecord withMerge(Map<String, String> next) {
            return new ImportRecord(id, status, fileName, uploadedAt, processedAt, reader, level, kind, hint, summary,
                    book, candidates, chapterCandidates, suggestedBundle, assignments, next, error, archive, target,
                    live);
        }

        ImportRecord withError(Problem problem, String now) {
            return new ImportRecord(id, status, fileName, uploadedAt, now, reader, level, kind, hint, summary, book,
                    candidates, chapterCandidates, suggestedBundle, assignments, merge, problem, archive, target,
                    live);
        }
    }

    /**
     * A stable error code for the UI plus a message for the log.
     *
     * @param code    e.g. {@code unknown-format}
     * @param message a short English explanation
     */
    public record Problem(String code, String message) {
    }

    /**
     * Summaries of everything published, by kind, target and bundle. One read gives a card or an aggregate
     * everything it needs.
     *
     * @param model      {@link EpisodeStats#MODEL}
     * @param updatedAt  when it was rebuilt
     * @param episodes   podcast stats: episode slug → bundle → summary
     * @param scopes     podcast stats on seasons or feeds: {@code <type>/<id>} → bundle → summary
     * @param books      book stats: episode slug → bundle → chapters
     * @param bookScopes book stats on seasons or feeds
     */
    public record StatsIndex(int model, String updatedAt, Map<String, Map<String, EpisodeStats>> episodes,
                             Map<String, Map<String, EpisodeStats>> scopes,
                             Map<String, Map<String, BookStats.Summary>> books,
                             Map<String, Map<String, BookStats.Summary>> bookScopes) {
    }

    /**
     * A reader, as the upload form offers it.
     *
     * @param id   reader id
     * @param name human name
     */
    public record ReaderInfo(String id, String name) {
    }

    /**
     * The site's stat bundles, as the manage page saves them.
     *
     * @param bundles in display order
     */
    public record BundleSettings(List<Bundle> bundles) {
    }

    /**
     * A named slot for one kind of stats, e.g. the normal episode and the Patreon spoiler episode.
     *
     * @param id      stable id, part of the published key ({@code stats:<id>})
     * @param kind    {@code podcast} or {@code book}
     * @param name    what visitors see
     * @param spoiler whether it contains spoilers: off for visitors until they ask for spoilers
     * @param match   optional: a file name or title containing this (case-insensitive) suggests this bundle
     */
    public record Bundle(String id, String kind, String name, Boolean spoiler, String match) {
    }
}
