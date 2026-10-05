// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  CANDLE_PALETTE_COLOR_BLIND,
  CANDLE_PALETTE_DEFAULT,
  INSTANCE_COLOR_PALETTE_CB,
  candlePalette,
} from "./colorBlind";
import { INSTANCE_COLOR_PALETTE } from "./instanceColors";

describe("color-blind palettes", () => {
  it("keeps the default candle palette on the legacy hex (no visual change)", () => {
    expect(CANDLE_PALETTE_DEFAULT).toMatchObject({
      up: "#26a69a",
      down: "#ef5350",
      avgEntry: "#4da3ff",
    });
    expect(candlePalette(false)).toBe(CANDLE_PALETTE_DEFAULT);
    expect(candlePalette(true)).toBe(CANDLE_PALETTE_COLOR_BLIND);
  });

  it("swaps every sentiment color in the color-blind palette", () => {
    // SAFETY: Object.keys on this string-keyed const object yields exactly
    // its keyof union, so the cast only re-labels the compiler's string[].
    for (const key of Object.keys(CANDLE_PALETTE_DEFAULT) as Array<
      keyof typeof CANDLE_PALETTE_DEFAULT
    >) {
      expect(CANDLE_PALETTE_COLOR_BLIND[key]).not.toBe(
        CANDLE_PALETTE_DEFAULT[key],
      );
    }
  });

  it("ships twelve distinct instance slots", () => {
    expect(INSTANCE_COLOR_PALETTE_CB).toHaveLength(
      INSTANCE_COLOR_PALETTE.length,
    );
    expect(new Set(INSTANCE_COLOR_PALETTE_CB).size).toBe(
      INSTANCE_COLOR_PALETTE_CB.length,
    );
  });
});
