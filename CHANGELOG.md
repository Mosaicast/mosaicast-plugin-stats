# Changelog

## 0.4.0 (2026-10-23)

- SDK 0.20.0, `platformApi` 0.20.0. Needs core 0.10.0 or newer (tested on 0.11.1); a 0.20 host no longer loads
  the 0.19 build. No behaviour change.
- The backend gets the SDK from Maven Central. The GitHub Packages repository and its token are gone from the
  build and CI.
- `docs/ARCHITECTURE.md` synced from core 0.11.1.

## 0.3.0 (2026-10-18)

- Image export for podcasters and admins: an "Image" button next to each exportable stat on `/p/stats`
  (podcast and books, any scope) and on the episode page opens a dialog with a live preview and Download /
  Share (the phone's share sheet, where the browser can hand over files, e.g. straight into an Instagram
  story).
  - 16 exports: overview, speaking time (ring or bars), episode-by-episode chart (shares, lengths, laughs),
    records, one full ranking, most mentioned names (cloud or bars), season comparison; for books overview,
    chapter chart (length, words per sentence, dialogue), chapter and chapter-group records, chapter
    groups, characters and names, each narrowable to one chapter group; per episode overview, speaking
    time, names and the book chapters it covers.
  - Formats: Instagram story 1080×1920 (keeps Instagram's top and bottom bars clear), posts 1080×1350 and
    1080×1080, wide 1920×1080 and a 1200×675 link card; PNG, JPEG or SVG.
  - Every image carries the link to the page it came from, as text and an optional QR code.
  - The dialog has its own bundle/spoiler choice (a spoiler badge marks images with spoilers), its own
    language for the image, editable headline/subline/name, colours (from the page, or light/dark/accent
    presets, each colour editable, with a contrast warning), background (solid, gradient, glow, dots, grid),
    font, text size, corners, spacing, cards on/off and speaker colours or accent shades.
  - "Save as default" stores the look, format and file type in the `export` site doc (podcasters only); an
    optional logo (PNG/JPEG/WebP, up to 2 MiB) goes to the plugin's file storage. The ingestor leaves images
    alone.
  - New exports are one entry in `frontend/src/export/items.tsx`; new sizes one line in `formats.ts`.
- Manifest: `export` behind the podcaster read floor; `blobs.mimeTypes` adds `image/png`, `image/jpeg`,
  `image/webp`.
- New dependency: `uqr` 0.1.3 (MIT) for the QR code.
- Wording: a few texts follow the suite's writing guide (mosaicast-core `docs/WRITING.md`), shorter and
  without "not X" set-ups. Keys and placeholders are unchanged.

## 0.2.0 (2026-10-10)

- Chapter groups for books: chapters sharing a heading in the book (MAT's `heading_raw`, "Jaime" for "Jaime I")
  add up per group, across the books in view. The books page gets a sortable group table (top 3 or 5
  characters), group records and a picker that narrows everything to one group; a grouped chapter's episode
  says where it stands in its group. Prologues and other one-per-book headings never form a group; books
  without repeated headings are unchanged.
- `BookStats.MODEL` 3: books read before are read again from their archives at start-up.

## 0.1.2 (2026-10-07)

- SDK 0.19.1, `platformApi` 0.19.1 (loads on any 0.19 host; core matches major.minor).
- Upload size limits are shown in binary units through `i18n.bytes` ("Up to 20 MiB per file"), the same
  numbers core's admin shows for plugin quotas. They said "MB" before while counting in MiB.
- `docs/ARCHITECTURE.md` synced from core 0.8.2.

## 0.1.1 (2026-10-07)

Dependency updates, no change in behaviour.

- React 19, Vite 8, `@vitejs/plugin-react` 6 and Vitest 5 in the frontend. The bundle is about 100 kB larger
  (124 kB gzipped), mostly React 19.
- pf4j 3.16.0, matching core 0.8.0; Gradle 9.8.0; `actions/setup-java` 6.0.1.

## 0.1.0 (2026-10-06)

First version.

- Reads MAT results (format 2, tested with 2.6.0 / MAT 0.3.1) from uploaded ZIPs, with archive limits and
  zip-slip protection. Repairs speakers MAT's `speakers` list lost (GameOfPods/MAT#4) and says so.
- Generic `StatsReader` interface; readers can describe an episode, a season or a feed.
- Uploading is one request (manage page, or `curl` with a personal access token); the backend picks new
  archives up by itself.
- Manage page: bulk upload, suggested episode per result, one-click assign for clear matches, speaker merges,
  names and colours.
- Episode stats, feed card line, feed/site panel with season switch, and `/p/stats` for the show and each
  season: totals, speaking time, per-episode charts, records, most mentioned names.
- Uploaded archives are kept, readable by podcasters only, and can be read again ("Read again", "Read all
  again") to rebuild stats after a plugin update.
- Stat bundles: several sets of stats per episode (e.g. normal and spoiler recording), set up by podcasters,
  with file-name rules for suggestions. Visitors tick which ones they see; spoiler bundles stay hidden until
  they turn spoilers on. The choice is kept per account, or for the tab session when anonymous.
- Books: MAT book results are read chapter by chapter (counts and names only), matched to episodes by
  chapter heading, and shown with podcast time per word compared to the season, most mentioned characters
  and first appearances.
- Books overview at `/p/stats/books` for the whole show, a season or one book: sentence length, dialogue
  share, longest sentence and questions per chapter, charts over the chapters, records, most mentioned
  characters, places and groups, and a list or heat map of who and where shows up in which chapter. Books
  read by an older version are read again from their archives at start-up.
- Seasons from `DisplaySnapshot.season`; the feed tile follows the shell's season filter; the episode
  matcher also uses season/episode numbers.
- Stats assigned to a planned or announced episode wait for its release and go live by themselves; withdrawn
  or cancelled episodes lose them again. Quiet plans are never suggested as matches.
- Records come in two groups, episodes (longest, shortest, most words, fastest, laughs, questions,
  back-and-forth, crosstalk, longest pause, most one-sided, most balanced) and people (fastest and slowest
  talker, most questions, longest stretch without interruption). "Ranking" opens the full list behind each.
- Uploads that hit core's upload limit (10 per minute by default) wait and go on by themselves instead of
  failing.
- English and German.
- Import records, staged results and the command queue are podcaster-only (key floors), so quiet planned
  episodes can be suggested as matches. Bundles are admin-only; podcasters see them read-only.
- Stats come down as soon as an episode goes quiet again, is withdrawn or cancelled (`onEpisodePhaseChanged`).
- `UserDataHandler`: the data export lists stats as holding nothing beyond the USER-scope view choice core
  keeps.
- platformApi 0.19.0, needs core 0.8.0+.
