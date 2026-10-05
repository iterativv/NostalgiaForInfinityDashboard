// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  accentStyleFor,
  colorBlindStyleFor,
  highContrastStyleFor,
} from "./carbonTheme";

describe("theme layers", () => {
  it("layers high-contrast black/white surfaces per base brightness", () => {
    expect(highContrastStyleFor("g100")).toMatchObject({
      "--cds-background": "#000000",
      "--cds-text-primary": "#ffffff",
      "--cds-border-strong": "#e0e0e0",
      "--cds-focus": "#ffffff",
    });
    expect(highContrastStyleFor("white")).toMatchObject({
      "--cds-background": "#ffffff",
      "--cds-text-primary": "#000000",
      "--cds-border-strong": "#161616",
      "--cds-focus": "#000000",
    });
  });

  it("remaps red/green semantics to blue/orange for color-blind mode", () => {
    expect(colorBlindStyleFor("g100")).toMatchObject({
      "--cds-support-success": "#4589ff",
      "--cds-support-error": "#ff832b",
      "--cds-tag-background-green": "var(--cds-tag-background-blue)",
      "--cds-tag-background-red": "#3e1a00",
    });
    expect(colorBlindStyleFor("white")).toMatchObject({
      "--cds-support-success": "#0f62fe",
      "--cds-support-error": "#ba4e00",
    });
  });

  it("merges accent, high-contrast and color-blind layers without loss", () => {
    const merged = {
      ...accentStyleFor("orange", "g100"),
      ...highContrastStyleFor("g100"),
      ...colorBlindStyleFor("g100"),
    };

    // Each layer owns disjoint tokens: accent brings interactive blues,
    // high contrast brings surfaces, color-blind brings semantics.
    expect(merged).toMatchObject({
      "--cds-background": "#000000",
      "--cds-support-error": "#ff832b",
      "--cds-button-primary": "#ba4e00",
    });
  });
});
