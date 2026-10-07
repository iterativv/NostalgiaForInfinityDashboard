// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import type { CapabilityContext } from "./definition.js";
import type { ListClosedArgs } from "@nfi/db";
import { InstancesClosedPositionsCapability } from "./instances-closed-positions.js";
import { makeTradesStub, type RecordedClosed } from "./tradesStub.js";

/**
 * The closed-positions capability must forward the table's filter state —
 * search, limit, offset — to the SQL layer verbatim (the repo tests pin the
 * matching semantics; here we pin the contract).
 */

/** Stub calls recorded for later assertions (populated inside onClosed). */
interface RecordedClosedCalls {
  closed?: RecordedClosed;
}

const stubCtx = (
  overrides: Parameters<typeof makeTradesStub>[0],
): CapabilityContext => {
  const partial: Pick<CapabilityContext, "trades"> = {
    trades: makeTradesStub(overrides).trades,
  };

  // SAFETY: deliberate test double — `instances.closed-positions` reads
  // only `trades` from the context; the missing members are never
  // dereferenced.
  return partial as CapabilityContext;
};

const searched = async (search: string | undefined, limit?: string) => {
  const recorded: RecordedClosedCalls = {};

  const ctx = stubCtx({
    onClosed: (args) => {
      recorded.closed = args;
    },
  });

  const result = await Effect.runPromise(
    InstancesClosedPositionsCapability.run(
      { id: "default", limit, search },
      ctx,
    ).pipe(Effect.either),
  );

  expect(Either.isRight(result)).toBe(true);
  // SAFETY: the stub's onClosed recorded the forwarded args before the
  // capability resolved, so the holder is populated for a Right run.
  const args = recorded.closed as ListClosedArgs;

  return {
    args,
    right: Either.isRight(result) ? result.right : undefined,
  };
};

describe("instances.closed-positions", () => {
  it("forwards search, limit and offset to the SQL layer", async () => {
    const { args, right } = await searched("roi", "25");

    expect(args).toMatchObject({
      instanceId: "default",
      search: "roi",
      limit: 25,
      offset: 0,
    });
    // Pass-through rows + the SQL COUNT as the filtered total.
    expect(right?.positions).toHaveLength(1);
    expect(right?.totalTrades).toBe(7);
  });

  it("passes an absent search as null (no WHERE clause)", async () => {
    const { args } = await searched(undefined);

    expect(args.search).toBeNull();
  });
});
