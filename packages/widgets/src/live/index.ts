// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Live layer of `@nfi/widgets`: the SSE multiplex pool + `useCapability`
 * hook (moved from the app's `capabilities/live.ts`), plus the injected
 * transport/grant bridges the app registers at boot.
 */
export * from "./live";
export * from "./transport";
export * from "./credentialsFix";
