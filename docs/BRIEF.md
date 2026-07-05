# Brief: mosaicast-plugin-stats

> Prerequisite: `docs/ARCHITECTURE.md` §7 (plugin contract, §7.7 on-request aggregation). Depends **only** on the SDK.
> Acts **per episode AND per feed/season** (aggregate). Storage: the generic **doc store**.

## Concept
Statistics per episode — speaking shares (e.g. Alex/Jonas %), runtime, longest silence, arbitrary counters. The data comes from **MAT** (the user's existing analysis tool, which outputs a defined data format). It is uploaded and ingested by the plugin. At feed/season level the per-episode stats are **summed/unified**.

## Reader abstraction (multiple stats sources)
MAT is **only the first source**. The plugin normalizes to a source-agnostic model so other sources attach via another reader — without changing the UI/aggregation.

- **`EpisodeStats` (normalized, stored model):** `source`, `sourceVersion?`, `durationSeconds?`, `longestSilenceSeconds?`, `generatedAt?`, `speakers: [{label, displayName?, speakingSeconds, share, words?, wpm?}]`, `extra: Map<String,Json>` (source-specific extras without a schema change). **The doc store holds `EpisodeStats`, not raw MAT.**
- **`StatsReader` interface:** `id()` · `canRead(probe) → boolean` (sniff the format) · `read(stream) → EpisodeStats` (parse + normalize). `MatStatsReader` is the first implementation (MAT-FORMAT.md). More sources = more readers in the plugin, registered in a list.
- **Selection:** primarily **auto-detection** — on upload ask each registered reader `canRead`, first match wins (MAT is recognized by the `meta.json` with the `PodcastOutput` pipeline). **Fallback/override:** a manual dropdown of reader IDs if nothing/ambiguous matches. No forced manual switching.
- (Far future: readers as their own plugins instead of a list — the interface allows it, don't build now.)

## Important: stats are not authoritative (ARCHITECTURE §4.2)
The **runtime/date of the core display come from the feed**, not from MAT. MAT values (duration, speaking shares) are plugin-internal, possibly absent (not every episode has stats) and shown **only in the stats UI** — never in feed cards / detail header / player.

## MAT format & upload
- **Input = a ZIP** of the MAT output folder. Format spec: `docs/MAT-FORMAT.md`. 
- Flow: unzip → read `meta.json` → find the `PodcastOutput` pipeline folder → parse `diarization.json`/`transcript.json`/`media.json` → per-episode stats into the doc store. **Parse defensively** (every file is optional).
- **Harden the upload (security):** enforce a max archive size, an entry-count limit and per-entry size limits (zip bombs), and **zip-slip protection** — reject any entry whose resolved path escapes the extraction directory.
- **Speaker label → display name**: maintain a mapping (e.g. `SPEAKER_00` → "Alex") per feed/episode in the doc store; without a mapping show raw labels.
- The two JSON schemas (`media.json`, `diarization.json`) are **confirmed** against a real sample export — `MAT-FORMAT.md` contains the full typed model (`MatExport`/`PodcastData`/…) and a verified worked example (alex 74.7% / max 25.3%, longest silence 20.2 s). Implement against it.

## Aggregation (on-request, ARCHITECTURE §7.7)
- Feed/season view: `ctx.episodes[]` (resolved by the host) → the backend sums the `EpisodeStats` of those EpisodeRefs. **Lazy**, the Web Component shows a loading bar, the result is cached (`scope=FEED|SEASON, key="agg"`), invalidated on new/updated episodes.
- Reacts to `ctx.filter.onChange` (e.g. season selection in the feed) → recompute the aggregate.

## Slots (manifest)
- `episode / main` — full stats (speaking-share bars, mini tiles for runtime/counters).
- `episode / card` — one-liner on the feed card ("Alex 54% / Jonas 46% · 1:08").
- `feed / main` and `season / main` — aggregate over the respective scope.

UI strings via the SDK i18n helper (`locales/en.json` + `de.json`); numbers/durations format via `Intl` per `ctx.locale`.

## Definition of Done
MAT upload (UI + token) fills per-episode stats, the detail page shows them, the feed/season aggregate computes on-request with a loading bar and reacts to the season filter. All in the doc store.

**Tests (§13.5):** backend unit tests against the test kit — MAT parsing and the on-request aggregate over `ctx.episodes[]`; a frontend test with `makeMockCtx` for the loading-bar / filter-reaction flow.

## SDK & license
- Depends **only** on the SDK; consume via `mavenLocal()`/`includeBuild` and `npm link` (ARCHITECTURE §3.5). **Exact signatures from the SDK Javadoc/TSDoc, don't guess.**
- **License: AGPLv3** (official feature plugin). SPDX headers in source files. Take `CONTRIBUTING.md` + DCO workflow from the templates.
