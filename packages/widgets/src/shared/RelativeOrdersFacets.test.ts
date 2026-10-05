// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { isNotableStatus } from "./RelativeOrdersFacets";

/**
 * The facet list surfaces only non-routine order statuses: a routine
 * `closed` (filled) order reads as "position closed" inside the
 * open-trades expansion, so it stays implied by the order's presence.
 */
describe("isNotableStatus", () => {
  it("hides the routine filled state and missing values", () => {
    expect(isNotableStatus("closed")).toBe(false);
    expect(isNotableStatus(undefined)).toBe(false);
    expect(isNotableStatus("")).toBe(false);
  });

  it("surfaces open, canceled and other live states", () => {
    expect(isNotableStatus("open")).toBe(true);
    expect(isNotableStatus("canceled")).toBe(true);
    expect(isNotableStatus("expired")).toBe(true);
  });
});
