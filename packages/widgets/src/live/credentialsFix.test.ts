// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { beforeEach, describe, expect, it } from "vitest";
import {
  clearInstanceAuthFailure,
  credentialsFixStore,
  noteInstanceAuthFailure,
} from "./credentialsFix";

/** BackendError as `formatQueryError` renders it for a freqtrade 401. */
const AUTH_401 =
  'Capability instance whitelist failed: { "operation": "login", "reason": "freqtrade login returned 401", "status": 401 }';

const reset = () =>
  credentialsFixStore.setState(() => ({ instanceId: null, seq: 0 }));

describe("credentials fix hand-off", () => {
  beforeEach(reset);

  it("records the failing instance for a freqtrade 401", () => {
    noteInstanceAuthFailure("instances.whitelist", { id: "ft-1" }, AUTH_401);
    expect(credentialsFixStore.state).toEqual({
      instanceId: "ft-1",
      seq: 1,
    });
  });

  it("ignores non-auth failures and non-instance capabilities", () => {
    noteInstanceAuthFailure(
      "instances.profit",
      { id: "ft-1" },
      "Capability instance profit failed: connection refused",
    );
    noteInstanceAuthFailure("bot.config", {}, AUTH_401);
    expect(credentialsFixStore.state.instanceId).toBeNull();
  });

  it("keeps recording new failures (seq bumps)", () => {
    noteInstanceAuthFailure("instances.profit", { id: "ft-1" }, AUTH_401);
    noteInstanceAuthFailure("instances.balance", { id: "ft-2" }, AUTH_401);
    expect(credentialsFixStore.state).toEqual({
      instanceId: "ft-2",
      seq: 2,
    });
  });

  it("clears the request when the same instance succeeds later", () => {
    noteInstanceAuthFailure("instances.profit", { id: "ft-1" }, AUTH_401);
    clearInstanceAuthFailure("instances.health", { id: "ft-1" });
    expect(credentialsFixStore.state.instanceId).toBeNull();
  });

  it("keeps the request when a different instance succeeds", () => {
    noteInstanceAuthFailure("instances.profit", { id: "ft-1" }, AUTH_401);
    clearInstanceAuthFailure("instances.health", { id: "ft-2" });
    expect(credentialsFixStore.state.instanceId).toBe("ft-1");
  });
});
