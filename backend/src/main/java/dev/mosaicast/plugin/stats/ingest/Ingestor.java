// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats.ingest;

import dev.mosaicast.plugin.api.BlobInfo;
import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.DocEntry;
import dev.mosaicast.plugin.api.DocStore;
import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.PluginBlobs;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.stats.ingest.Docs.Assignment;
import dev.mosaicast.plugin.stats.ingest.Docs.Bundle;
import dev.mosaicast.plugin.stats.ingest.Docs.Candidate;
import dev.mosaicast.plugin.stats.ingest.Docs.Command;
import dev.mosaicast.plugin.stats.ingest.Docs.ImportRecord;
import dev.mosaicast.plugin.stats.ingest.Docs.Problem;
import dev.mosaicast.plugin.stats.ingest.Docs.ReaderInfo;
import dev.mosaicast.plugin.stats.ingest.Docs.StatsIndex;
import dev.mosaicast.plugin.stats.ingest.Docs.Target;
import dev.mosaicast.plugin.stats.model.BookStats;
import dev.mosaicast.plugin.stats.model.EpisodeStats;
import dev.mosaicast.plugin.stats.read.Archive;
import dev.mosaicast.plugin.stats.read.ReaderRegistry;
import dev.mosaicast.plugin.stats.read.StatsFormatException;
import dev.mosaicast.plugin.stats.read.StatsReader;
import dev.mosaicast.plugin.stats.read.StatsUnit;
import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.stream.Stream;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;

/**
 * Runs on the plugin's schedule. Reads every uploaded archive no import knows yet, so a single upload (from
 * the manage page or a {@code curl} with a token) is all it takes. Works the command queue the manage page
 * fills: read again, assign, unassign, remove. Keeps published stats in step with their episodes' release
 * phases, and the site index with all of it. Every command is deleted once handled, whether it worked or not,
 * so a bad one can't block the queue.
 *
 * <p>An import can be shown in several places ({@link Assignment}): a podcast result on one target, in one
 * bundle; a book on many episodes, each with the chapters it covers. Published stats live on the target
 * under {@code stats:<bundle>}.
 */
public final class Ingestor {

    /** Archives read and commands handled per tick, so a big batch doesn't hold the scheduler for minutes. */
    static final int BATCH = 25;
    /** Page size when listing stored archives. */
    static final int PAGE = 200;
    /** How often the tick also re-checks stats that are already live (withdrawn, cancelled). */
    static final Duration FULL_CHECK = Duration.ofMinutes(5);

    private static final Pattern ID = Pattern.compile("[A-Za-z0-9._-]{1,80}");
    private static final Pattern PART = Pattern.compile("[A-Za-z0-9._-]{1,40}");

    /** Whether stats on a target may be public right now. */
    enum Liveness {
        /** Released (or a season/feed): publish. */
        LIVE,
        /** Planned or upcoming, or withdrawn for now: keep the assignment, publish nothing. */
        WAITING,
        /** The target doesn't exist (any more): a cancelled plan, a removed feed. */
        GONE
    }

    private final PluginContext ctx;
    private final ReaderRegistry readers;
    private final Archive.Limits limits;
    private final Clock clock;
    private Instant lastFullCheck;

    public Ingestor(PluginContext ctx, ReaderRegistry readers, Archive.Limits limits, Clock clock) {
        this.ctx = ctx;
        this.readers = readers;
        this.limits = limits;
        this.clock = clock;
    }

    private DocStore store() {
        return ctx.store();
    }

    private Logger log() {
        return ctx.logger();
    }

    // ---- entry points -----------------------------------------------------------------------------------

    /**
     * One scheduler tick: queued commands first (they may name a reader), then new uploads, then stats whose
     * episode changed phase.
     */
    public synchronized void tick() {
        List<DocEntry> queued = new ArrayList<>(store().query(Scope.site(), Docs.CMD));
        queued.sort(Comparator.comparing((DocEntry e) -> e.value().path("at").asString(""))
                .thenComparing(DocEntry::key));
        boolean changed = false;
        // Built on first use: it reads every episode's snapshot, which a tick with nothing to read skips.
        Supplier<EpisodeMatcher> matcher = once(this::matcher);
        Bundles bundles = Bundles.load(store());
        for (DocEntry entry : queued.subList(0, Math.min(BATCH, queued.size()))) {
            Command cmd;
            try {
                cmd = Json.read(entry.value(), Command.class);
            } catch (JacksonException e) {
                log().warn("dropping unreadable command {}", entry.key());
                store().delete(Scope.site(), entry.key());
                continue;
            }
            try {
                switch (cmd.type() == null ? "" : cmd.type()) {
                    case "ingest" -> changed |= ingest(cmd, matcher, bundles);
                    case "reread" -> changed |= reread(cmd.importId(), matcher, bundles);
                    case "assign" -> changed |= assign(cmd, bundles);
                    case "unassign" -> changed |= unassign(cmd.importId(), normalize(cmd.target()));
                    case "discard" -> changed |= discard(cmd.importId());
                    default -> log().warn("unknown command type '{}' in {}", cmd.type(), entry.key());
                }
            } catch (RuntimeException e) {
                log().warn("command {} ({}) failed", entry.key(), cmd.type(), e);
            } finally {
                store().delete(Scope.site(), entry.key());
            }
        }
        changed |= readNewArchives(matcher, bundles);
        Instant now = clock.instant();
        boolean all = lastFullCheck == null || !now.isBefore(lastFullCheck.plus(FULL_CHECK));
        if (all) {
            lastFullCheck = now;
        }
        changed |= reconcile(all);
        if (changed) {
            rebuildIndex();
        }
    }

    /**
     * The host says a planned episode was just released: publish what waited for it. Best effort on the
     * host's side, which is why {@link #tick()} reconciles as well.
     */
    public synchronized void released(String slug) {
        boolean changed = false;
        for (ImportRecord r : imports()) {
            boolean waits = r.assignments().stream().anyMatch(a -> !a.isLive()
                    && a.target().type().equals("episode") && a.target().id().equals(slug));
            if (waits) {
                changed |= settle(r);
            }
        }
        if (changed) {
            rebuildIndex();
            log().info("published the stats that waited for {}", slug);
        }
    }

    /**
     * An episode's phase changed by a write: it went quiet again, was announced, withdrawn, brought back or
     * cancelled. Brings every assignment on it in line right away, so stats don't stay public for an episode
     * that no longer is until the next full check. Idempotent; a release also comes through here.
     */
    public synchronized void phaseChanged(String slug) {
        boolean changed = false;
        for (ImportRecord r : imports()) {
            boolean on = r.assignments().stream().anyMatch(a -> a.target().type().equals("episode")
                    && a.target().id().equals(slug));
            if (on) {
                changed |= settle(r);
            }
        }
        if (changed) {
            rebuildIndex();
        }
    }

    /**
     * Start-up: writes the documents the frontend expects to exist (overwriting anything a client forged),
     * moves records from before bundles to the current shape, and settles every assignment.
     */
    public synchronized void publishStatic() {
        store().put(Scope.site(), Docs.READERS,
                readers.all().stream().map(r -> new ReaderInfo(r.id(), r.name())).toList());
        migrate();
        queueUpgrades();
        reconcile(true);
        lastFullCheck = clock.instant();
        rebuildIndex();
    }

    /**
     * Books read by an older version of the plugin lack numbers it now shows: queue them to be read again
     * from their archives. Through the queue rather than right here, so a start-up doesn't wait on them.
     */
    private void queueUpgrades() {
        for (ImportRecord r : imports()) {
            if (!StatsUnit.BOOK.equals(r.kindOrDefault()) || r.archive() == null || !r.hasData()) {
                continue;
            }
            int model = store().get(Scope.site(), Docs.STAGED + r.id(), JsonNode.class)
                    .map(n -> n.path("model").asInt(0)).orElse(BookStats.MODEL);
            if (model < BookStats.MODEL) {
                store().put(Scope.site(), Docs.CMD + "upgrade-" + r.id(),
                        new Command("reread", now(), null, null, null, r.id(), null, null, null, null));
                log().info("book {} was read by an older version; reading it again", r.id());
            }
        }
    }

    // ---- reading ----------------------------------------------------------------------------------------

    /** A new upload with a reader picked by hand. */
    boolean ingest(Command cmd, Supplier<EpisodeMatcher> matcher, Bundles bundles) {
        String ref = cmd.ref();
        if (ref == null || !ID.matcher(ref).matches()) {
            log().warn("ingest command without a usable ref");
            return false;
        }
        String uploadedAt = cmd.at() != null ? cmd.at() : now();
        String fileName = cmd.fileName() != null && !cmd.fileName().isBlank() ? clip(cmd.fileName(), 200) : ref;
        return read(ref, ref, fileName, uploadedAt, cmd.reader(), matcher, bundles);
    }

    /** Reads an import's archive again, e.g. after the plugin got a better reader. Keeps its assignments. */
    boolean reread(String importId, Supplier<EpisodeMatcher> matcher, Bundles bundles) {
        Optional<ImportRecord> found = importRecord(importId);
        if (found.isEmpty() || found.get().archive() == null) {
            log().warn("reread: no archive for import {}", importId);
            return false;
        }
        ImportRecord r = found.get();
        return read(r.archive(), r.id(), r.fileName(), r.uploadedAt(), null, matcher, bundles);
    }

    /**
     * Reads the archive behind {@code ref} and stages what comes out under {@code id} (or under an existing
     * import of the same analysed file). Failures become a failed import, so the uploader sees why.
     */
    private boolean read(String ref, String id, String fileName, String uploadedAt, String requestedReader,
                         Supplier<EpisodeMatcher> matcher, Bundles bundles) {
        PluginBlobs blobs = ctx.blobs();
        if (blobs == null) {
            fail(id, fileName, uploadedAt, null, ref, new Problem("no-storage", "file storage is not available"));
            return true;
        }
        if (blobs.stat(ref).isEmpty()) {
            fail(id, fileName, uploadedAt, null, null, new Problem("missing-upload", "the uploaded file is gone"));
            return true;
        }
        List<StatsUnit> units;
        StatsReader reader;
        try (InputStream in = blobs.open(ref)) {
            Archive archive = Archive.read(in, limits);
            reader = readers.select(archive, requestedReader);
            units = reader.read(archive);
        } catch (StatsFormatException e) {
            fail(id, fileName, uploadedAt, requestedReader, ref, new Problem(e.code(), e.getMessage()));
            log().info("{} not imported: {}", fileName, e.getMessage());
            return true;
        } catch (IOException e) {
            fail(id, fileName, uploadedAt, requestedReader, ref, new Problem("read-failed", "could not read the upload"));
            log().warn("reading {} failed", fileName, e);
            return true;
        }
        for (int i = 0; i < units.size(); i++) {
            StatsUnit unit = units.get(i);
            String unitId = units.size() == 1 ? id : id + "-" + i;
            String into = existingImportFor(unit, reader.id(), unitId).orElse(unitId);
            stage(into, fileName, uploadedAt, reader.id(), ref, unit, matcher, bundles);
            if (!into.equals(unitId)) {
                // The upload replaced an older import of the same file; drop the record it would have had.
                store().delete(Scope.site(), Docs.IMPORT + unitId);
                store().delete(Scope.site(), Docs.STAGED + unitId);
            }
        }
        log().info("read {} ({} unit(s), reader {})", fileName, units.size(), reader.id());
        return true;
    }

    private void stage(String id, String fileName, String uploadedAt, String reader, String archive, StatsUnit unit,
                       Supplier<EpisodeMatcher> matcher, Bundles bundles) {
        Optional<ImportRecord> previous = importRecord(id).map(Ingestor::migrated);
        previous.map(ImportRecord::archive).filter(old -> !old.equals(archive)).ifPresent(this::dropArchive);
        String kind = unit.kind();
        Bundle suggested = bundles.suggest(kind, fileName, unit.hint());
        List<Candidate> candidates = List.of();
        Map<String, List<Candidate>> chapterCandidates = Map.of();
        if (unit.level() == StatsUnit.Level.EPISODE) {
            if (unit.book() != null) {
                Map<String, String> headings = new LinkedHashMap<>();
                unit.book().chapters().forEach(c -> headings.put(c.id(), c.heading()));
                chapterCandidates = matcher.get().chapterCandidates(headings);
            } else {
                candidates = matcher.get().candidates(Bundles.withoutRule(unit.hint(), suggested));
            }
        }
        Object full = unit.book() != null ? unit.book() : unit.stats();
        store().put(Scope.site(), Docs.STAGED + id, full);

        // A new reading of something already assigned replaces the published stats right away. A reading
        // that changed kind (it happens only with a hand-picked reader) can't keep its old assignments.
        List<Assignment> kept = previous.filter(p -> p.kindOrDefault().equals(kind)).map(ImportRecord::assignments)
                .orElse(List.of());
        Map<String, String> merge = previous.map(ImportRecord::merge).orElse(Map.of());
        previous.filter(p -> !p.kindOrDefault().equals(kind)).ifPresent(p -> p.assignments().forEach(this::unpublish));
        ImportRecord record = new ImportRecord(id, "ready", fileName, uploadedAt, now(), reader, unit.level().id(), kind,
                unit.hint(), unit.stats() != null ? unit.stats().summary() : null,
                unit.book() != null ? unit.book().outline() : null, candidates, chapterCandidates, suggested.id(),
                List.of(), merge, null, archive, null, null);
        List<Assignment> settled = new ArrayList<>();
        for (Assignment a : kept) {
            settled.add(publish(record, full, a));
        }
        store().put(Scope.site(), Docs.IMPORT + id, record.withAssignments(settled, now()));
    }

    /** A new result for the same analysed file (same hash, same reader, same kind) replaces the old import. */
    private Optional<String> existingImportFor(StatsUnit unit, String reader, String self) {
        String hash = unit.source() != null ? unit.source().inputHash() : null;
        if (hash == null || hash.isBlank()) {
            return Optional.empty();
        }
        for (ImportRecord r : imports()) {
            if (!r.id().equals(self) && reader.equals(r.reader()) && unit.kind().equals(r.kindOrDefault())
                    && hash.equals(hashOf(r)) && unit.level().id().equals(r.level())) {
                return Optional.of(r.id());
            }
        }
        return Optional.empty();
    }

    private String hashOf(ImportRecord r) {
        if (r.summary() != null && r.summary().source() != null) {
            return r.summary().source().inputHash();
        }
        if (r.book() != null) {
            return stagedBook(r.id()).map(b -> b.source() != null ? b.source().inputHash() : null).orElse(null);
        }
        return null;
    }

    private void fail(String id, String fileName, String uploadedAt, String reader, String archive, Problem problem) {
        Optional<ImportRecord> previous = importRecord(id);
        if (previous.isPresent() && previous.get().hasData()) {
            // A re-read that fails keeps the stats that are already there and only reports the problem.
            store().put(Scope.site(), Docs.IMPORT + id, previous.get().withError(problem, now()));
            return;
        }
        store().put(Scope.site(), Docs.IMPORT + id, new ImportRecord(id, "failed", fileName, uploadedAt, now(),
                reader, null, null, null, null, null, List.of(), Map.of(), null, List.of(), Map.of(), problem, archive,
                null, null));
    }

    private void dropArchive(String ref) {
        PluginBlobs blobs = ctx.blobs();
        if (blobs != null && ref != null) {
            blobs.delete(ref);
        }
    }

    /**
     * Reads every stored archive no import refers to yet: a fresh upload. A file that can't be read becomes a
     * failed import that keeps its archive, so it is read once and not again on every tick.
     */
    private boolean readNewArchives(Supplier<EpisodeMatcher> matcher, Bundles bundles) {
        PluginBlobs blobs = ctx.blobs();
        if (blobs == null) {
            return false;
        }
        Set<String> known = new HashSet<>();
        for (ImportRecord r : imports()) {
            known.add(r.archive());
        }
        List<BlobInfo> fresh = new ArrayList<>();
        for (int page = 0; fresh.size() < BATCH; page++) {
            List<BlobInfo> listed = blobs.list(page, PAGE);
            for (BlobInfo b : listed) {
                if (!known.contains(b.ref()) && ID.matcher(b.ref()).matches()) {
                    fresh.add(b);
                }
            }
            if (listed.size() < PAGE) {
                break;
            }
        }
        // Oldest first, so a batch shows up in the order it was uploaded.
        fresh.sort(Comparator.comparing(BlobInfo::updatedAt, Comparator.nullsLast(Comparator.naturalOrder())));
        boolean changed = false;
        for (BlobInfo b : fresh.subList(0, Math.min(BATCH, fresh.size()))) {
            String name = b.filename() != null && !b.filename().isBlank() ? clip(b.filename(), 200) : b.ref();
            String at = b.updatedAt() != null ? b.updatedAt().toString() : now();
            changed |= read(b.ref(), b.ref(), name, at, null, matcher, bundles);
        }
        return changed;
    }

    // ---- assignment -------------------------------------------------------------------------------------

    /**
     * Shows an import on a target, in a bundle. A podcast result moves (it is shown in one place); a book adds
     * the target with the chapters it covers. Whatever another import showed on the same target in the same
     * bundle gives way.
     */
    boolean assign(Command cmd, Bundles bundles) {
        Optional<ImportRecord> found = importRecord(cmd.importId()).map(Ingestor::migrated);
        if (found.isEmpty() || !found.get().hasData()) {
            log().warn("assign: no usable import {}", cmd.importId());
            return false;
        }
        ImportRecord record = found.get();
        String kind = record.kindOrDefault();
        Target target = normalize(cmd.target());
        if (target == null || !exists(target)) {
            store().put(Scope.site(), Docs.IMPORT + record.id(), record.withError(
                    new Problem("unknown-target", "no such " + (target == null ? "target" : target.type())), now()));
            return false;
        }
        String bundleId = cmd.bundle() != null ? cmd.bundle() : record.suggestedBundle();
        Bundle bundle = bundleId == null ? bundles.defaultFor(kind) : bundles.find(bundleId, kind).orElse(null);
        if (bundle == null) {
            store().put(Scope.site(), Docs.IMPORT + record.id(), record.withError(
                    new Problem("unknown-bundle", "no " + kind + " bundle called " + bundleId), now()));
            return false;
        }
        Object full = staged(record).orElse(null);
        if (full == null) {
            store().put(Scope.site(), Docs.IMPORT + record.id(), record.withError(
                    new Problem("missing-stats", "the parsed stats are gone; upload the file again"), now()));
            return false;
        }
        List<String> parts = kind.equals(StatsUnit.BOOK) ? cleanParts(cmd.parts(), (BookStats) full) : null;
        Assignment wanted = new Assignment(target, bundle.id(), parts, false, null);

        // Another import on the same target and bundle gives way.
        for (ImportRecord other : imports()) {
            if (other.id().equals(record.id())) {
                continue;
            }
            ImportRecord o = migrated(other);
            List<Assignment> rest = o.assignments().stream().filter(a -> !same(a, wanted)).toList();
            if (rest.size() != o.assignments().size()) {
                store().put(Scope.site(), Docs.IMPORT + o.id(), o.withAssignments(rest, now()));
            }
        }
        List<Assignment> next = new ArrayList<>();
        for (Assignment a : record.assignments()) {
            boolean replaced = kind.equals(StatsUnit.BOOK) ? a.target().equals(target) : true;
            if (replaced) {
                if (!same(a, wanted)) {
                    unpublish(a);
                }
            } else {
                next.add(a);
            }
        }
        ImportRecord withMerge = kind.equals(StatsUnit.PODCAST) && cmd.merge() != null
                ? record.withMerge(cleanMerge(cmd.merge())) : record;
        next.add(publish(withMerge, full, wanted));
        store().put(Scope.site(), Docs.IMPORT + record.id(), withMerge.withAssignments(next, now()));
        return true;
    }

    /** Removes one assignment (or all of them when {@code target} is null) and what it published. */
    boolean unassign(String importId, Target target) {
        Optional<ImportRecord> found = importRecord(importId).map(Ingestor::migrated);
        if (found.isEmpty() || found.get().assignments().isEmpty()) {
            return false;
        }
        ImportRecord r = found.get();
        List<Assignment> rest = new ArrayList<>();
        for (Assignment a : r.assignments()) {
            if (target == null || a.target().equals(target)) {
                unpublish(a);
            } else {
                rest.add(a);
            }
        }
        store().put(Scope.site(), Docs.IMPORT + importId, r.withAssignments(rest, now()));
        return true;
    }

    boolean discard(String importId) {
        if (importId == null || !ID.matcher(importId).matches()) {
            return false;
        }
        unassign(importId, null);
        importRecord(importId).map(ImportRecord::archive).ifPresent(this::dropArchive);
        store().delete(Scope.site(), Docs.STAGED + importId);
        return store().delete(Scope.site(), Docs.IMPORT + importId);
    }

    private static boolean same(Assignment a, Assignment b) {
        return a.target().equals(b.target()) && a.bundle().equals(b.bundle());
    }

    private static List<String> cleanParts(List<String> parts, BookStats book) {
        if (parts == null) {
            return null;
        }
        Set<String> known = new HashSet<>();
        book.chapters().forEach(c -> known.add(c.id()));
        List<String> out = parts.stream().filter(p -> p != null && PART.matcher(p).matches() && known.contains(p))
                .distinct().toList();
        return out.isEmpty() ? null : out;
    }

    // ---- publishing and release -------------------------------------------------------------------------

    /**
     * Where a target stands. Only an explicit phase holds stats back: a snapshot without one comes from a host
     * older than platformApi 0.18, where every visible episode is released.
     */
    Liveness liveness(Target t) {
        if (!t.type().equals("episode")) {
            return exists(t) ? Liveness.LIVE : Liveness.GONE;
        }
        if (ctx.feeds().episodesIn(Scope.episode(t.id())).isEmpty()) {
            return Liveness.GONE;
        }
        EpisodePhase phase;
        try {
            phase = ctx.feeds().display(t.id()).phase();
        } catch (RuntimeException e) {
            return Liveness.GONE;
        }
        return phase == null || phase == EpisodePhase.RELEASED ? Liveness.LIVE : Liveness.WAITING;
    }

    /**
     * Puts one assignment's stats on its target when the target is live, and makes sure nothing is there when
     * it isn't. Returns the assignment with its state.
     */
    private Assignment publish(ImportRecord r, Object full, Assignment a) {
        Liveness state = liveness(a.target());
        if (state != Liveness.LIVE) {
            store().delete(scopeOf(a.target()), Docs.statsKey(a.bundle()));
            return a.withState(false, state == Liveness.GONE);
        }
        Object value = full instanceof BookStats book ? book.only(a.parts())
                : ((EpisodeStats) full).withSpeakerKeys(r.merge());
        store().put(scopeOf(a.target()), Docs.statsKey(a.bundle()), value);
        return a.withState(true, false);
    }

    private void unpublish(Assignment a) {
        store().delete(scopeOf(a.target()), Docs.statsKey(a.bundle()));
    }

    /**
     * Brings published stats in line with their targets' phases. With {@code all} false only imports with a
     * waiting assignment are checked (cheap, every tick); with {@code all} true, live ones too, for withdrawals.
     */
    private boolean reconcile(boolean all) {
        boolean changed = false;
        for (ImportRecord r : imports()) {
            if (r.assignments().isEmpty() || !r.hasData()) {
                continue;
            }
            if (all || r.assignments().stream().anyMatch(a -> !a.isLive())) {
                changed |= settle(r);
            }
        }
        return changed;
    }

    /** Publishes or withdraws an import's assignments to match their targets; true if anything changed. */
    private boolean settle(ImportRecord r) {
        Object full = null;
        List<Assignment> next = new ArrayList<>();
        boolean changed = false;
        for (Assignment a : r.assignments()) {
            Liveness state = liveness(a.target());
            boolean live = state == Liveness.LIVE;
            boolean unavailable = state == Liveness.GONE;
            if (a.live() != null && live == a.isLive() && unavailable == Boolean.TRUE.equals(a.unavailable())) {
                next.add(a);
                continue;
            }
            changed = true;
            if (live) {
                if (full == null) {
                    full = staged(r).orElse(null);
                }
                if (full == null) {
                    next.add(a);
                    continue;
                }
                next.add(publish(r, full, a));
            } else {
                unpublish(a);
                next.add(a.withState(false, unavailable));
            }
        }
        if (changed) {
            store().put(Scope.site(), Docs.IMPORT + r.id(), r.withAssignments(next, now()));
        }
        return changed;
    }

    // ---- index ------------------------------------------------------------------------------------------

    /**
     * Rebuilds {@code index} from the import records: every live assignment contributes its summary. Stats
     * waiting for a release stay out: the index is public, and it would name an episode nobody is meant to
     * know about yet.
     */
    public void rebuildIndex() {
        Map<String, Map<String, EpisodeStats>> episodes = new LinkedHashMap<>();
        Map<String, Map<String, EpisodeStats>> scopes = new LinkedHashMap<>();
        Map<String, Map<String, BookStats.Summary>> books = new LinkedHashMap<>();
        Map<String, Map<String, BookStats.Summary>> bookScopes = new LinkedHashMap<>();
        for (ImportRecord r : imports()) {
            if (!r.hasData()) {
                continue;
            }
            BookStats book = null;
            for (Assignment a : r.assignments()) {
                if (!a.isLive()) {
                    continue;
                }
                boolean episode = a.target().type().equals("episode");
                String where = episode ? a.target().id() : a.target().type() + "/" + a.target().id();
                if (r.kindOrDefault().equals(StatsUnit.BOOK)) {
                    if (book == null) {
                        book = stagedBook(r.id()).orElse(null);
                    }
                    if (book != null) {
                        (episode ? books : bookScopes).computeIfAbsent(where, k -> new LinkedHashMap<>())
                                .put(a.bundle(), book.only(a.parts()).summary());
                    }
                } else if (r.summary() != null) {
                    (episode ? episodes : scopes).computeIfAbsent(where, k -> new LinkedHashMap<>())
                            .put(a.bundle(), r.summary().withSpeakerKeys(r.merge()));
                }
            }
        }
        store().put(Scope.site(), Docs.INDEX,
                new StatsIndex(EpisodeStats.MODEL, now(), episodes, scopes, books, bookScopes));
    }

    /**
     * The title of a book with live stats, by its {@link BookStats#slug(String) slug}; empty if none is
     * published (so its page 404s until a chapter's episode is out).
     */
    public Optional<String> liveBook(String slug) {
        Optional<StatsIndex> index = store().get(Scope.site(), Docs.INDEX, JsonNode.class)
                .map(n -> Json.read(n, StatsIndex.class));
        return index.stream()
                .flatMap(i -> Stream.of(i.books(), i.bookScopes()))
                .filter(Objects::nonNull)
                .flatMap(m -> m.values().stream())
                .flatMap(m -> m.values().stream())
                .filter(s -> slug.equals(s.book()))
                .map(s -> s.title() != null ? s.title() : slug)
                .findFirst();
    }

    // ---- migration --------------------------------------------------------------------------------------

    /** A record from before bundles, in the current shape (not saved). */
    static ImportRecord migrated(ImportRecord r) {
        if (r.target() == null || !r.assignments().isEmpty()) {
            return r;
        }
        Assignment a = new Assignment(r.target(), StatsUnit.PODCAST, null, r.live(), null);
        return new ImportRecord(r.id(), r.status(), r.fileName(), r.uploadedAt(), r.processedAt(), r.reader(),
                r.level(), r.kindOrDefault(), r.hint(), r.summary(), r.book(), r.candidates(), r.chapterCandidates(),
                r.suggestedBundle() != null ? r.suggestedBundle() : StatsUnit.PODCAST, List.of(a), r.merge(),
                r.error(), r.archive(), null, null);
    }

    /**
     * Moves records and published stats from before bundles: one target becomes one assignment in the
     * default podcast bundle, and {@code stats} on the target becomes {@code stats:podcast}.
     */
    private void migrate() {
        for (ImportRecord r : imports()) {
            if (r.target() == null) {
                if (r.kind() == null) {
                    // Written before kinds and assignments existed: store it again in the current shape.
                    store().put(Scope.site(), Docs.IMPORT + r.id(), r.withAssignments(r.assignments(), r.processedAt()));
                }
                continue;
            }
            ImportRecord m = migrated(r);
            store().delete(scopeOf(r.target()), Docs.LEGACY_STATS);
            List<Assignment> forceSettle = m.assignments().stream()
                    .map(a -> new Assignment(a.target(), a.bundle(), a.parts(), null, null)).toList();
            store().put(Scope.site(), Docs.IMPORT + r.id(), m.withAssignments(forceSettle, now()));
        }
    }

    // ---- reading documents ------------------------------------------------------------------------------

    List<ImportRecord> imports() {
        List<ImportRecord> out = new ArrayList<>();
        for (DocEntry e : store().query(Scope.site(), Docs.IMPORT)) {
            try {
                out.add(Json.read(e.value(), ImportRecord.class));
            } catch (JacksonException ex) {
                log().warn("skipping unreadable {}", e.key());
            }
        }
        return out;
    }

    private Optional<ImportRecord> importRecord(String id) {
        if (id == null || !ID.matcher(id).matches()) {
            return Optional.empty();
        }
        return store().get(Scope.site(), Docs.IMPORT + id, JsonNode.class).map(n -> Json.read(n, ImportRecord.class));
    }

    /** The full staged stats of an import: {@link EpisodeStats} or {@link BookStats}, by its kind. */
    private Optional<Object> staged(ImportRecord r) {
        Optional<JsonNode> node = store().get(Scope.site(), Docs.STAGED + r.id(), JsonNode.class);
        Class<?> type = r.kindOrDefault().equals(StatsUnit.BOOK) ? BookStats.class : EpisodeStats.class;
        return node.map(n -> Json.read(n, type));
    }

    private Optional<BookStats> stagedBook(String id) {
        return store().get(Scope.site(), Docs.STAGED + id, JsonNode.class).map(n -> Json.read(n, BookStats.class));
    }

    private EpisodeMatcher matcher() {
        Map<String, EpisodeMatcher.Episode> episodes = new LinkedHashMap<>();
        for (String slug : ctx.feeds().episodesIn(Scope.site())) {
            try {
                // Quiet plans are suggested too: import records sit behind a podcaster key floor (core 0.8).
                DisplaySnapshot snap = ctx.feeds().display(slug);
                if (snap.title() != null && !snap.title().isBlank()) {
                    episodes.put(slug, new EpisodeMatcher.Episode(snap.title(), snap.season(), snap.episodeNo()));
                }
            } catch (RuntimeException e) {
                // An episode that vanished between the two calls just isn't a candidate.
            }
        }
        return new EpisodeMatcher(episodes);
    }

    // ---- small helpers ----------------------------------------------------------------------------------

    private static Target normalize(Target t) {
        if (t == null || t.type() == null || t.id() == null || t.id().isBlank()) {
            return null;
        }
        return switch (t.type()) {
            case "episode", "season", "feed" -> new Target(t.type(), t.id().strip());
            default -> null;
        };
    }

    private boolean exists(Target t) {
        return !ctx.feeds().episodesIn(scopeOf(t)).isEmpty();
    }

    static Scope scopeOf(Target t) {
        return switch (t.type()) {
            case "season" -> Scope.season(t.id());
            case "feed" -> Scope.feed(t.id());
            default -> Scope.episode(t.id());
        };
    }

    private static Map<String, String> cleanMerge(Map<String, String> merge) {
        Map<String, String> out = new LinkedHashMap<>();
        merge.forEach((from, to) -> {
            if (from != null && to != null && !from.isBlank() && !to.isBlank() && !from.equals(to)
                    && from.length() <= 200 && to.length() <= 200) {
                out.put(from, to);
            }
        });
        return out;
    }

    private static String clip(String s, int max) {
        String flat = s.replaceAll("\\p{Cntrl}", " ").strip();
        return flat.length() <= max ? flat : flat.substring(0, max);
    }

    private static <T> Supplier<T> once(Supplier<T> make) {
        return new Supplier<>() {
            private T value;

            @Override
            public T get() {
                if (value == null) {
                    value = make.get();
                }
                return value;
            }
        };
    }

    private String now() {
        return clock.instant().toString();
    }

    /** A fresh command id, for tests and tools that queue commands from Java. */
    public static String newCommandKey() {
        return Docs.CMD + UUID.randomUUID();
    }
}
