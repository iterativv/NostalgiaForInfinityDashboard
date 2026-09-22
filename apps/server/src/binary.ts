// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { launchServer } from "./boot.js"
import { webAssets } from "./web-assets.generated.js"

/**
 * Entry point for the compiled single-file release
 * (`bun build --compile`, see `scripts/embed-web-dist.mjs` and
 * `.github/workflows/release.yml`). The web shell is baked into the binary —
 * one file, no node_modules, no web dist on disk.
 */

try {
  process.loadEnvFile()
} catch {
  // No .env file — boot with defaults.
}

// A standalone binary runs from anywhere; default the database to the
// working directory instead of the repo layout used by dev boots. (`||=` so
// an explicitly empty SQLITE_PATH also falls back to this default.)
process.env["SQLITE_PATH"] ||= "nfi-desk.db"

// Standalone binary = usually a local desktop boot: open the terminal in
// the browser automatically (`OPEN_BROWSER=0` to disable).
process.env["OPEN_BROWSER"] ||= "1"

launchServer({
  static: {
    kind: "embedded",
    files: new Map(Object.entries(webAssets)),
  },
})
