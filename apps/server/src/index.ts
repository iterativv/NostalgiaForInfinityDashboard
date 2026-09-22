// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { launchServer } from "./boot.js"

// Entry point for dev and Node deployments: the web shell is read from the
// web dist directory (STATIC_DIR overrides the default, resolved inside
// `launchServer` after empty-string env normalization).

// Effect Config only reads process.env, so populate it from apps/server/.env
// first (FREQTRADE_*, SQLITE_PATH, …). A missing .env simply means defaults
// plus whatever the environment already provides.
try {
  process.loadEnvFile()
} catch {
  // No .env file — boot with defaults.
}

launchServer({ static: { kind: "dir" } })
