# MAT Output Format (input for the stats plugin)

Source: [GameOfPods/MAT](https://github.com/GameOfPods/MAT) (GPL-3.0). **Confirmed against a real sample export (MAT 0.2.0, `meta.version = "1"`)** — all schemas below are verified.

> **Positioning:** MAT is the **first stats source**, attached via `MatStatsReader` (`canRead`/`read`, see the stats brief). The reader parses the MAT format (`MatExport` below) and **normalizes** it to the source-agnostic `EpisodeStats` model that the plugin stores/displays. Other tools attach later via their own readers — this file describes only the MAT input.

## Upload candidate: a ZIP of the output folder
MAT writes one folder per analyzed file; the user zips it, **the ZIP is the upload**:
```
SPOILER! 5.22 - Arya IV_2026-06-28_20-56-03/
├── meta.json
├── config.json                 ← pipeline configuration (irrelevant to the stats plugin)
└── 0.PodcastOutput/            ← one subfolder per pipeline result
    ├── media.json
    ├── transcript.json
    ├── transcript.txt
    ├── diarization.json
    ├── diarization.rttm
    └── summary.txt
```
Flow in the plugin: unzip → read `meta.json` → find the podcast pipeline folder → parse the files defensively.

## meta.json
```json
{
  "version": "1",
  "MAT_version": "0.2.0",
  "file_name": "SPOILER! 5.22 - Arya IV.mp3",
  "file_hash": "3d416d80…",
  "file_name_wo_extension": "SPOILER! 5.22 - Arya IV",
  "full_file": "/media/ned/NAS/…/SPOILER! 5.22 - Arya IV.mp3",
  "creation_time": "2026-06-28T20:56:03.483158",
  "pipelines": [
    { "folder": "0.PodcastOutput", "type": "<class 'MAT.pipelines.Podcast.PodcastOutput'>" }
  ]
}
```
- **Find the pipeline:** take the entry in `pipelines` whose `type` ends with `PodcastOutput` → use its `folder`. (There may also be a `BookOutput` — irrelevant to stats.)
- Check `version` (currently `"1"`); reject/handle unknown versions defensively. Ignore `full_file` (an absolute path from the producing machine).

## media.json  → runtime & language
```json
{
  "file_name": "SPOILER! 5.22 - Arya IV.mp3",
  "duration": 1174.776,            // seconds (float)  ← RUNTIME
  "duration_after_vad": 1144.872,  // seconds without silence
  "sample_rate": 48000,
  "max_dbfs": -3.26,
  "rms": 2443,
  "language": "de"
}
```

## diarization.json  → speaker timeline (main source for speaking shares)
Mapping **speaker → list of `[from, to]` segments in seconds**:
```json
{
  "alex": [[20.16, 21.6], [23.44, 24.88], …],
  "max":  [[…, …], …]
}
```
- Speaker keys may **already be real names** (here `alex`, `max`) or technical labels (`SPEAKER_00`), depending on whether MAT had gold-label identification. See "Speaker mapping".

## transcript.json  → word level with speaker
```json
{ "transcript": [
  { "speaker": ["alex"], "word": "Herzlich", "start": 20.27, "finish": 20.551 },
  …
] }
```
- **`speaker` is a list of 0..N labels:** `["alex"]` (normal), `[]` (unattributed — 73× in the sample), `["alex","max"]` (overlap — 21×). When counting: skip empty or track as `<none>`; count multi for each speaker involved.
- `start`/`finish` in seconds (float).

## diarization.rttm  → fallback timeline
Standard RTTM, one line per segment, the speaker name in the `speaker_name` column:
```
SPEAKER SPOILER! 5.22 - Arya IV.mp3 1 20.16 1.44 <NA> <NA> alex <NA> <NA>
```
- **Caution:** the `file_id` column here contains **spaces** (the file name) → naive whitespace splitting breaks. **Prefer `diarization.json`**, RTTM only as a fallback.

## transcript.txt / summary.txt / config.json
Plain transcript · markdown summary · pipeline config (models, labels) — not needed for the stats plugin.

---

## Typed interface (parsed model, Java)
```java
record MatExport(MatMeta meta, PodcastData podcast) {}
record MatMeta(String version, String matVersion, String fileName, String fileHash,
               Instant creationTime) {}
record PodcastData(MediaInfo media, List<Word> transcript,
                   Map<String, List<Segment>> diarization, String summaryMarkdown) {}
record MediaInfo(String fileName, double duration, double durationAfterVad,
                 int sampleRate, String language) {}
record Word(List<String> speakers, String word, double start, double finish) {}
record Segment(double from, double to) {}   // seconds
```
TS types mirror this 1:1 (`speakers: string[]`, numbers as `number`).
> The reader maps this `MatExport` to the source-agnostic `EpisodeStats` (see the stats brief), which is what the plugin actually stores.

## Computations (with a worked example from the sample)
Prefer `diarization.json`; `duration` from `media.json`.

- **Speaking share** (share of talk time) = `speakerTime / Σ speakerTime`.
  → alex **74.7%**, max **25.3%**. (`speakerTime` = sum of a speaker's segment durations.)
- **Talk fraction of the episode** = `speakerTime / duration` → alex 55.1%, max 18.7%.
- **Overlap note:** `Σ speakerTime` double-counts overlapping passages. For "how much of the episode had speech at all" build the **union** of the segments → 72.8% (855 s of 1174.8 s).
- **Longest silence** = the largest gap in the **merged** (union) timeline, incl. start/end `[0, duration]`.
  → **20.2 s** (at the start, 0–20.2 s).
- **Words per speaker** from `transcript.json` (multi counts for each, empty as `<none>`).
  → alex 1800, max 730, none 73. **WPM** = `words / (speakerTime/60)`.

## Speaker mapping
Labels may already be names (`alex`/`max`) **or** technical (`SPEAKER_00`). The plugin maintains an **optional override mapping `label → display name` per feed/episode** in the doc store: if a label is set, show that; otherwise the raw label. So both cases work without a special case.

## Robustness
- **Every file is optional** — tolerate missing ones (MAT writes only present data).
- `speaker` arrays can be empty or multiple.
- Check `meta.version`; reject unknown versions instead of guessing.
- Numbers are seconds (float); format as mm:ss/hh:mm:ss for display.
