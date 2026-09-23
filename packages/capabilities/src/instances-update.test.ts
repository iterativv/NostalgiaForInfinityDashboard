// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { FreqtradeInstance } from "@nfi/api-contract";
import type { StoredInstance } from "@nfi/db";
import type { CapabilityContext } from "./definition.js";
import { InstancesUpdateCapability } from "./instances-update.js";

/**
 * `instances.update` credential-repoint guard: an empty/omitted password
 * keeps the stored secret, so changing the base URL or username without a
 * fresh password would forward the REAL bot credentials to the new host.
 * The capability must reject that shape before touching storage.
 */

const STORED: StoredInstance = {
  id: "ft-1",
  name: "binance",
  baseUrl: "http://bot:8080",
  username: "freqtrader",
  password: "real-secret",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function stubCtx(
  updated: Array<{ id: string; password?: string }>,
): CapabilityContext {
  const toPublic = (row: StoredInstance): FreqtradeInstance => ({
    id: row.id,
    name: row.name,
    baseUrl: row.baseUrl,
    username: row.username,
    hasPassword: row.password.length > 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
  return {
    getStoredInstance: (id: string) =>
      Effect.succeed(id === STORED.id ? { ...STORED } : null),
    instances: {
      updateInstance: (id: string, input: { password?: string }) => {
        updated.push({ id, password: input.password });
        return Effect.succeed(toPublic({ ...STORED }));
      },
    },
  } as unknown as CapabilityContext;
}

const runUpdate = (
  options: Parameters<typeof InstancesUpdateCapability.run>[0],
  updated: Array<{ id: string; password?: string }>,
) =>
  Effect.runPromise(
    InstancesUpdateCapability.run(options, stubCtx(updated)).pipe(
      Effect.either,
    ),
  );

describe("instances.update credential-repoint guard", () => {
  it("rejects a baseUrl change without a fresh password", async () => {
    const updated: Array<{ id: string; password?: string }> = [];
    const result = await runUpdate(
      { id: "ft-1", baseUrl: "http://evil:8080" },
      updated,
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left")
      expect((result.left as { error?: string }).error ?? "").toContain(
        "password",
      );
    expect(updated).toHaveLength(0);
  });

  it("rejects a username change without a fresh password", async () => {
    const updated: Array<{ id: string; password?: string }> = [];
    const result = await runUpdate(
      { id: "ft-1", username: "someone-else" },
      updated,
    );
    expect(result._tag).toBe("Left");
    expect(updated).toHaveLength(0);
  });

  it("allows a rename-only edit that keeps the stored password", async () => {
    const updated: Array<{ id: string; password?: string }> = [];
    const result = await runUpdate({ id: "ft-1", name: "renamed" }, updated);
    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
  });

  it("allows a repoint that supplies a fresh password", async () => {
    const updated: Array<{ id: string; password?: string }> = [];
    const result = await runUpdate(
      { id: "ft-1", baseUrl: "http://bot2:8080", password: "new-secret" },
      updated,
    );
    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.password).toBe("new-secret");
  });

  it("treats a trailing-slash-only difference as unchanged", async () => {
    const updated: Array<{ id: string; password?: string }> = [];
    const result = await runUpdate(
      { id: "ft-1", baseUrl: "http://bot:8080/", username: "freqtrader" },
      updated,
    );
    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
  });

  it("returns not-found for an unknown instance", async () => {
    const updated: Array<{ id: string; password?: string }> = [];
    const result = await runUpdate({ id: "ft-missing", name: "x" }, updated);
    expect(result._tag).toBe("Left");
    expect(updated).toHaveLength(0);
  });
});
