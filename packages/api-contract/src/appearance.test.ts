// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  AppearanceDefaults,
  AppearanceDefaultsResponse,
} from "./index.js";

describe("AppearanceDefaults", () => {
  it("round-trips a full snapshot and survives its absence", () => {
    const full = Schema.decodeUnknownSync(AppearanceDefaults)({
      colorTheme: "g100",
      accentColor: "teal",
      timeFormat: "eu-24h",
      colorBlindSafe: true,
      highContrast: false,
      disableWidgetMinSize: true,
    });

    expect(full.colorTheme).toBe("g100");
    expect(full.disableWidgetMinSize).toBe(true);

    const encoded = Schema.encodeSync(AppearanceDefaults)(full);
    expect(Schema.decodeUnknownSync(AppearanceDefaults)(encoded)).toEqual(
      full,
    );

    const response = Schema.decodeUnknownSync(AppearanceDefaultsResponse)({
      defaults: JSON.parse(JSON.stringify(encoded)),
    });

    expect(response.defaults).toEqual(full);

    // Never saved: browsers fall back to hardcoded defaults.
    expect(
      Schema.decodeUnknownSync(AppearanceDefaultsResponse)({ defaults: null })
        .defaults,
    ).toBeNull();
  });

  it("decodes partial snapshots and rejects unknown enum values", () => {
    const partial = Schema.decodeUnknownSync(AppearanceDefaults)({
      disableWidgetMinSize: true,
    });

    expect(partial.disableWidgetMinSize).toBe(true);
    expect(partial.colorTheme).toBeUndefined();
    expect(Schema.decodeUnknownSync(AppearanceDefaults)({}).colorTheme).toBeUndefined();

    expect(() =>
      Schema.decodeUnknownSync(AppearanceDefaults)({ colorTheme: "amoled" }),
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(AppearanceDefaults)({ timeFormat: "" }),
    ).toThrow();
  });
});
