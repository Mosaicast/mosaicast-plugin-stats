#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The Mosaicast Authors
set -euo pipefail
cd "$(dirname "$0")"
: "${MOSAICAST_PLUGINS_DIR:?Set MOSAICAST_PLUGINS_DIR or copy dist/ manually}"
[ -f dist/plugin.json ] || { echo "No dist/ yet — run ./build.sh first" >&2; exit 1; }
dest="$MOSAICAST_PLUGINS_DIR/stats"
rm -rf "$dest" && mkdir -p "$dest"
cp -r dist/* "$dest/"
echo "✓ installed to $dest — restart core"
