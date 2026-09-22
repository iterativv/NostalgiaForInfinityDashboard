// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  clearWidgetGlobalSettings,
  mergeWidgetSettings,
  sanitizeWidgetGlobals,
  setWidgetGlobalSettings,
  widgetGlobalOverrides,
  widgetGlobalsStore,
} from "./widgetGlobals";
import {
  applyWidgetSettings,
  setPanelConfigSink,
  updatePanelConfig,
} from "./panelConfig";
import {
  closeWidgetSettings,
  requestWidgetSettings,
  setWidgetSettingsScope,
} from "./widgetSettingsBus";

/** Reset every store between tests so order never matters. */
beforeEach(() => {
  widgetGlobalsStore.setState(() => ({}));
  closeWidgetSettings();
});

describe("widget globals store", () => {
  it("sanitizes persisted state, keeping only primitive overrides", () => {
    const clean = sanitizeWidgetGlobals({
      balance: { instanceId: "bot-2", limit: 30, flag: true },
      empty: {},
      junk: "not-an-object",
      nested: { deep: { nope: true } },
      arr: [1, 2],
    });
    expect(clean).toEqual({ balance: { instanceId: "bot-2", limit: 30, flag: true } });
    expect(sanitizeWidgetGlobals(null)).toEqual({});
    expect(sanitizeWidgetGlobals(42)).toEqual({});
  });

  it("patches only changed keys and clears per key", () => {
    setWidgetGlobalSettings("balance", { instanceId: "bot-2" });
    setWidgetGlobalSettings("balance", { limit: 30 });
    expect(widgetGlobalOverrides("balance")).toEqual({
      instanceId: "bot-2",
      limit: 30,
    });
    // undefined deletes a single key without touching the rest
    setWidgetGlobalSettings("balance", { instanceId: undefined });
    expect(widgetGlobalOverrides("balance")).toEqual({ limit: 30 });
    // clearing the last key removes the entry
    clearWidgetGlobalSettings("balance");
    expect(widgetGlobalOverrides("balance")).toEqual({});
    expect(widgetGlobalsStore.state["balance"]).toBeUndefined();
    // clearing an unknown type is a no-op
    expect(() => clearWidgetGlobalSettings("never-set")).not.toThrow();
  });

  it("merges global overrides over per-tab config without mutating base", () => {
    const base = { instanceId: "default", limit: 50 };
    const merged = mergeWidgetSettings(base, { instanceId: "bot-2" });
    expect(merged).toEqual({ instanceId: "bot-2", limit: 50 });
    expect(base).toEqual({ instanceId: "default", limit: 50 });
    // no-op layers return the same object identity
    expect(mergeWidgetSettings(base, undefined)).toBe(base);
    expect(mergeWidgetSettings(base, {})).toBe(base);
  });
});

describe("scope-aware settings writes", () => {
  it("tab scope merges the patch into the panel config through the app sink", () => {
    const sink = vi.fn(() => true);
    setPanelConfigSink(sink);
    requestWidgetSettings("panel-1");
    const ok = applyWidgetSettings(
      "panel-1",
      "balance",
      { instanceId: "default", limit: 50 },
      { limit: 30 },
    );
    expect(ok).toBe(true);
    expect(sink).toHaveBeenCalledWith("panel-1", {
      instanceId: "default",
      limit: 30,
    });
    // tab scope never touches the global layer
    expect(widgetGlobalOverrides("balance")).toEqual({});
  });

  it("global scope records only the changed keys as the type's overrides", () => {
    const sink = vi.fn(() => true);
    setPanelConfigSink(sink);
    requestWidgetSettings("panel-1");
    setWidgetSettingsScope("global");
    const ok = applyWidgetSettings(
      "panel-1",
      "balance",
      { instanceId: "default", limit: 50 },
      { instanceId: "bot-2" },
    );
    expect(ok).toBe(true);
    expect(widgetGlobalOverrides("balance")).toEqual({ instanceId: "bot-2" });
    // the app sink stays untouched — the workspace document is not rewritten
    expect(sink).not.toHaveBeenCalled();
  });

  it("global routing only applies while THIS panel's modal is open", () => {
    const sink = vi.fn(() => true);
    setPanelConfigSink(sink);
    requestWidgetSettings("panel-1");
    setWidgetSettingsScope("global");
    // A different panel writes while panel-1's modal is open: plain tab write.
    applyWidgetSettings(
      "panel-2",
      "balance",
      { instanceId: "default" },
      { instanceId: "bot-3" },
    );
    expect(sink).toHaveBeenCalledWith("panel-2", { instanceId: "bot-3" });
    expect(widgetGlobalOverrides("balance")).toEqual({});
  });

  it("reopening a modal resets the scope to tab", () => {
    requestWidgetSettings("panel-1");
    setWidgetSettingsScope("global");
    requestWidgetSettings("panel-2");
    const sink = vi.fn(() => true);
    setPanelConfigSink(sink);
    applyWidgetSettings(
      "panel-2",
      "balance",
      { instanceId: "default" },
      { instanceId: "bot-4" },
    );
    expect(sink).toHaveBeenCalledWith("panel-2", { instanceId: "bot-4" });
    expect(widgetGlobalOverrides("balance")).toEqual({});
  });

  it("writes without a registered sink return false", () => {
    setPanelConfigSink(() => false);
    expect(updatePanelConfig("panel-x", {})).toBe(false);
  });
});
