// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import type { LayoutNode, Workspace } from "@nfi/api-contract";
import { builtinWidgets } from "@nfi/widgets";
import { PRESET_PAGES, type PresetAspectBand } from "./pages";

const BANDS: ReadonlyArray<PresetAspectBand> = ["wide", "standard", "compact"];

function collectRefs(node: LayoutNode, out: string[]): void {
  if (node.type === "panel") {
    out.push(node.panelId);

    return;
  }

  if (node.type === "tabs") {
    out.push(...node.panels);

    return;
  }

  if (node.type === "grid") {
    for (const item of node.items) collectRefs(item.child, out);

    return;
  }

  if (node.type === "flow") {
    for (const item of node.items) collectRefs(item.child, out);

    return;
  }

  if (node.type === "masonry") {
    for (const item of node.items) collectRefs(item.child, out);

    return;
  }

  if (node.type === "auto") {
    for (const item of node.items) collectRefs(item.child, out);

    return;
  }

  collectRefs(node.first, out);
  collectRefs(node.second, out);
}

describe("preset crash repro (scratch)", () => {
  it("every preset x band: layout refs resolve, tabs consistent, configs decode", () => {
    const defs = new Map(builtinWidgets.map((d) => [d.type, d]));

    for (const preset of PRESET_PAGES) {
      for (const band of BANDS) {
        const ws: Workspace = preset.build(band);
        const refs: string[] = [];
        collectRefs(ws.layout, refs);

        expect(
          refs.length,
          `${preset.id}/${band}: layout references no panels`,
        ).toBeGreaterThan(0);

        for (const ref of refs) {
          expect(
            ws.panels[ref],
            `${preset.id}/${band}: layout references missing panel ${ref}`,
          ).toBeDefined();
        }

        for (const pid of Object.keys(ws.panels)) {
          expect(
            refs.includes(pid),
            `${preset.id}/${band}: panel ${pid} unreferenced by layout`,
          ).toBe(true);
        }

        expect(
          ws.activePanelId !== null &&
            ws.panels[ws.activePanelId] !== undefined,
          `${preset.id}/${band}: bad activePanelId ${ws.activePanelId}`,
        ).toBe(true);

        for (const [pid, panel] of Object.entries(ws.panels)) {
          const def = defs.get(panel.widgetType);
          expect(
            def,
            `${preset.id}/${band}: unknown widget ${panel.widgetType} in ${pid}`,
          ).toBeDefined();

          try {
            def!.decodeConfig(panel.widgetConfig);
          } catch (cause) {
            throw new Error(
              `${preset.id}/${band}: decodeConfig threw for ${panel.widgetType} in ${pid}: ${String(cause)}`,
              { cause },
            );
          }
        }
      }
    }
  });
});
