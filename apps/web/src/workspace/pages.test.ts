// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  PAGE_ICON_KEYS,
  PRESET_PAGES,
  getPresetPage,
  isPageIconKey,
  normalizePageIcon,
  refreshPresetWorkspace,
} from "./pages";

/**
 * Opt-in preset pages: builds must carry the `origin: "user"` marker (the
 * signal that keeps a stored preset alive when hydration retires legacy
 * auto-seeded copies), and icon metadata must survive re-curation.
 */

describe("preset page provenance", () => {
  it("stamps every preset build as user-added", () => {
    for (const preset of PRESET_PAGES) {
      for (const band of ["wide", "standard", "compact"] as const) {
        const built = preset.build(band);
        expect(built.id).toBe(preset.id);
        expect(built.origin).toBe("user");
      }
    }
  });

  it("keeps icon and origin when re-curating a stored preset", () => {
    const preset = getPresetPage("page-trading");
    expect(preset).toBeDefined();
    // Stored on the wide band; hydrating on standard must re-curate while
    // preserving the page's own metadata.
    const stored = { ...preset!.build("wide"), icon: "star" };
    const refreshed = refreshPresetWorkspace(stored, preset!, "standard");
    expect(refreshed.origin).toBe("user");
    expect(refreshed.icon).toBe("star");
    expect(refreshed.version).toBe(stored.version + 1);
  });

  it("returns the stored page unchanged when nothing differs", () => {
    const preset = getPresetPage("page-markets");
    expect(preset).toBeDefined();
    const stored = preset!.build("standard");
    expect(refreshPresetWorkspace(stored, preset!, "standard")).toBe(stored);
  });
});

describe("page icon keys", () => {
  it("covers every preset icon", () => {
    for (const preset of PRESET_PAGES) {
      expect(PAGE_ICON_KEYS).toContain(preset.icon);
    }
  });

  it("accepts known keys and rejects stale ones", () => {
    expect(isPageIconKey("rocket")).toBe(true);
    expect(isPageIconKey("nope")).toBe(false);
    expect(normalizePageIcon("chart-line")).toBe("chart-line");
    expect(normalizePageIcon("removed-in-2025")).toBeUndefined();
    expect(normalizePageIcon(undefined)).toBeUndefined();
  });
});
