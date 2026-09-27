// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import type { FreqtradeInstance } from "@nfi/api-contract";
import type { InstanceRepoService, StoredInstance } from "@nfi/db";
import type { CapabilityContext } from "./definition.js";
import { InstancesUpdateCapability } from "./instances-update.js";

/**
 * `instances.update` credential-repoint guard: an empty/omitted password
 * keeps the stored secret, so changing the base URL or username without a
 * fresh password would forward the REAL bot credentials to the new host.
 * The capability must reject that shape before touching storage. Also
 * covers the custom-color tri-state (keep / clear / set with validation).
 */

const STORED: StoredInstance = {
  id: "ft-1",
  name: "binance",
  baseUrl: "http://bot:8080",
  username: "freqtrader",
  password: "real-secret",
  color: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

/** The exact context members `instances.update` reads (deliberate stub). */
interface UpdateContextStub {
  readonly getStoredInstance: CapabilityContext["getStoredInstance"];
  readonly instances: {
    readonly updateInstance: InstanceRepoService["updateInstance"];
  };
}

interface UpdateCapture {
  id: string;
  password?: string;
  color?: string | null;
}

function stubCtx(updated: Array<UpdateCapture>): CapabilityContext {
  const toPublic = (row: StoredInstance): FreqtradeInstance => {
    const base: FreqtradeInstance = {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      username: row.username,
      hasPassword: row.password.length > 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };

    if (row.color === null) return base;

    return { ...base, color: row.color };
  };

  const ctx: UpdateContextStub = {
    getStoredInstance: (id) =>
      Effect.succeed(id === STORED.id ? { ...STORED } : null),
    instances: {
      updateInstance: (id, input) => {
        updated.push({ id, password: input.password, color: input.color });

        return Effect.succeed(toPublic({ ...STORED }));
      },
    },
  };

  // SAFETY: deliberate test double — `instances.update` reads only
  // `getStoredInstance` and `instances.updateInstance` from the context.
  return ctx as CapabilityContext;
}

const runUpdate = (
  options: Parameters<typeof InstancesUpdateCapability.run>[0],
  updated: Array<UpdateCapture>,
) =>
  Effect.runPromise(
    InstancesUpdateCapability.run(options, stubCtx(updated)).pipe(
      Effect.either,
    ),
  );

describe("instances.update credential-repoint guard", () => {
  it("rejects a baseUrl change without a fresh password", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate(
      { id: "ft-1", baseUrl: "http://evil:8080" },
      updated,
    );

    expect(Either.isLeft(result)).toBe(true);

    if (Either.isLeft(result))
      expect(result.left.error).toContain("password");
    expect(updated).toHaveLength(0);
  });

  it("rejects a username change without a fresh password", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate(
      { id: "ft-1", username: "someone-else" },
      updated,
    );

    expect(result._tag).toBe("Left");
    expect(updated).toHaveLength(0);
  });

  it("allows a rename-only edit that keeps the stored password", async () => {
    const updated: Array<UpdateCapture> = [];
    const result = await runUpdate({ id: "ft-1", name: "renamed" }, updated);
    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
  });

  it("allows a repoint that supplies a fresh password", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate(
      { id: "ft-1", baseUrl: "http://bot2:8080", password: "new-secret" },
      updated,
    );

    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.password).toBe("new-secret");
  });

  it("treats a trailing-slash-only difference as unchanged", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate(
      { id: "ft-1", baseUrl: "http://bot:8080/", username: "freqtrader" },
      updated,
    );

    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
  });

  it("returns not-found for an unknown instance", async () => {
    const updated: Array<UpdateCapture> = [];
    const result = await runUpdate({ id: "ft-missing", name: "x" }, updated);
    expect(result._tag).toBe("Left");
    expect(updated).toHaveLength(0);
  });
});

describe("instances.update custom color", () => {
  it("rejects a non-hex color without touching storage", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate({ id: "ft-1", color: "blue" }, updated);

    expect(result._tag).toBe("Left");
    expect(updated).toHaveLength(0);
  });

  it("normalizes a custom color to lowercase #rrggbb", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate({ id: "ft-1", color: "#AB12CD" }, updated);

    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.color).toBe("#ab12cd");
  });

  it("passes null through as clear-to-automatic", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate({ id: "ft-1", color: null }, updated);

    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.color).toBe(null);
  });

  it("keeps the stored color when color is omitted", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate({ id: "ft-1", name: "renamed" }, updated);

    expect(result._tag).toBe("Right");
    expect(updated[0]?.color).toBe(undefined);
  });

  it("does not require a password for a color-only change", async () => {
    const updated: Array<UpdateCapture> = [];

    const result = await runUpdate({ id: "ft-1", color: "#4589ff" }, updated);

    expect(result._tag).toBe("Right");
    expect(updated).toHaveLength(1);
  });
});
