# MAT results (input for the stats plugin)

Source: [GameOfPods/MAT](https://github.com/GameOfPods/MAT). The authoritative spec is `result-format.md` in
`mat-result-format-<version>.zip`, attached to every MAT release together with JSON Schemas. This file only
says which parts the plugin reads and how it turns them into its own model. Written against **format 2.6.0**
(MAT 0.3.1).

> Format 1 (MAT 0.2.0 and older, `0.PodcastOutput/` folders with `media.json`, `diarization.json`, …) is gone.
> MAT itself calls it unreadable. The reader recognises it and tells the uploader to re-run with MAT 0.3+.

## The upload

One ZIP per analysed file, as MAT writes it with `--output-zip` (files at the root). A ZIP of the result
*folder* works too: a single top-level directory is stripped.

```
meta.json             always
config.toml           only with --export-config, ignored
podcast/result.json   all data; the only file read besides meta.json
podcast/…             convenience copies (transcript.txt, summary.md, diarization.rttm), ignored
book/result.json      EPUB analysis → book stats (see below)
```

Archive limits (`Archive.Limits.DEFAULT`): 64 MB archive, 512 entries, 96 MB per entry and 192 MB in total,
counted on the bytes actually inflated. Entry names with `..`, a leading `/`, a drive letter, a backslash or a
duplicate are refused. Nothing is written to disk.

## meta.json

| Field | Used for |
|---|---|
| `format` | must be `2`, anything else is refused |
| `format_version` | stored as `source.format` |
| `mat_version` | stored as `source.tool` ("MAT 0.3.1") |
| `created` | `source.createdAt` |
| `input.name` | `source.inputName`, and matched against episode titles to suggest an episode |
| `input.sha1` | `source.inputHash`; a new upload with the same hash replaces the old import |
| `input.path` | **ignored on purpose** (an absolute path on the producing machine) |
| `pipelines` | must contain `podcast` |
| `failed_steps` | one `step-failed` warning each |

## podcast/result.json → `EpisodeStats`

Every list may be empty and every number may be `null`; unknown fields are ignored.

| Stats field | Computed from |
|---|---|
| `durationSeconds` | `media.duration`, else the end of the last line |
| `speakers[].speakingSeconds` | union of the speaker's `speakers[].segments` |
| `speakers[].share` | speaking seconds / sum over all speakers |
| `speakers[].key` | `library_id` if present (same voice across episodes), else `id` |
| `speakers[].words` | words in `words` naming the speaker (a word with two speakers counts for both) |
| `speakers[].wpm` | words / speaking minutes |
| `speakers[].turns`, `longestTurn` | lines in `segments` naming the speaker; the longest single-speaker one |
| `speakers[].questions` | sentences (`sentences`, since 2.6) by that speaker ending in `?` |
| `speechSeconds` | union of all speakers' segments |
| `overlapSeconds` | sum of speaking seconds minus `speechSeconds` |
| `longestSilence` | the largest gap between two stretches of speech (start and end of the file don't count) |
| `turns` | changes of speaker between consecutive lines |
| `words`, `unattributedWords` | `words`, and the ones with no speaker |
| `sentences`, `questions` | `sentences` and those ending in `?` |
| `events` | `events` grouped by `label` (count, total length, start times) |
| `entities` | `entities` grouped by `label`, counted case-insensitively, top 15 each; mentions of the speakers themselves are left out |
| `timeline` | each speaker's segments with gaps under 1 s closed, rounded to 0.1 s |
| `extra.models` | `models`, as "backend model" per step |

Not read: `summary`, `diarization` (except for the repair below), `media.speech_duration`, `media.rms`, …

## book/result.json → `BookStats`

Read only for counts and names; no paragraph, sentence, lemma or summary is stored.

| Stats field | Computed from |
|---|---|
| `title` | `title` (the import's hint; `input.name` when missing) |
| `chapters[].id` | `c0`, `c1`, … in table-of-contents order |
| `chapters[].heading` | `heading` (MAT already makes repeated headings unique) |
| `chapters[].words` | whitespace-separated tokens in `paragraphs` that contain a letter or digit |
| `chapters[].sentences` | number of `sentences` (null when splitting didn't run) |
| `chapters[].paragraphs` | non-empty `paragraphs` |
| `chapters[].longestSentence` | words in the longest of `sentences[].text` (counted like `words`) |
| `chapters[].dialogue` | `sentences` whose text contains a quotation mark (`„ “ ” " » « ‹ ›`; apostrophes don't count) |
| `chapters[].questions` | `sentences` ending in `?`, maybe followed by closing quotes or brackets |
| `chapters[].entities` | `sentences[].entities` grouped by `label`, case-insensitive, top 15 each; `PERSON` (the character list covers people), `DATE`, `TIME` and number labels are left out |
| `chapters[].characters` | `characters[].chapters[heading]`, top 15 per chapter |
| `chapters[].newCharacters` | characters whose first chapter (by order) with a mention is this one, ordered by their mentions in the whole book, top 15 |

Sentence texts are only counted and never stored. Not read: `chapters[].summary` (AI-written),
`sentences[].lemmas`, `characters[].variants`, `characters[].joined`.

`BookStats.MODEL` is 2 since the sentence numbers and places/groups were added. Books staged with an older
model are queued for a re-read from their archive when the plugin starts.

## When `speakers` and the transcript disagree

The spec says to use `speakers` for speaking time. In real results that list can lose most of a speaker: one
2.6.0 result had a speaker at 0.1 s in `speakers` while ~5,000 words and ~1,600 s of lines named them
(reported as [GameOfPods/MAT#4](https://github.com/GameOfPods/MAT/issues/4)). So the reader checks:

- If a speaker's segment time is below half the time of the lines naming them (and those lines add up to at
  least a minute), it assigns each `diarization` cluster to the speaker most of its words belong to and
  rebuilds the speaker's time from those clusters. Warning `speaker-rebuilt`.
- A speaker the lines name for a minute or more but who is missing from `speakers` is added the same way.
  Warning `speaker-added`.
- If rebuilding doesn't help, the numbers stay as MAT wrote them. Warning `speaker-mismatch`.

Warnings are shown to podcasters on the manage page, not to visitors.

## Testing against your own results

```bash
cd backend && ./gradlew test -PstatsSamples=/path/to/results
```

runs every ZIP in that folder through the readers and prints what came out. The repo itself only contains
MAT's own example result (Apache-2.0, `backend/src/test/resources/mat-example/`).
