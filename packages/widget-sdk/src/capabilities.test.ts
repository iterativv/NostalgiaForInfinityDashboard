// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import type { Capability } from "@nfi/api-contract"
import { defineWidget } from "./widgets.js"
import { canEnableWidget, filterAvailableWidgets, missingCapabilities, unauthorizedReason } from "./capabilities.js"

const Gated = defineWidget({
  type: "test.gated",
  title: "Gated",
  description: "test",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  component: () => null,
  capabilities: ["instances.status", "instances.list"],
  minWidth: 400,
})

const Public = defineWidget({
  type: "test.public",
  title: "Public",
  description: "test",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  component: () => null,
})

const granted = (caps: ReadonlyArray<Capability>): ReadonlyArray<Capability> => caps

describe("capabilities", () => {
  it("reports missing capabilities", () => {
    expect(missingCapabilities(["bot.status", "bot.balance"], granted(["bot.status"]))).toEqual(["bot.balance"])
    expect(missingCapabilities([], [])).toEqual([])
    expect(missingCapabilities(Gated.capabilities, granted(["instances.status"]))).toEqual(["instances.list"])
  })

  it("gates enablement on the full required set", () => {
    expect(canEnableWidget(Gated, granted(["instances.status", "instances.list"]))).toBe(true)
    expect(canEnableWidget(Gated, granted(["instances.status"]))).toBe(false)
    expect(canEnableWidget(Gated, [])).toBe(false)
    expect(canEnableWidget(Public, [])).toBe(true)
  })

  it("filters registries to authorized widgets", () => {
    const all = [Gated, Public]
    expect(filterAvailableWidgets(all, []).map((w) => w.type)).toEqual(["test.public"])
    expect(filterAvailableWidgets(all, granted(["instances.status", "instances.list"])).map((w) => w.type)).toEqual([
      "test.gated",
      "test.public",
    ])
  })

  it("explains unauthorized widgets", () => {
    expect(unauthorizedReason(Gated, granted(["instances.status", "instances.list"]))).toBe("")
    expect(unauthorizedReason(Gated, [])).toContain("instances.status")
  })

  it("defaults new fields for legacy definitions", () => {
    expect(Public.capabilities).toEqual([])
    expect(Public.minWidth).toBe(280)
    expect(Gated.minWidth).toBe(400)
  })
})
