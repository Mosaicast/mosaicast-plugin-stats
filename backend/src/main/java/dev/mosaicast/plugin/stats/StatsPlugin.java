// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors

package dev.mosaicast.plugin.stats;

import dev.mosaicast.plugin.api.OgMeta;
import dev.mosaicast.plugin.api.PageRouteProvider;
import dev.mosaicast.plugin.api.PluginBackend;
import dev.mosaicast.plugin.api.PluginContext;
import dev.mosaicast.plugin.api.ShareMetadataProvider;
import dev.mosaicast.plugin.api.UserDataHandler;
import dev.mosaicast.plugin.stats.ingest.Ingestor;
import dev.mosaicast.plugin.stats.read.Archive;
import dev.mosaicast.plugin.stats.read.ReaderRegistry;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.pf4j.Extension;

/**
 * The stats plugin's backend: reads uploaded analysis results, assigns them to episodes and keeps the
 * index the views read. All work happens on the schedule, driven by commands the admin page writes.
 */
@Extension
public class StatsPlugin implements PluginBackend, PageRouteProvider, ShareMetadataProvider, UserDataHandler {

    /** Config key for the queue interval, in seconds. */
    static final String QUEUE_INTERVAL = "queueIntervalSeconds";
    static final int DEFAULT_QUEUE_INTERVAL = 10;

    private static final Pattern SEASON_ROUTE = Pattern.compile("(books/)?season/\\d{1,4}");
    private static final Pattern BOOK_ROUTE = Pattern.compile("books/([a-z0-9-]{1,80})");

    private final ReaderRegistry readers;
    private final Clock clock;
    private Ingestor ingestor;

    public StatsPlugin() {
        this(ReaderRegistry.builtIn());
    }

    StatsPlugin(ReaderRegistry readers) {
        this(readers, Clock.systemUTC());
    }

    StatsPlugin(ReaderRegistry readers, Clock clock) {
        this.readers = readers;
        this.clock = clock;
    }

    @Override
    public void register(PluginContext ctx) {
        ingestor = new Ingestor(ctx, readers, Archive.Limits.DEFAULT, clock);
        // Backend-owned keys are written at start-up too, so a value forged before they were declared
        // doesn't survive until the first change.
        ingestor.publishStatic();
        // Stats assigned to a planned episode wait for its release; this is the fast path, the schedule the
        // safety net (the host doesn't replay a release a plugin missed).
        ctx.onEpisodeReleased(ingestor::released);
        // The other direction: an episode going quiet, withdrawn or cancelled takes its stats down at once.
        ctx.onEpisodePhaseChanged((slug, phase) -> ingestor.phaseChanged(slug));
        ctx.onSchedule(() -> Duration.ofSeconds(
                ctx.config().get(QUEUE_INTERVAL, Integer.class, DEFAULT_QUEUE_INTERVAL)), ingestor::tick);
    }

    @Override
    public boolean hasRoute(String subpath) {
        String path = clean(subpath);
        if (path.isEmpty() || path.equals("manage") || path.equals("books") || SEASON_ROUTE.matcher(path).matches()) {
            return true;
        }
        return bookTitle(path).isPresent();
    }

    /** The title of the book a {@code books/<slug>} path names, if it has live stats. */
    private Optional<String> bookTitle(String path) {
        Matcher m = BOOK_ROUTE.matcher(path);
        return m.matches() && ingestor != null ? ingestor.liveBook(m.group(1)) : Optional.empty();
    }

    private static String clean(String subpath) {
        return subpath == null ? "" : subpath.replaceAll("^/+|/+$", "");
    }

    @Override
    public Optional<OgMeta> metaFor(String subpath) {
        String path = clean(subpath);
        if (!hasRoute(path) || "manage".equals(path)) {
            return Optional.empty();
        }
        Optional<String> book = bookTitle(path);
        if (book.isPresent()) {
            return Optional.of(new OgMeta(book.get() + " – book stats",
                    "Chapter by chapter: length, sentences, dialogue, and who and where comes up.", null, "en"));
        }
        if (path.startsWith("books")) {
            return Optional.of(new OgMeta("Book stats",
                    "The books behind the show, chapter by chapter: length, sentences, dialogue and names.", null, "en"));
        }
        return Optional.of(new OgMeta("Podcast stats",
                "Who talks how much, how long episodes run, and what comes up most.", null, "en"));
    }

    /**
     * Nothing to do: the only thing stats keeps about a person is their bundle/spoiler choice, a USER-scope
     * document core erases itself. Import records, stats and speaker names don't name accounts.
     */
    @Override
    public void eraseUser(String userId) {
        // Intentionally empty, see above.
    }

    /**
     * Nothing beyond what core exports: the visitor's view choice is a USER-scope document, which core puts in
     * the export itself ({@code core/plugin-documents/stats.json}). Saying so explicitly makes the export
     * report stats as "nothing held" rather than "not supported".
     */
    @Override
    public Optional<Map<String, Object>> exportUser(String userId) {
        return Optional.empty();
    }
}
