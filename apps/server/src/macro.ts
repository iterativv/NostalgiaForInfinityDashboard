// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { HttpApiBuilder } from "@effect/platform";
import { NfiApi } from "@nfi/api-contract";
import { runCapabilityForHttp } from "./capabilities/context.js";

/**
 * Macro data (public, no freqtrade): scraped free sources.
 *
 * Every handler delegates to its capability (`@nfi/capabilities`, one file
 * per capability) like every other group — the NY Fed / FRED scraping lives
 * in `macro-fed-rate.ts`, this file owns no fetch logic.
 */

export const MacroGroupLive = HttpApiBuilder.group(NfiApi, "Macro", (handlers) =>
  handlers.handle("fedRate", () => runCapabilityForHttp("macro.fed-rate", {})),
);
