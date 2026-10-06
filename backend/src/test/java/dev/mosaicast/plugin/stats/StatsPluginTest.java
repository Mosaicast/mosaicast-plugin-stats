// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.BlobInfo;
import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.Scope;
import dev.mosaicast.plugin.stats.ingest.Docs;
import dev.mosaicast.plugin.stats.ingest.Docs.ImportRecord;
import dev.mosaicast.plugin.stats.ingest.Docs.StatsIndex;
import dev.mosaicast.plugin.stats.ingest.Json;
import dev.mosaicast.plugin.stats.read.ReaderRegistry;
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.InMemoryPluginBlobs;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import dev.mosaicast.plugin.testkit.PageRouteProviderHarness;
import java.io.ByteArrayInputStream;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** The whole loop the admin page drives: upload, ingest, assign, unassign, discard. */
class StatsPluginTest {

    /** What the manifest declares; the test kit enforces it like the host does. */
    private static final String[] BACKEND_OWNED = {"stats:*", "index", "readers", "import:*", "staged:*"};

    private InMemoryDocStore store;
    private InMemoryPluginBlobs blobs;
    private MapPluginConfig config;
    private FakePluginContext ctx;
    private final UUID podcaster = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        store = new InMemoryDocStore().withBackendOwned(BACKEND_OWNED);
        blobs = new InMemoryPluginBlobs().withLimits(20L << 20, 64L << 20).withMimeTypes(Set.of("application/zip"));
        config = new MapPluginConfig();
        FakeFeedAccess feeds = new FakeFeedAccess(Map.of(
                Scope.site(), List.of("s5e01", "s5e02", "s4e01"),
                Scope.episode("s5e01"), List.of("s5e01"),
                Scope.episode("s5e02"), List.of("s5e02"),
                Scope.season("main:5"), List.of("s5e01", "s5e02")))
                .withDisplay("s5e01", snapshot("5.01 - Jaime I"))
                .withDisplay("s5e02", snapshot("5.02 - Catelyn I"))
                .withDisplay("s4e01", snapshot("4.01 - Tyrion I"));
        ctx = new FakePluginContext(store, config, feeds, null, blobs);
    }

    private static DisplaySnapshot snapshot(String title) {
        return new DisplaySnapshot(title, "", null, null, null, null, null, null, null, "");
    }

    /** All an uploader does, from the browser or with curl and a token: store the archive. */
    private String upload(String fileName, byte[] zip) {
        return blobs.put(fileName, "application/zip", new ByteArrayInputStream(zip)).ref();
    }

    private void command(Map<String, Object> cmd) {
        store.asUser(podcaster).put(Scope.site(), "cmd:" + UUID.randomUUID(), cmd);
    }

    private ImportRecord importRecord(String id) {
        return store.get(Scope.site(), Docs.IMPORT + id, JsonNode.class).map(n -> Json.read(n, ImportRecord.class))
                .orElseThrow();
    }

    private StatsIndex index() {
        return Json.read(store.get(Scope.site(), Docs.INDEX, JsonNode.class).orElseThrow(), StatsIndex.class);
    }

    private static byte[] example(String inputName, String sha1) {
        Map<String, byte[]> files = new LinkedHashMap<>(Zips.matExample());
        files.put("meta.json", Zips.utf8("""
                {"format": 2, "format_version": "2.6.0", "mat_version": "0.3.1", "created": "2026-10-02T07:46:00",
                 "input": {"name": "%s", "path": "/media/nas/%s", "sha1": "%s"},
                 "pipelines": ["podcast"], "failed_steps": []}""".formatted(inputName, inputName, sha1)));
        return Zips.zip(files);
    }

    @Test
    void publishesItsOwnKeysAtStartup() {
        new StatsPlugin().register(ctx);
        assertTrue(store.get(Scope.site(), Docs.READERS, JsonNode.class).isPresent());
        assertTrue(index().episodes().isEmpty());
        assertThrows(IllegalStateException.class,
                () -> store.asUser(podcaster).put(Scope.site(), "index", Map.of("episodes", Map.of())));
        assertThrows(IllegalStateException.class,
                () -> store.asUser(podcaster).put(Scope.episode("s5e01"), "stats:podcast", Map.of()));
    }

    @Test
    void uploadThenAssignPublishesTheStats() {
        StatsPlugin plugin = new StatsPlugin();
        plugin.register(ctx);
        String ref = upload("5.01 Jaime I_2026-10-02.zip", example("5.01 Jaime I.mp3", "aaa"));

        ctx.runScheduled();

        ImportRecord imported = importRecord(ref);
        assertEquals("ready", imported.status());
        assertEquals("mat", imported.reader());
        assertEquals("5.01 Jaime I.mp3", imported.hint());
        assertEquals("s5e01", imported.candidates().getFirst().slug(), "best guess from the file name");
        assertTrue(imported.candidates().getFirst().score() > 0.8);
        assertNull(imported.summary().timeline(), "the list entry stays light");
        assertTrue(store.get(Scope.site(), Docs.STAGED + ref, JsonNode.class).isPresent());
        assertTrue(blobs.stat(ref).isPresent(), "the archive is kept for re-reading");
        assertEquals(ref, imported.archive());
        assertTrue(store.query(Scope.site(), "cmd:").isEmpty());

        command(Map.of("type", "assign", "at", "2026-10-02T10:01:00Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s5e01")));
        ctx.runScheduled();

        assertEquals("assigned", importRecord(ref).status());
        JsonNode stats = store.get(Scope.episode("s5e01"), "stats:podcast", JsonNode.class).orElseThrow();
        assertEquals(2, stats.path("speakers").size());
        assertTrue(stats.path("timeline").isObject());
        assertEquals(Set.of("s5e01"), index().episodes().keySet());
    }

    @Test
    void assigningToATakenEpisodeMovesTheOtherOneOut() {
        new StatsPlugin().register(ctx);
        String first = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        String second = upload("b.zip", example("5.01 Jaime I (fixed).mp3", "bbb"));
        ctx.runScheduled();
        assign(first, "s5e01");
        assign(second, "s5e01");

        assertEquals("ready", importRecord(first).status());
        assertEquals("assigned", importRecord(second).status());
        assertEquals(1, index().episodes().size());
    }

    @Test
    void reassigningLeavesTheOldEpisodeEmpty() {
        new StatsPlugin().register(ctx);
        String ref = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        ctx.runScheduled();
        assign(ref, "s5e01");
        assign(ref, "s5e02");

        assertTrue(store.get(Scope.episode("s5e01"), "stats:podcast", JsonNode.class).isEmpty());
        assertTrue(store.get(Scope.episode("s5e02"), "stats:podcast", JsonNode.class).isPresent());
        assertEquals(Set.of("s5e02"), index().episodes().keySet());
    }

    @Test
    void aReuploadOfTheSameEpisodeReplacesTheImport() {
        new StatsPlugin().register(ctx);
        String first = upload("a.zip", example("5.01 Jaime I.mp3", "same-hash"));
        ctx.runScheduled();
        assign(first, "s5e01");

        upload("a-rerun.zip", example("5.01 Jaime I.mp3", "same-hash"));
        ctx.runScheduled();

        assertEquals(1, store.query(Scope.site(), Docs.IMPORT).size());
        ImportRecord kept = importRecord(first);
        assertEquals("assigned", kept.status(), "the assignment survives a re-upload");
        assertEquals("a-rerun.zip", kept.fileName());
        assertEquals(1, blobs.size(), "the older archive is gone");
        assertTrue(blobs.stat(kept.archive()).isPresent());
    }

    @Test
    void speakerMergesShowUpInTheIndex() {
        new StatsPlugin().register(ctx);
        String ref = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        ctx.runScheduled();
        command(Map.of("type", "assign", "at", "2026-10-02T10:01:00Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s5e01"),
                "merge", Map.of("sprecher_1", "sprecher_0")));
        ctx.runScheduled();
        assertEquals(1, index().episodes().get("s5e01").get("podcast").speakers().size());
        assertEquals(1, store.get(Scope.episode("s5e01"), "stats:podcast", JsonNode.class).orElseThrow()
                .path("speakers").size());
    }

    @Test
    void anUnknownTargetIsReportedNotApplied() {
        new StatsPlugin().register(ctx);
        String ref = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        ctx.runScheduled();
        assign(ref, "no-such-episode");
        ImportRecord r = importRecord(ref);
        assertEquals("ready", r.status());
        assertEquals("unknown-target", r.error().code());
    }

    @Test
    void seasonsCanCarryStatsToo() {
        new StatsPlugin().register(ctx);
        String ref = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        ctx.runScheduled();
        command(Map.of("type", "assign", "at", "2026-10-02T10:01:00Z", "importId", ref,
                "target", Map.of("type", "season", "id", "main:5")));
        ctx.runScheduled();
        assertTrue(store.get(Scope.season("main:5"), "stats:podcast", JsonNode.class).isPresent());
        assertTrue(index().scopes().containsKey("season/main:5"));
    }

    @Test
    void unassignAndDiscard() {
        new StatsPlugin().register(ctx);
        String ref = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        ctx.runScheduled();
        assign(ref, "s5e01");

        command(Map.of("type", "unassign", "at", "2026-10-02T10:02:00Z", "importId", ref));
        ctx.runScheduled();
        assertEquals("ready", importRecord(ref).status());
        assertTrue(store.get(Scope.episode("s5e01"), "stats:podcast", JsonNode.class).isEmpty());
        assertTrue(index().episodes().isEmpty());

        command(Map.of("type", "discard", "at", "2026-10-02T10:03:00Z", "importId", ref));
        ctx.runScheduled();
        assertTrue(store.query(Scope.site(), Docs.IMPORT).isEmpty());
        assertTrue(store.query(Scope.site(), Docs.STAGED).isEmpty());
    }

    @Test
    void aBadUploadBecomesAFailedImport() {
        new StatsPlugin().register(ctx);
        Map<String, byte[]> evil = Map.of("../../etc/cron.d/x", Zips.utf8("* * * * * root sh"));
        String slip = upload("evil.zip", Zips.zip(evil));
        String other = upload("other.zip", Zips.zip(Map.of("notes.txt", Zips.utf8("hi"))));
        ctx.runScheduled();

        assertEquals("failed", importRecord(slip).status());
        assertEquals("unsafe-path", importRecord(slip).error().code());
        assertEquals("unknown-format", importRecord(other).error().code());
        assertEquals(2, blobs.size(), "kept, so a later reader can try again");

        command(Map.of("type", "discard", "at", "2026-10-02T10:05:00Z", "importId", slip));
        ctx.runScheduled();
        assertEquals(1, blobs.size(), "removing an import removes its archive");
    }

    @Test
    void aForcedReaderIsUsed() {
        new StatsPlugin().register(ctx);
        BlobInfo info = blobs.put("a.zip", "application/zip", new ByteArrayInputStream(example("x.mp3", "a")));
        command(Map.of("type", "ingest", "at", "2026-10-02T10:00:00Z", "ref", info.ref(), "fileName", "a.zip",
                "reader", "nope"));
        ctx.runScheduled();
        assertEquals("unknown-format", importRecord(info.ref()).error().code());
    }

    @Test
    void junkCommandsDoNotBlockTheQueue() {
        new StatsPlugin().register(ctx);
        command(Map.of("type", "launch-rockets", "at", "2026-10-02T09:00:00Z"));
        command(Map.of("type", "assign", "at", "2026-10-02T09:00:01Z", "importId", "../../x"));
        store.asUser(podcaster).put(Scope.site(), "cmd:broken", List.of(1, 2, 3));
        String ref = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        ctx.runScheduled();
        assertTrue(store.query(Scope.site(), "cmd:").isEmpty());
        assertEquals("ready", importRecord(ref).status());
    }

    @Test
    void aRereadKeepsTheAssignmentAndFixesAFailure() {
        // First a plugin that knows no format at all, so the upload fails...
        new StatsPlugin(new ReaderRegistry(List.of())).register(ctx);
        String ref = upload("a.zip", example("5.01 Jaime I.mp3", "aaa"));
        ctx.runScheduled();
        assertEquals("unknown-format", importRecord(ref).error().code());

        // ...then an update that does: reading the kept archive again just works.
        FakePluginContext next = new FakePluginContext(store, config, ctx.feeds(), null, blobs);
        new StatsPlugin().register(next);
        command(Map.of("type", "reread", "at", "2026-10-02T10:01:00Z", "importId", ref));
        next.runScheduled();
        assertEquals("ready", importRecord(ref).status());
        assertNull(importRecord(ref).error());

        command(Map.of("type", "assign", "at", "2026-10-02T10:02:00Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s5e01")));
        command(Map.of("type", "reread", "at", "2026-10-02T10:03:00Z", "importId", ref));
        next.runScheduled();
        assertEquals("assigned", importRecord(ref).status());
        assertTrue(store.get(Scope.episode("s5e01"), "stats:podcast", JsonNode.class).isPresent());
    }

    @Test
    void readsAnUploadOnceWithoutAnyCommand() {
        new StatsPlugin().register(ctx);
        String ref = upload("5.01 Jaime I.zip", example("5.01 Jaime I.mp3", "aaa"));
        assertTrue(store.query(Scope.site(), "cmd:").isEmpty());

        ctx.runScheduled();
        ImportRecord first = importRecord(ref);
        assertEquals("ready", first.status());
        assertEquals("5.01 Jaime I.zip", first.fileName(), "the stored file name is the import's name");

        ctx.runScheduled();
        assertEquals(first.processedAt(), importRecord(ref).processedAt(), "not read again on the next tick");
        assertEquals(1, store.query(Scope.site(), Docs.IMPORT).size());
    }

    @Test
    void anUnreadableUploadIsReportedOnceNotRetriedForever() {
        new StatsPlugin().register(ctx);
        String ref = upload("notes.zip", Zips.zip(Map.of("notes.txt", Zips.utf8("hi"))));
        ctx.runScheduled();
        String processed = importRecord(ref).processedAt();
        ctx.runScheduled();
        assertEquals("failed", importRecord(ref).status());
        assertEquals(processed, importRecord(ref).processedAt());
    }

    @Test
    void anIngestCommandStillPicksTheReader() {
        new StatsPlugin().register(ctx);
        BlobInfo info = blobs.put("a.zip", "application/zip", new ByteArrayInputStream(example("x.mp3", "a")));
        command(Map.of("type", "ingest", "at", "2026-10-02T10:00:00Z", "ref", info.ref(), "fileName", "renamed.zip",
                "reader", "mat"));
        ctx.runScheduled();
        assertEquals("ready", importRecord(info.ref()).status());
        assertEquals("renamed.zip", importRecord(info.ref()).fileName());
        assertEquals(1, store.query(Scope.site(), Docs.IMPORT).size());
    }

    @Test
    void matchesBySeasonAndEpisodeNumberToo() {
        FakeFeedAccess feeds = new FakeFeedAccess(Map.of(Scope.site(), List.of("prologue", "other")))
                .withDisplay("prologue", new DisplaySnapshot("The prologue", "", null, null, null, null, null, null, null,
                        "", "gop", 5, 3))
                .withDisplay("other", new DisplaySnapshot("Another one", "", null, null, null, null, null, null, null,
                        "", "gop", 4, 1));
        FakePluginContext c = new FakePluginContext(store, config, feeds, null, blobs);
        new StatsPlugin().register(c);
        BlobInfo info = blobs.put("x.zip", "application/zip", new ByteArrayInputStream(example("GoP S05E03.mp3", "z")));
        c.runScheduled();
        assertEquals("prologue", importRecord(info.ref()).candidates().getFirst().slug());
    }

    @Test
    void theQueueIntervalFollowsConfig() {
        new StatsPlugin().register(ctx);
        assertEquals(List.of(Duration.ofSeconds(10)), ctx.scheduledPeriods());
        config.with("queueIntervalSeconds", 30);
        assertEquals(List.of(Duration.ofSeconds(30)), ctx.scheduledPeriods());
    }

    @Test
    void routes() {
        var routes = new PageRouteProviderHarness(new StatsPlugin()).check("manage", "season/5", "season/x", "nope");
        assertTrue(routes.servesRoot());
        assertEquals(List.of("season/x", "nope"), routes.notFound());
        StatsPlugin plugin = new StatsPlugin();
        assertTrue(plugin.metaFor("").isPresent());
        assertFalse(plugin.metaFor("manage").isPresent());
        assertEquals(Optional.empty(), plugin.metaFor("nope"));
    }

    private int assigned;

    private void assign(String importId, String slug) {
        command(Map.of("type", "assign", "at", "2026-10-02T11:%02d:00Z".formatted(assigned++),
                "importId", importId, "target", Map.of("type", "episode", "id", slug)));
        ctx.runScheduled();
    }
}
