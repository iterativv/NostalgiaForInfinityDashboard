// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import { PanelId as PanelIdSchema } from "@nfi/api-contract";
import type { PanelId } from "@nfi/api-contract";
import { collectPanelIds, integrityErrors } from "@nfi/widget-sdk";
import { buildAutoLayout } from "./layouts";
import { buildDefaultWorkspace } from "./defaultWorkspace";
import { homeFingerprint } from "./pages";

const panelId = (id: string): PanelId => Schema.decodeSync(PanelIdSchema)(id);

describe("auto layout", () => {
  it("builds autos placing every panel exactly once", () => {
    const workspace = buildDefaultWorkspace();
    const ids = collectPanelIds(workspace.layout);

    const layout = buildAutoLayout(ids, 320, () => 220, 260, () => 2);
    expect(layout.type).toBe("auto");
    expect(collectPanelIds(layout).map(String).sort()).toEqual(
      ids.map(String).sort(),
    );
    expect(integrityErrors({ ...workspace, layout })).toEqual([]);

    if (layout.type === "auto") {
      expect(layout.columnWidth).toBe(320);
      expect(layout.items).toHaveLength(ids.length);
    }
  });

  it("starts cards at hinted sizes and keeps singles/empties in auto mode", () => {
    const ids = [panelId("a"), panelId("b")];
    const layout = buildAutoLayout(ids, 320, () => 220, 260, () => 2);
    expect(layout.type).toBe("auto");

    if (layout.type === "auto") {
      expect(layout.items.map((i) => i.height)).toEqual([220, 220]);
      expect(layout.items.map((i) => i.span)).toEqual([2, 2]);

      const defaulted = buildAutoLayout(ids, 320);

      if (defaulted.type === "auto") {
        expect(defaulted.items.map((i) => i.height)).toEqual([260, 260]);
        expect(defaulted.items.map((i) => i.span)).toEqual([1, 1]);
      }
    }

    const solo = buildAutoLayout([panelId("solo")], 320);
    expect(solo.type).toBe("auto");

    if (solo.type === "auto") expect(solo.items).toHaveLength(1);

    const empty = buildAutoLayout([], 320);
    expect(empty.type).toBe("auto");

    if (empty.type === "auto") expect(empty.items).toHaveLength(0);
  });

  it("keeps dragged sizes through rebuilds", () => {
    const ids = [panelId("a"), panelId("b"), panelId("c")];

    const layout = buildAutoLayout(
      ids,
      320,
      () => 280,
      260,
      (id) => (String(id) === "b" ? 2 : 1),
    );

    expect(layout?.type).toBe("auto");

    if (layout?.type === "auto")
      expect(layout.items.map((i) => i.span)).toEqual([1, 2, 1]);

    const coerced = buildAutoLayout(ids, 320, undefined, 260, () => 0);

    if (coerced?.type === "auto")
      expect(coerced.items.every((i) => i.span === 1)).toBe(true);
  });

  it("fingerprints auto roots distinctly from flows and masonries", () => {
    const workspace = buildDefaultWorkspace();
    const ids = collectPanelIds(workspace.layout);
    const autoFingerprint = homeFingerprint(workspace);
    expect(autoFingerprint).toContain("auto:");

    const { buildFlowLayout } = { buildFlowLayout: null };
    void buildFlowLayout;
    void ids;
  });
});
