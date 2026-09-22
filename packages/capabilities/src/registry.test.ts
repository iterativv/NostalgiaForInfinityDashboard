// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import {
  ALL_CAPABILITIES,
  DEFAULT_SENSITIVE_INFO_KINDS,
  NON_SENSITIVE_CAPABILITIES,
} from "@nfi/api-contract";
import {
  ALL_CAPABILITY_NAMES,
  CAPABILITY_REGISTRY,
  capabilityKey,
  decodeCapabilityOptions,
  encodeStreamOptions,
  isCapabilityName,
  parseStreamRequest,
  streamPath,
  type CapabilityName,
} from "./registry.js";
import {
  isCapabilitySensitive,
  isCapabilitySensitiveByDefault,
  isNonSensitiveCapabilities,
  nonSensitiveCapabilityNames,
} from "./sensitivity.js";
import { Effect } from "effect";

describe("capability registry (hard-coded, type-safe)", () => {
  it("covers the wire vocabulary exactly (56 capabilities)", () => {
    expect(ALL_CAPABILITY_NAMES).toHaveLength(56);
    expect(new Set(ALL_CAPABILITY_NAMES)).toEqual(new Set(ALL_CAPABILITIES));
    for (const [key, def] of Object.entries(CAPABILITY_REGISTRY)) {
      expect(def.name, `definition file for ${key}`).toBe(key);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("declares exposed information kinds for every capability", () => {
    for (const name of ALL_CAPABILITY_NAMES) {
      const def = CAPABILITY_REGISTRY[name];
      expect(def.exposes.length, `${name} exposes nothing`).toBeGreaterThan(0);
      for (const kind of def.exposes) {
        expect(
          typeof kind === "string" && kind.length > 0,
          `${name} exposes invalid kind ${String(kind)}`,
        ).toBe(true);
      }
    }
    // Relative mirrors are the only capabilities exposing relative values —
    // and they expose nothing else.
    for (const name of ALL_CAPABILITY_NAMES) {
      if (name.endsWith(".relative")) {
        expect(CAPABILITY_REGISTRY[name]?.exposes, name).toEqual([
          "relative-values",
        ]);
      }
    }
    // Spot-checks for the leaky kinds the default criteria rely on.
    const spot = {
      "bot.config": ["strategy-config", "stake-amount"],
      "instances.config": ["strategy-config", "stake-amount"],
      "instances.list": ["infra-location"],
      "system.backend-config": ["infra-location"],
      "users.list": ["user-accounts"],
      "workspace.list": ["user-workspaces"],
      "auth.capabilities": ["session-identity"],
      "instances.candles": ["market-data"],
      "instances.status": ["bot-state"],
    } as const;
    for (const [name, kinds] of Object.entries(spot)) {
      expect(
        CAPABILITY_REGISTRY[name as CapabilityName]?.exposes,
        name,
      ).toEqual([...kinds]);
    }
  });

  it("keeps the anonymous seed non-sensitive under the default criteria", () => {
    const all = new Set(ALL_CAPABILITY_NAMES);
    for (const cap of NON_SENSITIVE_CAPABILITIES) {
      expect(all.has(cap), `${cap} not registered`).toBe(true);
      expect(
        isCapabilitySensitiveByDefault(cap),
        `${cap} is sensitive under default criteria`,
      ).toBe(false);
    }
  });

  it("keeps amount- or location-carrying capabilities sensitive by default", () => {
    // The default policy, enforced mechanically: any information that can
    // lead another user to derive absolute balances, absolute PnL, stake
    // amounts or user location is sensitive by default. We walk every
    // result schema's AST and flag fields shaped like amounts
    // (balance/stake/profit-absolute/cost/fee/...) or locations
    // (url/host). A capability whose result carries any such field must
    // expose at least one default-sensitive kind — so a future capability
    // cannot ship as "non-sensitive" while returning absolute figures.
    const amountish = (field: string): boolean => {
      const s = field.toLowerCase();
      // Non-amount numerics: shares/percentages, indices, counts, rates,
      // market prices/volumes, currency NAMES, timings, identifiers.
      if (
        /weight|pct|percent|rel|index|winrate|count|trades|rate|price|volume|currency|duration|timestamp|time|leverage|nr|id$|^id|length|version/.test(
          s,
        )
      ) {
        return false;
      }
      return /stake|balance|amount|free|used|total|capital|fiat|profit|cost|fee|liquidat|funding|abs/.test(
        s,
      );
    };
    const locationish = (field: string): boolean => /url|host/i.test(field);

    const collect = (ast: unknown, into: Set<string>): void => {
      if (!ast || typeof ast !== "object") return;
      const node = ast as {
        _tag?: string;
        propertySignatures?: ReadonlyArray<{ name: unknown; type: unknown }>;
        from?: unknown;
        to?: unknown;
        members?: ReadonlyArray<unknown>;
        elements?: ReadonlyArray<{ type: unknown }>;
        rest?: ReadonlyArray<unknown>;
      };
      switch (node._tag) {
        case "TypeLiteral":
          for (const ps of node.propertySignatures ?? []) {
            const name = String(ps.name);
            if (amountish(name) || locationish(name)) into.add(name);
            collect(ps.type, into);
          }
          return;
        case "Refinement":
          collect(node.from, into);
          return;
        case "Transformation":
          collect(node.from, into);
          collect(node.to, into);
          return;
        case "Union":
          for (const member of node.members ?? []) collect(member, into);
          return;
        case "TupleType":
          // `elements`/`rest` entries are descriptors ({ type, annotations }),
          // not AST nodes — unwrap before recursing.
          for (const element of node.elements ?? [])
            collect(element.type, into);
          for (const rest of node.rest ?? [])
            collect((rest as { type?: unknown }).type ?? rest, into);
          return;
        default:
          return;
      }
    };

    let checked = 0;
    for (const name of ALL_CAPABILITY_NAMES) {
      const def = CAPABILITY_REGISTRY[name];
      const flagged = new Set<string>();
      collect((def.resultSchema as { ast: unknown }).ast, flagged);
      if (flagged.size === 0) continue;
      checked += 1;
      expect(
        isCapabilitySensitiveByDefault(name),
        `${name} returns amount/location-shaped fields [${[...flagged].join(", ")}] yet is non-sensitive by default`,
      ).toBe(true);
    }
    // Sanity: the walk actually flagged the amount-carrying surface
    // (balances, profits, trades, configs, histories, fleet views,
    // instance URLs) — not just a handful of flat DTOs.
    expect(checked).toBeGreaterThanOrEqual(20);
  });

  it("only polls on the backend for streamable capabilities", () => {
    for (const name of ALL_CAPABILITY_NAMES) {
      const def = CAPABILITY_REGISTRY[name];
      expect(def.pollMs, name).toBeGreaterThan(0);
    }
    expect(CAPABILITY_REGISTRY["system.health"]?.streamable).toBe(true);
    expect(CAPABILITY_REGISTRY["system.backend-config"]?.streamable).toBe(
      false,
    );
    expect(CAPABILITY_REGISTRY["workspace.save"]?.streamable).toBe(false);
  });

  it("rejects unhardened capability strings", () => {
    expect(isCapabilityName("bot.balance")).toBe(true);
    expect(isCapabilityName("bot.balance.relative")).toBe(true);
    expect(isCapabilityName("bot:read")).toBe(false);
    expect(isCapabilityName("Bot.balance")).toBe(false);
    expect(isCapabilityName("")).toBe(false);
    expect(isCapabilityName(undefined)).toBe(false);
    expect(isCapabilityName("bot.balance;DROP")).toBe(false);
  });

  it("decodes options strictly per capability", () => {
    expect(decodeCapabilityOptions("bot.balance", {})).toEqual({});
    expect(
      decodeCapabilityOptions("instances.candles", {
        id: "a",
        pair: "BTC/USDT",
      }),
    ).toEqual({
      id: "a",
      pair: "BTC/USDT",
    });
    expect(() =>
      decodeCapabilityOptions("instances.candles", { id: "a" }),
    ).toThrow();
    expect(() =>
      decodeCapabilityOptions("bot.balance", { unexpected: 1 }),
    ).not.toThrow();
  });

  it("builds stable subscription keys independent of option order", () => {
    const a = capabilityKey("instances.candles", {
      id: "x",
      pair: "BTC/USDT",
      timeframe: "5m",
    });
    const b = capabilityKey("instances.candles", {
      timeframe: "5m",
      pair: "BTC/USDT",
      id: "x",
    });
    expect(a).toBe(b);
    expect(
      capabilityKey("instances.candles", { id: "y", pair: "BTC/USDT" }),
    ).not.toBe(a);
    expect(capabilityKey("bot.balance", {})).toBe("bot.balance:{}");
  });

  it("round-trips stream subscription addressing", async () => {
    const path = streamPath("instances.closed-positions", {
      id: "ft-1",
      limit: "50",
    });
    expect(path.startsWith("/api/stream?capability=")).toBe(true);
    const url = new URL(path, "http://localhost");
    const parsed = await Effect.runPromise(
      parseStreamRequest(
        url.searchParams.get("capability") ?? undefined,
        url.searchParams.get("options") ?? undefined,
      ),
    );
    expect(parsed.name).toBe("instances.closed-positions");
    expect(parsed.options).toEqual({ id: "ft-1", limit: "50" });
    expect(encodeStreamOptions({})).not.toContain("+");
    await expect(
      Effect.runPromise(parseStreamRequest("nope", undefined)),
    ).rejects.toThrow();
    await expect(
      Effect.runPromise(parseStreamRequest("bot.balance", "!!!")),
    ).rejects.toThrow();
  });
});

describe("adjustable sensitivity criteria", () => {
  it("derives sensitivity from the configured kinds, not hard-coded tags", () => {
    // Defaults: amounts, config, infra and user data are sensitive.
    expect(isCapabilitySensitiveByDefault("bot.balance")).toBe(true);
    expect(isCapabilitySensitiveByDefault("bot.profit.relative")).toBe(false);
    expect(isCapabilitySensitiveByDefault("instances.list")).toBe(true);

    // Root unchecks stake amounts and strategy config -> config summaries
    // stop being sensitive, balances still are.
    const relaxed = DEFAULT_SENSITIVE_INFO_KINDS.filter(
      (kind) => kind !== "stake-amount" && kind !== "strategy-config",
    );
    expect(isCapabilitySensitive("bot.config", relaxed)).toBe(false);
    expect(isCapabilitySensitive("bot.balance", relaxed)).toBe(true);

    // Root checks market data -> candles become sensitive.
    expect(
      isCapabilitySensitive("instances.candles", [
        ...DEFAULT_SENSITIVE_INFO_KINDS,
        "market-data",
      ]),
    ).toBe(true);
  });

  it("marks a capability list non-sensitive iff every member is", () => {
    expect(isNonSensitiveCapabilities([], DEFAULT_SENSITIVE_INFO_KINDS)).toBe(
      true,
    );
    expect(
      isNonSensitiveCapabilities(
        ["instances.profit.relative", "instances.candles"],
        DEFAULT_SENSITIVE_INFO_KINDS,
      ),
    ).toBe(true);
    expect(
      isNonSensitiveCapabilities(
        ["instances.profit.relative", "instances.profit"],
        DEFAULT_SENSITIVE_INFO_KINDS,
      ),
    ).toBe(false);
  });

  it("derives the non-sensitive-by-default capability set", () => {
    const derived = nonSensitiveCapabilityNames();
    // The anonymous seed is a subset of the derived set...
    for (const cap of NON_SENSITIVE_CAPABILITIES) {
      expect(derived).toContain(cap);
    }
    // ...and the derived set never contains an amount/infra/user leak.
    for (const name of derived) {
      expect(isCapabilitySensitiveByDefault(name), name).toBe(false);
    }
    expect(derived).toContain("instances.health");
    expect(derived).not.toContain("bot.balance");
  });
});
