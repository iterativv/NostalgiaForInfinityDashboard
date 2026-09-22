// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest"
import { Schema } from "effect"
import { defineWidget } from "./widgets.js"

/** Matches the widget component signature without importing React types. */
const Probe = () => null

describe("defineWidget dimension hints", () => {
  it("defaults minWidth/minHeight/hasSettings", () => {
    const def = defineWidget({
      type: "test.probe",
      title: "Probe",
      description: "Probe widget",
      configSchema: Schema.Struct({}),
      defaultConfig: {},
      component: Probe,
    })
    expect(def.minWidth).toBe(280)
    expect(def.minHeight).toBe(160)
    expect(def.hasSettings).toBe(false)
    expect(def.capabilities).toEqual([])
  })

  it("keeps declared minimum dimensions for the too-small warning", () => {
    const def = defineWidget({
      type: "test.probe-sized",
      title: "Probe",
      description: "Probe widget",
      configSchema: Schema.Struct({}),
      defaultConfig: {},
      component: Probe,
      minWidth: 460,
      minHeight: 320,
      hasSettings: true,
    })
    expect(def.minWidth).toBe(460)
    expect(def.minHeight).toBe(320)
    expect(def.hasSettings).toBe(true)
  })

  it("keeps the declared capabilities verbatim for runtime checks", () => {
    // Sensitivity is derived at runtime from the root's criteria against
    // these ids (see `@nfi/capabilities` sensitivity helpers) — the
    // definition just stores what it needs.
    const def = defineWidget({
      type: "test.capability-list",
      title: "Caps",
      description: "",
      configSchema: Schema.Struct({}),
      defaultConfig: {},
      component: Probe,
      capabilities: ["instances.profit.relative", "instances.balance"],
    })
    expect(def.capabilities).toEqual([
      "instances.profit.relative",
      "instances.balance",
    ])
  })
})
