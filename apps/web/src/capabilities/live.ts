// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Compatibility shim — the live layer moved into `@nfi/widgets` with the
 * widget package extraction. The app registers the transport and mirrors
 * the capability grant in `main.tsx`; this re-export keeps every existing
 * app import (`useCapability`, `refreshCapability`, `PanelVisibleContext`,
 * …) working unchanged.
 */
export * from "@nfi/widgets/live";
