// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Color-blind safe palette — the one setting every red/green semantic in
 * the desk follows.
 *
 * The preference lives here (not in the web app's prefs store) so the whole
 * widgets package can read it reactively, exactly like the global time
 * format: canvas charts (`CandleChart` cannot resolve CSS `var()` — canvas
 * fillStyle needs literal colors) and the instance-color resolver pull from
 * this TanStack Store, while the web shell layers the matching Carbon token
 * overrides (`colorBlindStyleFor` in `carbonTheme.ts`, which remaps
 * `--cds-support-*` and the red/green tag tokens to blue/orange).
 *
 * Palette source: Okabe–Ito (every pair distinguishable under protanopia,
 * deuteranopia and tritanopia) — sky blue #56B4E9 for up/good, orange
 * #E69F00 for down/bad, reddish purple #CC79A7 for the avg-entry line (kept
 * off both candle hues). Text tokens reuse Carbon's own blue/orange
 * swatches so contrast holds on light and dark themes alike.
 */

import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";

const COLOR_BLIND_STORAGE_KEY = "nfi-desk.colorblind.v1";

function readStoredColorBlind(): boolean {
  if (typeof localStorage === "undefined") return false;

  try {
    return localStorage.getItem(COLOR_BLIND_STORAGE_KEY) === "1";
  } catch {
    // Storage unavailable — standard palette.
    return false;
  }
}

/** True when the color-blind safe palette is on (persisted). */
export const colorBlindStore = new Store<boolean>(readStoredColorBlind());

export function setColorBlindSafe(enabled: boolean): void {
  colorBlindStore.setState(() => enabled);

  try {
    localStorage.setItem(COLOR_BLIND_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Persistence is best-effort (private mode, quota).
  }
}

/** Reactive read for components (re-renders when the setting changes). */
export function useColorBlindSafe(): boolean {
  return useStore(colorBlindStore, (enabled) => enabled);
}

/** Literal canvas colors for bullish/bearish sentiment + trade overlay. */
export interface CandlePalette {
  readonly up: string;
  readonly down: string;
  readonly volumeUp: string;
  readonly volumeDown: string;
  /** Avg-entry price line + label (kept off both candle hues). */
  readonly avgEntry: string;
  /** PnL fill between close and the avg-entry baseline. */
  readonly pnlUp1: string;
  readonly pnlUp2: string;
  readonly pnlDown1: string;
  readonly pnlDown2: string;
  /** MACD histogram bars, colored by sign by the caller. */
  readonly histUp: string;
  readonly histDown: string;
}

/** Current terminal colors (green/red) — the no-change default. */
export const CANDLE_PALETTE_DEFAULT: CandlePalette = {
  up: "#26a69a",
  down: "#ef5350",
  volumeUp: "rgba(38, 166, 154, 0.4)",
  volumeDown: "rgba(239, 83, 80, 0.4)",
  avgEntry: "#4da3ff",
  pnlUp1: "rgba(38, 166, 154, 0.28)",
  pnlUp2: "rgba(38, 166, 154, 0.05)",
  pnlDown1: "rgba(239, 83, 80, 0.05)",
  pnlDown2: "rgba(239, 83, 80, 0.32)",
  histUp: "rgba(38, 166, 154, 0.6)",
  histDown: "rgba(239, 83, 80, 0.6)",
};

/** Okabe–Ito blue/orange — red/green-confusable nowhere in this set. */
export const CANDLE_PALETTE_COLOR_BLIND: CandlePalette = {
  up: "#56B4E9",
  down: "#E69F00",
  volumeUp: "rgba(86, 180, 233, 0.4)",
  volumeDown: "rgba(230, 159, 0, 0.4)",
  avgEntry: "#CC79A7",
  pnlUp1: "rgba(86, 180, 233, 0.28)",
  pnlUp2: "rgba(86, 180, 233, 0.05)",
  pnlDown1: "rgba(230, 159, 0, 0.05)",
  pnlDown2: "rgba(230, 159, 0, 0.32)",
  histUp: "rgba(86, 180, 233, 0.6)",
  histDown: "rgba(230, 159, 0, 0.6)",
};

export const candlePalette = (colorBlind: boolean): CandlePalette =>
  colorBlind ? CANDLE_PALETTE_COLOR_BLIND : CANDLE_PALETTE_DEFAULT;

/**
 * Instance identity palette, Okabe–Ito extended to twelve slots (the
 * stock nine minus black — invisible on dark themes — plus four light
 * variants). Custom stored colors still win; this only drives the
 * automatic assignment and the hash fallback.
 */
export const INSTANCE_COLOR_PALETTE_CB: ReadonlyArray<string> = [
  "#56B4E9", // sky blue
  "#E69F00", // orange
  "#009E73", // bluish green
  "#CC79A7", // reddish purple
  "#0072B2", // blue
  "#D55E00", // vermillion
  "#F0E442", // yellow
  "#999999", // gray
  "#88CCEE", // light sky blue
  "#44AA99", // light bluish green
  "#DDCC77", // light yellow
  "#AA4499", // light purple
];
