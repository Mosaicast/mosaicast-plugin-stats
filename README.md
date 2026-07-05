# mosaicast-plugin-stats

> Episode/feed plugin: normalized stats (speaking shares, runtime, silence). MAT as the first reader.

Part of **[Mosaicast](https://github.com/mosaicast)** — an extensible website platform for podcasts. Status: **v1 in development**.

## What is this?
See `docs/ARCHITECTURE.md` for the big picture and `docs/BRIEF.md` for this repo's scope.

## Build & test
```bash
./build.sh        # -> dist/
cd backend && ./gradlew test  ;  cd ../frontend && npm test
```

## Build & install
`./build.sh` -> `dist/` -> copy to `$MOSAICAST_PLUGINS_DIR`, restart core.
MAT input (ZIP) + schema: `docs/MAT-FORMAT.md`. Stats are NOT authoritative (stats UI only).

## Contributing
Contributions welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md). In short: `git commit -s` (DCO, required), SPDX header in new files, add tests.

## License
**GNU Affero General Public License v3.0 or later** — see [`LICENSE`](LICENSE). Header per source file:
```
// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 The Mosaicast Authors
```

## Name & trademark
"Mosaicast" and the logo denote the official project. Please rename forks.
