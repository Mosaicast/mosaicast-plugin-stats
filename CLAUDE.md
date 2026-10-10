# Project: Mosaicast – mosaicast-plugin-stats

Episode/feed/season stats (speaking time, length, pauses, laughs, mentions) from uploaded analysis results. MAT is the first reader.

## Read first (mandatory)
- `docs/ARCHITECTURE.md` — source of truth for the whole system. On conflict, this file wins.
- `docs/BRIEF.md` — what THIS repo builds, scope, public contract, tasks.

Read both fully before writing code. Work in plan mode first.

## Tech stack
Java 21 (Gradle, PF4J extension) · React + Vite (Web Component)

## Commands
```
./build.sh                                   # -> dist/ (stats.jar, assets/stats.es.js, plugin.json)
cd backend && ./gradlew test                 # add -PstatsSamples=/dir to run real result ZIPs through the readers
cd frontend && npm test && npm run typecheck # Vite doesn't type-check; tsc does
```

## Layout
- `plugin.json` — id `stats`, platformApi **0.19.1** (the host matches major.minor at load; keep the whole
  string equal to the `plugin-api`/`plugin-testkit`/`@mosaicast/plugin-sdk` pins, CI and `manifest.test.ts`
  compare them).
- `backend/…/stats/` — `StatsPlugin` (schedule, routes, OG), `read/` (`StatsReader` SPI, `Archive` with zip
  limits, `ReaderRegistry`, `StatsUnit` = podcast or book), `mat/` (MAT format 2: `MatAnalysis` podcast,
  `MatBook` book), `model/` (`EpisodeStats`, `BookStats`), `ingest/` (`Ingestor` reads uploads, works the
  `cmd:*` queue, publishes per assignment; `Bundles`; `EpisodeMatcher` incl. chapters; doc shapes in `Docs`).
- `frontend/src/` — one bundle, four elements (`stats-episode`, `stats-card`, `stats-overview`,
  `stats-page`; routes `''`, `season/:n`, `books`, `books/season/:n`, `books/:book`, `manage`, mirrored by
  `StatsPlugin.hasRoute`); `aggregate.ts`/`book.ts` sum any episode set (`chapterPoints` for the books
  view, `resolveGroups`/`chapterGroups` for chapter groups across the books in view), `useChapterDetails` loads per-chapter names with one `getMany`, `combine.ts` adds ticked podcast bundles,
  `viewChoice.ts` keeps the visitor's bundle/spoiler choice, `seasons.ts` looks seasons up from snapshots.
- `docs/MAT-FORMAT.md` — how MAT results map to `EpisodeStats` (repo-owned, keep current).

## Plugin-specific rules
- The browser never writes stats. It writes `cmd:*` (queue), `bundles` and `speakers` (settings), and
  `user/me/view` (a visitor's choice); everything else is `backendOwned` (`stats:*`, `index`, `import:*`,
  `staged:*`, `readers`). Never reserve a key the UI writes (`manifest.test.ts` checks).
- Published stats: `stats:<bundle>` on the target. Bundles come from the `bundles` doc (podcaster-written,
  validated in `Bundles`); a kind without settings has an implicit bundle whose id is the kind.
- Book slugs (`books/<slug>`) come from `BookStats.slug(title)`, stored as `BookSummary.book`; `bookSlug` in
  `book.ts` must match it. Bump `BookStats.MODEL` when the reader adds book fields: older staged books are
  then re-read at start-up (`Ingestor.queueUpgrades`). Keep per-chapter names out of the `index` (it's read
  on every page); the books view reads them from `stats:<bundle>`.
- Anonymous view choice: `sessionStorage` `mc.stats.view` only, declared `necessary` in the manifest; never
  persistent storage without a consent category. Book stats: counts and names only, never text or summaries.
- An upload needs no command: `Ingestor` reads every blob no import's `archive` points at. `ingest` cmds
  exist only to force a reader. Keep failed reads as imports with their archive, or they'd be retried forever.
- Uploaded ZIPs are kept for re-reads and are private (`blobs.readableBy: podcaster`, core 0.7.6). Stats
  are public. Discard/replace deletes the archive.
- New source = new `StatsReader` in `ReaderRegistry.builtIn()`; the UI and storage don't change.
- Stats go public only when the target episode is RELEASED (`Ingestor.liveness`, `ImportRecord.live`): held
  for PLANNED/UPCOMING/WITHDRAWN, published on `onEpisodeReleased` and by `reconcile` on the schedule. The
  index lists live stats only. `onEpisodePhaseChanged` → `Ingestor.phaseChanged` takes stats down at once when
  an episode goes quiet, is withdrawn or cancelled. Quiet plans may be suggested: `import:*`, `staged:*` and
  `cmd:*` sit behind a podcaster read key floor. Anything that can name a quiet plan must stay behind it.
- `bundles` is admin-writable (key floor); the manage page shows podcasters a read-only editor. `speakers`
  stays podcaster-writable.
- Personal data: only the USER-scope `view` doc, which core exports/erases. `StatsPlugin` is a
  `UserDataHandler` that says so; keep it true if the plugin ever stores an account id.
- Needs core 0.8.0+. Seasons: `DisplaySnapshot.season` via `ctx.feeds.displayMany` (`useSeasons`), labels
  only as fallback. The feed tile follows `ctx.filter.season` when set.

## Conventions (binding)
- Java packages `dev.mosaicast.*`; npm scope `@mosaicast`.
- Plugins import ONLY against the SDK, never against core code.
- The manifest `platformApi` must match the built SDK version.
- Never commit secrets; configure via `.env` / environment variables.
- Migrations exclusively via Flyway.
- **Tests are part of the work** (see DoD in the BRIEF, ARCHITECTURE §13.5; plugins test against the SDK test kit).
- **CI:** create and maintain `.github/workflows/ci.yml` (build + tests on every PR) as soon as the build exists; the Definition of Done includes green CI.
- **Document public APIs** (Javadoc/TSDoc); take SDK signatures from the built SDK docs, don't guess (§3.5).
- **Sign off commits** (`git commit -s`, DCO).
- **SPDX header in EVERY new source file**:
  `// SPDX-License-Identifier: AGPL-3.0-or-later`
  `// SPDX-FileCopyrightText: 2026 The Mosaicast Authors`
  Don't guess the copyright holder from git config — use this fixed value. CI blocks PRs without a header.

## Architecture guardrails (do not violate)
- Identity (`EpisodeRef`) is separate from presentation (feed snapshot). Runtime/date in the core display come from the feed; plugin metrics are non-authoritative and live only in the plugin UI.
- The host resolves scopes and decides access/filters — plugins only consume.
- The generic doc store is the default; schema tables only platform-mediated (declarative).

## Keep docs current (continuously)
- Keep **README.md** and **this CLAUDE.md** up to date (commands, structure, setup, conventions) — repo-local, your job.
- **ARCHITECTURE.md and BRIEF.md are READ-ONLY specs** — don't change them unilaterally; flag deviations.
- Keep CLAUDE.md slim (< ~200 lines); leave incidental learnings to Claude Code's auto memory.

## Plugin-dev skill (check before building)
This repo is meant to be built with the shared **writing-a-mosaicast-plugin** skill (from the `mosaicast-skills` marketplace). Before scaffolding or modifying plugin code, check whether that skill is among your available skills.
- Available -> use it.
- Not available -> **pause**, tell the user it's recommended and how to install it (see CONTRIBUTING -> "Recommended skill"), and proceed without it only if the user confirms.

## When unsure
Ask, or note the assumption visibly, instead of silently diverging from ARCHITECTURE.md.
