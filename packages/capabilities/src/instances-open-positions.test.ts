// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import type { CapabilityContext } from "./definition.js";
import type { ListOpenArgs, MirrorOpenPosition } from "@nfi/db";
import { InstancesOpenPositionsCapability } from "./instances-open-positions.js";
import { makeTradesStub, type RecordedOpen } from "./tradesStub.js";

/**
 * The open-positions capability forwards the table's filter state (search,
 * sign filter, ordering, limit) to the SQL layer; matching semantics live
 * in the repo tests.
 */

/** Stub calls recorded for later assertions (populated inside onOpen). */
interface RecordedOpenCalls {
  open?: RecordedOpen;
}

const stubCtx = (
  overrides: Parameters<typeof makeTradesStub>[0],
): CapabilityContext => {
  const partial: Pick<CapabilityContext, "trades"> = {
    trades: makeTradesStub(overrides).trades,
  };

  // SAFETY: deliberate test double — `instances.open-positions` reads only
  // `trades` from the context; the missing members are never dereferenced.
  return partial as CapabilityContext;
};

const ROW: MirrorOpenPosition = {
  tradeId: 100,
  pair: "BTC/USDT",
  isOpen: true,
  amount: 1,
  stakeAmount: 100,
  openRate: 50_000,
  openDate: "2026-10-05T00:00:00Z",
  instanceId: "default",
};

describe("instances.open-positions", () => {
  it("forwards search, sign filter, ordering and limit to SQL", async () => {
    const recorded: RecordedOpenCalls = {};

    const ctx = stubCtx({
      onOpen: (args) => {
        recorded.open = args;

        return { positions: [ROW], total: 1 };
      },
    });

    const result = await Effect.runPromise(
      InstancesOpenPositionsCapability.run(
        {
          id: "default",
          search: "btc",
          filter: "gain",
          sort: "profitPct",
          dir: "asc",
          limit: "5",
        },
        ctx,
      ).pipe(Effect.either),
    );

    expect(result._tag).toBe("Right");
    // SAFETY: the stub's onOpen recorded the forwarded args before the
    // capability resolved, so the holder is populated for a Right run.
    const args = recorded.open as ListOpenArgs;

    expect(args).toMatchObject({
      instanceId: "default",
      search: "btc",
      filter: "gain",
      sort: "profitPct",
      dir: "asc",
      limit: 5,
    });
  });

  it("defaults to every open position without filters", async () => {
    const recorded: RecordedOpenCalls = {};

    const ctx = stubCtx({
      onOpen: (args) => {
        recorded.open = args;

        return { positions: [], total: 0 };
      },
    });

    await Effect.runPromise(
      InstancesOpenPositionsCapability.run({ id: "default" }, ctx),
    );

    // SAFETY: the stub's onOpen recorded the forwarded args before the
    // capability resolved, so the holder is populated for a completed run.
    const args = recorded.open as ListOpenArgs;

    expect(args.search).toBeNull();
    expect(args.filter).toBeNull();
    expect(args.sort).toBeNull();
  });
});
