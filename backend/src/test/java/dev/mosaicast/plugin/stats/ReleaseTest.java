// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.mosaicast.plugin.api.DisplaySnapshot;
import dev.mosaicast.plugin.api.EpisodePhase;
import dev.mosaicast.plugin.api.Role;
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
import dev.mosaicast.plugin.testkit.UserDataHandlerHarness;
import java.io.ByteArrayInputStream;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/**
 * Stats on an episode that isn't released yet: assigned, but kept off every public document until the host
 * releases it, and taken down again if it is withdrawn or the plan is cancelled.
 */
class ReleaseTest {

    /** A clock the test moves by hand, for the periodic full check. */
    private static final class TestClock extends Clock {
        Instant now = Instant.parse("2026-10-03T10:00:00Z");

        @Override
        public ZoneOffset getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(java.time.ZoneId zone) {
            return this;
        }

        @Override
        public Instant instant() {
            return now;
        }
    }

    private final TestClock clock = new TestClock();
    private InMemoryDocStore store;
    private InMemoryPluginBlobs blobs;
    private FakeFeedAccess feeds;
    private FakePluginContext ctx;

    private static DisplaySnapshot snap(String title, EpisodePhase phase) {
        return new DisplaySnapshot(title, "", null, null, null, null, null, null, null, "", "gop", 5, 37, phase,
                null);
    }

    private void build(Map<Scope, List<String>> scopes) {
        feeds = new FakeFeedAccess(scopes)
                .withDisplay("s5e37", snap("5.37 - Brienne I", EpisodePhase.PLANNED))
                .withDisplay("s5e36", new DisplaySnapshot("5.36 - Davos IV", "", null, null, null, null, null, null,
                        null, "", "gop", 5, 36, EpisodePhase.RELEASED, null));
        ctx = new FakePluginContext(store, new MapPluginConfig(), feeds, null, blobs);
    }

    @BeforeEach
    void setUp() {
        store = new InMemoryDocStore().withBackendOwned("stats:*", "index", "readers", "import:*", "staged:*")
                .withKeyFloor("import:*", "podcaster", null)
                .withKeyFloor("staged:*", "podcaster", null)
                .withKeyFloor("cmd:*", "podcaster", null);
        blobs = new InMemoryPluginBlobs().withLimits(20L << 20, 64L << 20).withMimeTypes(Set.of("application/zip"));
        Map<Scope, List<String>> scopes = new HashMap<>();
        scopes.put(Scope.site(), List.of("s5e37", "s5e36"));
        scopes.put(Scope.episode("s5e37"), List.of("s5e37"));
        scopes.put(Scope.episode("s5e36"), List.of("s5e36"));
        build(scopes);
    }

    private String uploadAndAssign(String slug) {
        Map<String, byte[]> files = new LinkedHashMap<>(Zips.matExample());
        String ref = blobs.put("ep.zip", "application/zip", new ByteArrayInputStream(Zips.zip(files))).ref();
        ctx.runScheduled();
        store.asUser(UUID.randomUUID()).put(Scope.site(), "cmd:" + UUID.randomUUID(), Map.of("type", "assign",
                "at", "2026-10-03T10:00:00Z", "importId", ref, "target", Map.of("type", "episode", "id", slug)));
        ctx.runScheduled();
        return ref;
    }

    private ImportRecord record(String id) {
        return Json.read(store.get(Scope.site(), Docs.IMPORT + id, JsonNode.class).orElseThrow(), ImportRecord.class);
    }

    private boolean live(String id) {
        return Boolean.TRUE.equals(record(id).assignments().getFirst().live());
    }

    private boolean published(String slug) {
        return store.get(Scope.episode(slug), "stats:podcast", JsonNode.class).isPresent();
    }

    private Set<String> indexed() {
        return Json.read(store.get(Scope.site(), Docs.INDEX, JsonNode.class).orElseThrow(), StatsIndex.class)
                .episodes().keySet();
    }

    @Test
    void waitsForTheReleaseAndThenGoesLive() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        String ref = uploadAndAssign("s5e37");

        assertEquals("assigned", record(ref).status());
        assertFalse(live(ref));
        assertFalse(published("s5e37"), "nothing public while the episode is planned");
        assertTrue(indexed().isEmpty(), "the public index doesn't name it either");

        feeds.withPhase("s5e37", EpisodePhase.RELEASED);
        ctx.fireEpisodeReleased("s5e37");

        assertTrue(live(ref));
        assertTrue(published("s5e37"));
        assertEquals(Set.of("s5e37"), indexed());
    }

    @Test
    void anUpcomingEpisodeWaitsToo() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        feeds.withPhase("s5e37", EpisodePhase.UPCOMING);
        uploadAndAssign("s5e37");
        assertFalse(published("s5e37"));
    }

    @Test
    void aMissedReleaseIsCaughtOnTheNextTick() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        String ref = uploadAndAssign("s5e37");
        feeds.withPhase("s5e37", EpisodePhase.RELEASED);   // no event: the plugin wasn't listening

        ctx.runScheduled();
        assertTrue(live(ref));
        assertTrue(published("s5e37"));
    }

    @Test
    void aWithdrawalTakesTheStatsDownAtTheNextFullCheck() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        String ref = uploadAndAssign("s5e36");
        assertTrue(published("s5e36"));

        feeds.withPhase("s5e36", EpisodePhase.WITHDRAWN);
        ctx.runScheduled();
        assertTrue(published("s5e36"), "live stats are only re-checked every few minutes");

        clock.now = clock.now.plus(Duration.ofMinutes(6));
        ctx.runScheduled();
        assertFalse(published("s5e36"));
        assertFalse(live(ref));
        assertEquals("assigned", record(ref).status(), "the assignment stays, in case it comes back");
        assertTrue(indexed().isEmpty());
    }

    @Test
    void aCancelledPlanIsReported() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        String ref = uploadAndAssign("s5e37");

        Map<Scope, List<String>> scopes = new HashMap<>();
        scopes.put(Scope.site(), List.of("s5e36"));
        scopes.put(Scope.episode("s5e36"), List.of("s5e36"));
        build(scopes);
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);

        assertTrue(record(ref).assignments().getFirst().unavailable());
        assertFalse(live(ref));
    }

    @Test
    void suggestsAQuietPlanButOnlyPodcastersSeeIt() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        Map<String, byte[]> files = new LinkedHashMap<>(Zips.matExample());
        files.put("meta.json", Zips.utf8("""
                {"format": 2, "format_version": "2.6.0", "mat_version": "0.3.1",
                 "input": {"name": "5.37 - Brienne I.mp3", "sha1": "b"}, "pipelines": ["podcast"]}"""));
        String ref = blobs.put("b.zip", "application/zip", new ByteArrayInputStream(Zips.zip(files))).ref();
        ctx.runScheduled();
        assertEquals("s5e37", record(ref).candidates().getFirst().slug(), "a podcaster may record ahead of time");

        // The record names a quiet plan, so it sits behind the key floor: a visitor can't read or list it.
        assertThrows(IllegalStateException.class,
                () -> store.asAnonymous().get(Scope.site(), Docs.IMPORT + ref, JsonNode.class));
        assertTrue(store.asAnonymous().query(Scope.site(), Docs.IMPORT).isEmpty());
        assertTrue(store.asUser(UUID.randomUUID(), Role.PODCASTER).get(Scope.site(), Docs.IMPORT + ref, JsonNode.class)
                .isPresent());
    }

    @Test
    void goingQuietAgainTakesTheStatsDownAtOnce() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        assertEquals(1, ctx.episodePhaseListenerCount());
        String ref = uploadAndAssign("s5e36");
        assertTrue(published("s5e36"));

        // The podcaster moves the announcement into the future: no tick, no full check needed.
        feeds.withPhase("s5e36", EpisodePhase.PLANNED);
        ctx.fireEpisodePhaseChanged("s5e36", EpisodePhase.PLANNED);
        assertFalse(published("s5e36"));
        assertFalse(live(ref));
        assertTrue(indexed().isEmpty());

        feeds.withPhase("s5e36", EpisodePhase.RELEASED);
        ctx.fireEpisodePhaseChanged("s5e36", EpisodePhase.RELEASED);
        assertTrue(published("s5e36"), "and back up when it returns");
    }

    @Test
    void holdsNothingAboutPeopleBeyondWhatCoreKeeps() {
        UserDataHandlerHarness harness = new UserDataHandlerHarness(new StatsPlugin());
        harness.eraseTwice(UUID.randomUUID().toString());
        assertTrue(harness.exportFiles(UUID.randomUUID().toString()).isEmpty());
    }

    @Test
    void importsFromBeforeThisVersionAreSettledAtStartup() {
        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        String ref = uploadAndAssign("s5e36");
        ImportRecord r = record(ref);
        // What a record looked like before bundles: one target, a live flag, and stats under "stats".
        store.put(Scope.site(), Docs.IMPORT + ref, new ImportRecord(r.id(), r.status(), r.fileName(), r.uploadedAt(),
                r.processedAt(), r.reader(), r.level(), null, r.hint(), r.summary(), null, r.candidates(), Map.of(),
                null, List.of(), r.merge(), r.error(), r.archive(), r.assignments().getFirst().target(), null));
        store.delete(Scope.episode("s5e36"), "stats:podcast");
        store.put(Scope.episode("s5e36"), "stats", Map.of("old", true));

        new StatsPlugin(ReaderRegistry.builtIn(), clock).register(ctx);
        assertTrue(live(ref));
        assertNull(record(ref).error());
        assertEquals(Set.of("s5e36"), indexed());
        assertEquals("podcast", record(ref).assignments().getFirst().bundle());
        assertTrue(published("s5e36"));
        assertTrue(store.get(Scope.episode("s5e36"), "stats", JsonNode.class).isEmpty(), "the old key is gone");
    }
}
