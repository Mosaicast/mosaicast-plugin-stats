// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
import dev.mosaicast.plugin.testkit.FakeFeedAccess;
import dev.mosaicast.plugin.testkit.FakePluginContext;
import dev.mosaicast.plugin.testkit.InMemoryDocStore;
import dev.mosaicast.plugin.testkit.InMemoryPluginBlobs;
import dev.mosaicast.plugin.testkit.MapPluginConfig;
import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;

/** Bundles (normal vs. spoiler episodes) and books (chapters spread over episodes). */
class BookAndBundleTest {

    private InMemoryDocStore store;
    private InMemoryPluginBlobs blobs;
    private FakePluginContext ctx;
    private FakeFeedAccess feeds;
    private final UUID podcaster = UUID.randomUUID();

    private static DisplaySnapshot snap(String title, int season, int no) {
        return new DisplaySnapshot(title, "", null, null, null, null, null, null, null, "", "gop", season, no,
                EpisodePhase.RELEASED, null);
    }

    @BeforeEach
    void setUp() {
        store = new InMemoryDocStore().withBackendOwned("stats:*", "index", "readers", "import:*", "staged:*")
                .withKeyFloor("import:*", "podcaster", null)
                .withKeyFloor("staged:*", "podcaster", null)
                .withKeyFloor("cmd:*", "podcaster", null)
                .withKeyFloor("bundles", null, "admin");
        blobs = new InMemoryPluginBlobs().withLimits(20L << 20, 64L << 20).withMimeTypes(Set.of("application/zip"));
        Map<Scope, List<String>> scopes = new HashMap<>();
        List<String> all = List.of("s1e1", "s1e2", "s1e3", "s2e1", "s5e01");
        scopes.put(Scope.site(), all);
        all.forEach(slug -> scopes.put(Scope.episode(slug), List.of(slug)));
        feeds = new FakeFeedAccess(scopes)
                .withDisplay("s1e1", snap("1.01 - Chapter 1", 1, 1))
                .withDisplay("s1e2", snap("1.02 - Chapter 2", 1, 2))
                .withDisplay("s1e3", snap("1.03 - Epilogue", 1, 3))
                .withDisplay("s2e1", snap("2.01 - Chapter 1", 2, 1))
                .withDisplay("s5e01", snap("5.01 - Jaime I", 5, 1));
        ctx = new FakePluginContext(store, new MapPluginConfig(), feeds, null, blobs);
    }

    private String upload(Map<String, byte[]> files) {
        return blobs.put("x.zip", "application/zip", new ByteArrayInputStream(Zips.zip(files))).ref();
    }

    private void command(Map<String, Object> cmd) {
        store.asUser(podcaster).put(Scope.site(), "cmd:" + UUID.randomUUID(), cmd);
        ctx.runScheduled();
    }

    private ImportRecord record(String id) {
        return Json.read(store.get(Scope.site(), Docs.IMPORT + id, JsonNode.class).orElseThrow(), ImportRecord.class);
    }

    private StatsIndex index() {
        return Json.read(store.get(Scope.site(), Docs.INDEX, JsonNode.class).orElseThrow(), StatsIndex.class);
    }

    private static Map<String, byte[]> podcast(String inputName, String sha1) {
        Map<String, byte[]> files = new LinkedHashMap<>(Zips.matExample());
        files.put("meta.json", Zips.utf8("""
                {"format": 2, "format_version": "2.6.0", "mat_version": "0.3.1",
                 "input": {"name": "%s", "sha1": "%s"}, "pipelines": ["podcast"]}""".formatted(inputName, sha1)));
        return files;
    }

    private void bundles() {
        store.asUser(UUID.randomUUID(), Role.ADMIN).put(Scope.site(), "bundles", Map.of("bundles", List.of(
                Map.of("id", "main", "kind", "podcast", "name", "Episode", "spoiler", false),
                Map.of("id", "spoiler", "kind", "podcast", "name", "Spoiler", "spoiler", true, "match", "SPOILER!"),
                Map.of("id", "book", "kind", "book", "name", "Book"))));
    }

    @Test
    void aFileNameRulePicksTheBundleAndBothBundlesShowOnOneEpisode() {
        bundles();
        new StatsPlugin().register(ctx);
        String normal = upload(podcast("5.01 Jaime I.mp3", "n"));
        String spoiler = upload(podcast("SPOILER! 5.01 Jaime I.mp3", "s"));
        ctx.runScheduled();

        assertEquals("main", record(normal).suggestedBundle());
        assertEquals("spoiler", record(spoiler).suggestedBundle());
        assertEquals("s5e01", record(spoiler).candidates().getFirst().slug(), "the rule text doesn't spoil the match");

        for (String ref : List.of(normal, spoiler)) {
            command(Map.of("type", "assign", "at", "2026-10-03T10:00:00Z", "importId", ref,
                    "target", Map.of("type", "episode", "id", "s5e01")));
        }
        assertEquals(Set.of("main", "spoiler"), index().episodes().get("s5e01").keySet());
        assertTrue(store.get(Scope.episode("s5e01"), "stats:main", JsonNode.class).isPresent());
        assertTrue(store.get(Scope.episode("s5e01"), "stats:spoiler", JsonNode.class).isPresent());
    }

    @Test
    void onlyOneImportPerTargetAndBundle() {
        bundles();
        new StatsPlugin().register(ctx);
        String a = upload(podcast("a.mp3", "a"));
        String b = upload(podcast("b.mp3", "b"));
        ctx.runScheduled();
        for (String ref : List.of(a, b)) {
            command(Map.of("type", "assign", "at", "2026-10-03T10:00:00Z", "importId", ref, "bundle", "main",
                    "target", Map.of("type", "episode", "id", "s5e01")));
        }
        assertEquals("ready", record(a).status());
        assertEquals("assigned", record(b).status());
    }

    @Test
    void anUnknownBundleIsRefused() {
        new StatsPlugin().register(ctx);
        String ref = upload(podcast("a.mp3", "a"));
        ctx.runScheduled();
        command(Map.of("type", "assign", "at", "2026-10-03T10:00:00Z", "importId", ref, "bundle", "book",
                "target", Map.of("type", "episode", "id", "s5e01")));
        assertEquals("unknown-bundle", record(ref).error().code(), "a podcast can't go into a book bundle");
        assertEquals("ready", record(ref).status());
    }

    @Test
    void withoutSettingsEveryKindHasItsOwnBundle() {
        new StatsPlugin().register(ctx);
        String ref = upload(podcast("5.01 Jaime I.mp3", "n"));
        ctx.runScheduled();
        assertEquals("podcast", record(ref).suggestedBundle());
    }

    @Test
    void aBookSpreadsOverEpisodesChapterByChapter() {
        bundles();
        new StatsPlugin().register(ctx);
        String ref = upload(Zips.matBookExample());
        ctx.runScheduled();

        ImportRecord r = record(ref);
        assertEquals("book", r.kind());
        assertEquals("book", r.suggestedBundle());
        assertEquals(3, r.book().chapters().size());
        // "Chapter 1" fits season 1 and season 2 equally; the other chapters settle it on season 1.
        assertEquals("s1e1", r.chapterCandidates().get("c0").getFirst().slug());
        assertEquals("s1e3", r.chapterCandidates().get("c2").getFirst().slug());

        command(Map.of("type", "assign", "at", "2026-10-03T10:00:00Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s1e1"), "parts", List.of("c0")));
        command(Map.of("type", "assign", "at", "2026-10-03T10:00:01Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s1e2"), "parts", List.of("c1", "c2")));

        assertEquals(2, record(ref).assignments().size());
        JsonNode first = store.get(Scope.episode("s1e1"), "stats:book", JsonNode.class).orElseThrow();
        assertEquals(1, first.path("chapters").size());
        assertEquals(List.of("Chapter 2", "Epilogue"), index().books().get("s1e2").get("book").chapters().stream()
                .map(c -> c.heading()).toList());

        command(Map.of("type", "unassign", "at", "2026-10-03T10:00:02Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s1e2")));
        assertEquals(1, record(ref).assignments().size());
        assertFalse(store.get(Scope.episode("s1e2"), "stats:book", JsonNode.class).isPresent());
        assertTrue(store.get(Scope.episode("s1e1"), "stats:book", JsonNode.class).isPresent());
    }

    @Test
    void aWholeBookCanSitOnOneEpisode() {
        new StatsPlugin().register(ctx);
        String ref = upload(Zips.matBookExample());
        ctx.runScheduled();
        command(Map.of("type", "assign", "at", "2026-10-03T10:00:00Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s2e1")));
        assertEquals(3, index().books().get("s2e1").get("book").chapters().size());
    }

    @Test
    void aBookGetsItsOwnPageOnceAChapterIsOut() {
        StatsPlugin plugin = new StatsPlugin();
        plugin.register(ctx);
        String ref = upload(Zips.matBookExample());
        ctx.runScheduled();
        assertFalse(plugin.hasRoute("books/smoke-book"), "nothing of it is published yet");
        assertTrue(plugin.hasRoute("books"));
        assertTrue(plugin.hasRoute("books/season/1"));

        command(Map.of("type", "assign", "at", "2026-10-03T10:00:00Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s2e1"), "parts", List.of("c0")));
        assertEquals("smoke-book", index().books().get("s2e1").get("book").book());
        assertTrue(plugin.hasRoute("books/smoke-book"));
        assertFalse(plugin.hasRoute("books/another-book"));
        assertTrue(plugin.metaFor("books/smoke-book").orElseThrow().title().startsWith("Smoke Book"));
    }

    @Test
    void booksReadByAnOlderVersionAreReadAgain() {
        new StatsPlugin().register(ctx);
        String ref = upload(Zips.matBookExample());
        ctx.runScheduled();
        command(Map.of("type", "assign", "at", "2026-10-03T10:00:00Z", "importId", ref,
                "target", Map.of("type", "episode", "id", "s2e1")));
        // What an older version staged: model 1, no sentence numbers.
        tools.jackson.databind.node.ObjectNode old = (tools.jackson.databind.node.ObjectNode)
                store.get(Scope.site(), Docs.STAGED + ref, JsonNode.class).orElseThrow();
        old.put("model", 1);
        store.put(Scope.site(), Docs.STAGED + ref, old);

        FakePluginContext restarted = new FakePluginContext(store, new MapPluginConfig(), feeds, null, blobs);
        new StatsPlugin().register(restarted); // queues the re-read
        restarted.runScheduled();

        assertFalse(store.get(Scope.site(), Docs.CMD + "upgrade-" + ref, JsonNode.class).isPresent());
        assertEquals(2, store.get(Scope.site(), Docs.STAGED + ref, JsonNode.class).orElseThrow().path("model").asInt());
        assertEquals(1, record(ref).assignments().size(), "the re-read keeps where the book is shown");
        assertTrue(store.get(Scope.episode("s2e1"), "stats:book", JsonNode.class).orElseThrow()
                .path("chapters").path(0).has("dialogue"));
    }

    @Test
    void onlyAdminsChangeBundles() {
        assertThrows(IllegalStateException.class, () -> store.asUser(podcaster, Role.PODCASTER)
                .put(Scope.site(), "bundles", Map.of("bundles", List.of())));
    }

    @Test
    void ignoresBrokenBundleSettings() {
        store.asUser(UUID.randomUUID(), Role.ADMIN).put(Scope.site(), "bundles", Map.of("bundles", List.of(
                Map.of("id", "../x", "kind", "podcast"), Map.of("id", "ok", "kind", "video"))));
        new StatsPlugin().register(ctx);
        String ref = upload(podcast("a.mp3", "a"));
        ctx.runScheduled();
        assertEquals("podcast", record(ref).suggestedBundle());
    }
}
