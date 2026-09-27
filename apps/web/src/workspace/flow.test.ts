// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { collectPanelIds, integrityErrors } from "@nfi/widget-sdk";
import { buildFlowLayout } from "./layouts";
import { buildDefaultWorkspace } from "./defaultWorkspace";
import { homeFingerprint } from "./pages";

/**
 * Flow is a legacy mode: nothing creates new flow pages — bento (`auto`)
 * is the only page mode — but pages persisted in flow mode still render
 * and resize.
 */

describe("legacy flow pages", () => {
  it("fingerprints flow roots distinctly from autos", () => {
    const workspace = buildDefaultWorkspace();
    const ids = collectPanelIds(workspace.layout);
    const flow = buildFlowLayout(ids, 360, 280)!;
    const fingerprinted = homeFingerprint({ ...workspace, layout: flow });
    expect(fingerprinted.startsWith("flow:")).toBe(true);
    expect(fingerprinted).not.toBe(homeFingerprint(workspace));
  });

  it("builds flow cards with sizes", () => {
    const workspace = buildDefaultWorkspace();
    const ids = collectPanelIds(workspace.layout);
    const flow = buildFlowLayout(ids, 500, 400)!;

    const stored = {
      ...workspace,
      layout: flow,
      activePanelId: ids[0] ?? null,
    };

    if (stored.layout.type === "flow") {
      expect(stored.layout.items).toHaveLength(ids.length);
    }

    expect(integrityErrors(stored)).toEqual([]);
  });
});
