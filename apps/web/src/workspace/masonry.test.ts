// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { collectPanelIds, integrityErrors } from "@nfi/widget-sdk";
import { buildMasonryLayout } from "./layouts";
import { buildDefaultWorkspace } from "./defaultWorkspace";
import { homeFingerprint } from "./pages";

/**
 * Masonry is a legacy mode: pages persisted in masonry mode still render
 * and resize, but nothing creates new masonry pages — bento (`auto`) is
 * the only page mode.
 */

describe("legacy masonry pages", () => {
  it("fingerprints masonry roots distinctly from autos", () => {
    const workspace = buildDefaultWorkspace();
    const ids = collectPanelIds(workspace.layout);
    const autoFingerprint = homeFingerprint(workspace);
    const masonryLayout = buildMasonryLayout(ids, 380);

    expect(masonryLayout).not.toBeNull();

    const masonryFingerprint = homeFingerprint({
      ...workspace,
      layout: masonryLayout!,
    });

    expect(masonryFingerprint).toContain("masonry:");
    expect(masonryFingerprint).not.toBe(autoFingerprint);
  });

  it("builds masonry cards with heights and spans", () => {
    const workspace = buildDefaultWorkspace();
    const ids = collectPanelIds(workspace.layout);

    const heights = new Map(
      ids.map((id, index) => [String(id), 200 + index * 40]),
    );

    const masonryLayout = buildMasonryLayout(
      ids,
      320,
      (id) => heights.get(String(id)) ?? 280,
    );

    expect(masonryLayout).not.toBeNull();

    if (masonryLayout?.type === "masonry") {
      expect(masonryLayout.items).toHaveLength(ids.length);
      expect(integrityErrors({ ...workspace, layout: masonryLayout })).toEqual(
        [],
      );
    }
  });
});
