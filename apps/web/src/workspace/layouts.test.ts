// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import {
  PanelId as PanelIdSchema,
  type PanelId,
} from "@nfi/api-contract";
import { collectPanelIds, integrityErrors } from "@nfi/widget-sdk";
import type { LayoutNode, Workspace } from "@nfi/api-contract";
import { buildDefaultWorkspace } from "./defaultWorkspace";

const panelId = (id: string): PanelId => Schema.decodeSync(PanelIdSchema)(id);

import {
  buildAutoLayout,
  buildFlowLayout,
  buildMasonryLayout,
  migrateGridToAuto,
} from "./layouts";

/** Panel ids of the default workspace, in tree order. */
function defaultIds(): PanelId[] {
  const workspace = buildDefaultWorkspace();

  return collectPanelIds(workspace.layout);
}

describe("buildAutoLayout", () => {
  it("places every panel exactly once and stays in auto mode", () => {
    const workspace: Workspace = buildDefaultWorkspace();
    const ids = defaultIds();

    const layout = buildAutoLayout(ids, 320, () => 220, 260, () => 2);
    expect(layout.type).toBe("auto");

    if (layout.type === "auto") {
      expect(layout.items.map((i) => i.height)).toEqual(
        ids.map(() => 220),
      );
      expect(layout.items.map((i) => i.span)).toEqual(ids.map(() => 2));
    }

    expect(collectPanelIds(layout).map(String).sort()).toEqual(
      ids.map(String).sort(),
    );
    expect(integrityErrors({ ...workspace, layout })).toEqual([]);
  });

  it("keeps singles/empties in auto mode and coerces bad spans", () => {
    const ids = [panelId("a"), panelId("b")];
    const layout = buildAutoLayout(ids, 320, () => 220, 260, () => 2);
    expect(layout.type).toBe("auto");

    const defaulted = buildAutoLayout(ids, 320);

    if (defaulted.type === "auto") {
      expect(defaulted.items.map((i) => i.height)).toEqual([260, 260]);
      expect(defaulted.items.map((i) => i.span)).toEqual([1, 1]);
    }

    const solo = buildAutoLayout([panelId("solo")], 320);
    expect(solo.type).toBe("auto");

    const empty = buildAutoLayout([], 320);
    expect(empty.type).toBe("auto");

    if (empty.type === "auto") expect(empty.items).toHaveLength(0);

    const coerced = buildAutoLayout(ids, 320, undefined, 260, () => 0);

    if (coerced.type === "auto")
      expect(coerced.items.every((i) => i.span === 1)).toBe(true);
  });
});

describe("buildFlowLayout / buildMasonryLayout", () => {
  it("collapses singles and refuses empties", () => {
    expect(buildFlowLayout([], 360, 280)).toBeNull();
    expect(buildMasonryLayout([], 380)).toBeNull();

    const soloFlow = buildFlowLayout([panelId("a")], 360, 280);
    expect(soloFlow?.type).toBe("tabs");

    const soloMasonry = buildMasonryLayout([panelId("a")], 380);
    expect(soloMasonry?.type).toBe("tabs");
  });

  it("places every panel exactly once", () => {
    const ids = [panelId("a"), panelId("b"), panelId("c")];
    const flow = buildFlowLayout(ids, 360, 280);
    expect(flow?.type).toBe("flow");
    expect(collectPanelIds(flow!).map(String).sort()).toEqual(
      ids.map(String).sort(),
    );

    const masonry = buildMasonryLayout(ids, 380);
    expect(masonry?.type).toBe("masonry");
    expect(collectPanelIds(masonry!).map(String).sort()).toEqual(
      ids.map(String).sort(),
    );
  });
});

describe("migrateGridToAuto", () => {
  it("converts grid cells to auto cards in reading order", () => {
    const ids = [panelId("a"), panelId("b"), panelId("c")];

    const grid: LayoutNode = {
      type: "grid",
      // SAFETY: fixture node id — a plain string stands in for the branded
      // id; the tests under test only compare ids opaquely (map(String)).
      id: "g" as never,
      columns: [1, 1],
      rows: [1, 1],
      items: [
        {
          type: "item",
          // SAFETY: fixture cell id — plain string for the branded type,
          // compared only opaquely by the assertions below.
          id: "c0" as never,
          col: 1,
          row: 1,
          colSpan: 2,
          rowSpan: 1,
          child: {
            type: "tabs",
            // SAFETY: fixture tab id — plain string for the branded type,
            // compared only opaquely by the assertions below.
            id: "t0" as never,
            panels: [ids[0]!],
            activePanelId: ids[0]!,
          },
        },
        {
          type: "item",
          // SAFETY: fixture cell id — plain string for the branded type,
          // compared only opaquely by the assertions below.
          id: "c1" as never,
          col: 1,
          row: 2,
          colSpan: 1,
          rowSpan: 1,
          child: {
            type: "tabs",
            // SAFETY: fixture tab id — plain string for the branded type,
            // compared only opaquely by the assertions below.
            id: "t1" as never,
            panels: [ids[1]!],
            activePanelId: ids[1]!,
          },
        },
        {
          type: "item",
          // SAFETY: fixture cell id — plain string for the branded type,
          // compared only opaquely by the assertions below.
          id: "c2" as never,
          col: 2,
          row: 2,
          colSpan: 1,
          rowSpan: 1,
          child: {
            type: "tabs",
            // SAFETY: fixture tab id — plain string for the branded type,
            // compared only opaquely by the assertions below.
            id: "t2" as never,
            panels: [ids[2]!],
            activePanelId: ids[2]!,
          },
        },
      ],
    };

    const migrated = migrateGridToAuto(grid);
    expect(migrated.type).toBe("auto");

    if (migrated.type === "auto") {
      expect(migrated.items).toHaveLength(3);
      expect(migrated.items.map((i) => i.span)).toEqual([2, 1, 1]);
      expect(collectPanelIds(migrated).map(String)).toEqual(
        ids.map(String),
      );
    }
  });

  it("passes non-grid nodes through while migrating children", () => {
    const workspace = buildDefaultWorkspace();
    const migrated = migrateGridToAuto(workspace.layout);

    expect(migrated.type).toBe("auto");
  });
});
