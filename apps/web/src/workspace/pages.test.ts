// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { collectPanelIds, integrityErrors } from "@nfi/widget-sdk";
import { builtinWidgets } from "@nfi/widgets";
import {
  PAGE_ICON_KEYS,
  PRESET_PAGES,
  getPresetPage,
  isPageIconKey,
  isPresetPageId,
  normalizePageIcon,
  refreshPresetWorkspace,
} from "./pages";
import { buildDefaultWorkspace } from "./defaultWorkspace";

const widgetMin = new Map(
  builtinWidgets.map((definition) => [
    definition.type,
    { minWidth: definition.minWidth, minHeight: definition.minHeight },
  ]),
);

/**
 * Preset pages seed the Add-page dialog with curated pro trader/investor
 * dashboards; the pages bar holds Home plus user-added preset/custom
 * pages.
 */

describe("preset page catalog", () => {
  it("ships curated trader/investor presets", () => {
    expect(PRESET_PAGES.length).toBeGreaterThanOrEqual(5);
    expect(PRESET_PAGES.map((p) => p.id)).toContain("page-preset-trading");
    expect(PRESET_PAGES.map((p) => p.id)).toContain("page-preset-portfolio");
    expect(PRESET_PAGES.map((p) => p.id)).toContain(
      "page-preset-performance",
    );
    expect(getPresetPage("page-nope")).toBeUndefined();
    expect(isPresetPageId("page-preset-trading")).toBe(true);
    expect(isPresetPageId("page-custom-x")).toBe(false);
  });

  it("every preset builds a valid self-consistent workspace", () => {
    for (const preset of PRESET_PAGES) {
      const workspace = preset.build();
      expect(workspace.id).toBe(preset.id);
      expect(workspace.name).toBe(preset.title);
      expect(workspace.layout.type).toBe("auto");
      expect(integrityErrors(workspace)).toEqual([]);
      expect(collectPanelIds(workspace.layout)).toHaveLength(
        preset.widgets.length,
      );

      for (const widget of preset.widgets) {
        expect(
          Object.values(workspace.panels).some(
            (panel) => panel.widgetType === widget,
          ),
        ).toBe(true);
      }
    }
  });

  it("every preset card starts at or above its widget minimum", () => {
    for (const preset of PRESET_PAGES) {
      const workspace = preset.build();
      expect(workspace.layout.type).toBe("auto");

      if (workspace.layout.type !== "auto")
        throw new Error("expected auto layout");

      for (const item of workspace.layout.items) {
        if (item.child.type !== "tabs" || item.child.panels.length !== 1)
          throw new Error("expected one widget per card");
        const panelId = item.child.panels[0]!;
        const panel = workspace.panels[panelId];
        const min = widgetMin.get(panel?.widgetType ?? "");

        expect(min).toBeDefined();
        expect(item.height).toBeGreaterThanOrEqual(min!.minHeight + 28);
        // No span-1 cards on 360px columns (span 1 ≈ 360px < 370 minimums);
        // wide widgets (≥ 700px) take span 3 (≈ 1096px).
        expect(item.span).toBeGreaterThanOrEqual(2);

        if (min!.minWidth >= 700) expect(item.span).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("refresh rebuilds the canonical layout preserving identity", () => {
    const preset = getPresetPage("page-preset-trading");
    expect(preset).toBeDefined();

    if (!preset) return;

    const stored = {
      ...preset.build(),
      name: "My Renamed Terminal",
      version: 7,
    };

    const refreshed = refreshPresetWorkspace(stored, preset, "standard");
    expect(refreshed.id).toBe(stored.id);
    expect(refreshed.name).toBe("My Renamed Terminal");
    expect(integrityErrors(refreshed)).toEqual([]);
  });

  it("stored default workspace is not a preset", () => {
    const stored = buildDefaultWorkspace();
    expect(isPresetPageId(stored.id)).toBe(false);
  });
});

describe("page icon keys", () => {
  it("covers the icon set", () => {
    expect(PAGE_ICON_KEYS).toContain("dashboard");
    expect(PAGE_ICON_KEYS).toContain("rocket");
    expect(PAGE_ICON_KEYS).toContain("wallet");
    expect(PAGE_ICON_KEYS).toContain("shield");
    expect(PAGE_ICON_KEYS).toContain("chart-bar");
    expect(PAGE_ICON_KEYS).toContain("portfolio");
  });

  it("accepts known keys and rejects stale ones", () => {
    expect(isPageIconKey("rocket")).toBe(true);
    expect(isPageIconKey("wallet")).toBe(true);
    expect(isPageIconKey("nope")).toBe(false);
    expect(normalizePageIcon("chart-line")).toBe("chart-line");
    expect(normalizePageIcon("removed-in-2025")).toBeUndefined();
    expect(normalizePageIcon(undefined)).toBeUndefined();
  });
});
