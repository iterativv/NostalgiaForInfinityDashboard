// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  INSTANCE_COLOR_PALETTE,
  dimColor,
  instanceColorByIndex,
  instanceColorOf,
} from "./instanceColors";

describe("instance colors", () => {
  it("assigns list-position slots and wraps past the palette size", () => {
    expect(instanceColorByIndex(0)).toBe(INSTANCE_COLOR_PALETTE[0]);
    expect(instanceColorByIndex(3)).toBe(INSTANCE_COLOR_PALETTE[3]);
    expect(instanceColorByIndex(INSTANCE_COLOR_PALETTE.length)).toBe(
      INSTANCE_COLOR_PALETTE[0],
    );
    expect(instanceColorByIndex(-1)).toBe(
      INSTANCE_COLOR_PALETTE[INSTANCE_COLOR_PALETTE.length - 1],
    );
  });

  it("keeps every slot within the palette (hash fallback included)", () => {
    for (const key of ["default", "bot-1", "binance-lamualfa", "(instr-42)"]) {
      const color = instanceColorOf(key);

      expect(INSTANCE_COLOR_PALETTE).toContain(color);
      expect(instanceColorOf(key)).toBe(color);
    }
  });

  it("separates the common fleet pairs via the hash fallback", () => {
    // Fallback keys (no list) must still separate the typical first bots.
    expect(instanceColorOf("default")).not.toBe(instanceColorOf("bot-1"));
    expect(instanceColorOf("default")).not.toBe(instanceColorOf("all"));
  });

  it("dims colors with a two-digit alpha suffix", () => {
    expect(dimColor("#4589ff")).toBe("#4589ff8c");
    expect(dimColor("#4589ff", 1)).toBe("#4589ffff");
    expect(dimColor("#4589ff", 0)).toBe("#4589ff00");
    expect(dimColor("#42be65", 2)).toBe("#42be65ff");
  });
});
