#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2026 The Mosaicast Authors
set -euo pipefail
cd "$(dirname "$0")"
( cd backend  && ./gradlew --quiet clean jar )
( cd frontend && npm ci && npm run build )       # Vite -> frontend/build/stats.es.js
rm -rf dist && mkdir -p dist/assets
cp backend/build/libs/*.jar dist/
cp frontend/build/*.es.js   dist/assets/
cp plugin.json              dist/
echo "✓ dist/ ready — copy to \$MOSAICAST_PLUGINS_DIR and restart core"
