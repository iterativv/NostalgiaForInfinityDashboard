// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import type { SettingsRepoService } from "@nfi/db";
import { SystemPageDefaultsCapability } from "./system-page-defaults.js";
import { SystemPageDefaultsUpdateCapability } from "./system-page-defaults-update.js";
import type { CapabilityContext, Principal } from "./definition.js";

/**
 * `system.page-defaults` + `system.page-defaults.update`: scoped reads,
 * global + per-user patches, anonymous refusal. Runs the capability `run`
 * directly with a stub settings repo — the HTTP choke point is exercised in
 * the server app.
 */

const makeSettings = (initial?: string | null): SettingsRepoService & { saved: string | null } => {
  let stored = initial ?? null;

  const repo: SettingsRepoService & { saved: string | null } = {
    saved: null,
    getSetting: () => Effect.succeed(stored),
    saveSetting: (_key: string, value: string) => {
      stored = value;
      repo.saved = value;

      return Effect.succeed(undefined);
    },
  };

  return repo;
};

// SAFETY: partial context on purpose — the page-defaults capabilities read
// only `principal` and `settings`; the missing freqtrade services are never
// reached in these code paths.
const makeContext = (
  principal: Principal,
  settings: SettingsRepoService,
): CapabilityContext => ({ principal, settings }) as CapabilityContext;

const root: Principal = {
  kind: "user",
  userId: "root",
  username: "admin",
  role: "root",
  granted: [],
};

const user: Principal = {
  kind: "user",
  userId: "usr-1",
  username: "trader",
  role: "user",
  granted: ["system.page-defaults.update"],
};

const anonymous: Principal = { kind: "anonymous", granted: [] };

const run = <A, E>(effect: Effect.Effect<A, E>): Either.Either<A, E> =>
  Effect.runSync(Effect.either(effect));

describe("system.page-defaults read", () => {
  it("resolves the caller when no user id is given", () => {
    const outcome = run(
      SystemPageDefaultsCapability.run({}, makeContext(user, makeSettings())),
    );

    expect(Either.isRight(outcome)).toBe(true);

    if (Either.isRight(outcome)) {
      expect(outcome.right.userId).toBe("usr-1");
      expect(outcome.right.globalDefaultPageId).toBeNull();
      expect(outcome.right.defaults).toBeNull();
    }
  });

  it("resolves anonymous for visitors", () => {
    const outcome = run(
      SystemPageDefaultsCapability.run({}, makeContext(anonymous, makeSettings())),
    );

    expect(Either.isRight(outcome)).toBe(true);

    if (Either.isRight(outcome)) expect(outcome.right.userId).toBe("anonymous");
  });

  it("returns the stored override for the requested identity", () => {
    const stored = JSON.stringify({
      globalDefaultPageId: "page-overview",
      perUser: {
        anonymous: {
          defaultPageId: "page-public",
          visiblePageIds: ["page-public"],
          defaultPanels: { "page-public": "page-public-panel-0" },
        },
      },
    });

    const outcome = run(
      SystemPageDefaultsCapability.run(
        { userId: "anonymous" },
        makeContext(root, makeSettings(stored)),
      ),
    );

    expect(Either.isRight(outcome)).toBe(true);

    if (Either.isRight(outcome)) {
      expect(outcome.right.globalDefaultPageId).toBe("page-overview");
      expect(outcome.right.defaults?.defaultPageId).toBe("page-public");
      expect(outcome.right.defaults?.visiblePageIds).toEqual(["page-public"]);
    }
  });

  it("falls back to empty on a corrupt row", () => {
    const outcome = run(
      SystemPageDefaultsCapability.run({}, makeContext(user, makeSettings("{nope"))),
    );

    expect(Either.isRight(outcome)).toBe(true);

    if (Either.isRight(outcome)) {
      expect(outcome.right.globalDefaultPageId).toBeNull();
      expect(outcome.right.defaults).toBeNull();
    }
  });
});

describe("system.page-defaults.update", () => {
  it("refuses anonymous callers outright", () => {
    const outcome = run(
      SystemPageDefaultsUpdateCapability.run(
        { globalDefaultPageId: "page-overview" },
        makeContext(anonymous, makeSettings()),
      ),
    );

    expect(Either.isLeft(outcome)).toBe(true);
  });

  it("patches the global landing page and reads it back", () => {
    const settings = makeSettings();

    const updated = run(
      SystemPageDefaultsUpdateCapability.run(
        { globalDefaultPageId: "page-trading" },
        makeContext(root, settings),
      ),
    );

    expect(Either.isRight(updated)).toBe(true);

    if (Either.isRight(updated)) {
      expect(updated.right.globalDefaultPageId).toBe("page-trading");
    }

    const read = run(
      SystemPageDefaultsCapability.run({}, makeContext(user, settings)),
    );

    expect(Either.isRight(read)).toBe(true);

    if (Either.isRight(read)) expect(read.right.globalDefaultPageId).toBe("page-trading");
  });

  it("sets and clears a per-user override without touching the global", () => {
    const settings = makeSettings();
    const ctx = makeContext(user, settings);

    const set = run(
      SystemPageDefaultsUpdateCapability.run(
        {
          userId: "anonymous",
          defaults: {
            defaultPageId: "page-public",
            visiblePageIds: ["page-public", "page-home"],
            defaultPanels: {},
          },
        },
        ctx,
      ),
    );

    expect(Either.isRight(set)).toBe(true);

    if (Either.isRight(set)) {
      expect(set.right.userId).toBe("anonymous");
      expect(set.right.defaults?.defaultPageId).toBe("page-public");
      expect(set.right.globalDefaultPageId).toBeNull();
    }

    const cleared = run(
      SystemPageDefaultsUpdateCapability.run(
        { userId: "anonymous", defaults: null },
        ctx,
      ),
    );

    expect(Either.isRight(cleared)).toBe(true);

    if (Either.isRight(cleared)) expect(cleared.right.defaults).toBeNull();
  });

  it("rejects an empty user id", () => {
    const outcome = run(
      SystemPageDefaultsUpdateCapability.run(
        { userId: "  ", defaults: null },
        makeContext(root, makeSettings()),
      ),
    );

    expect(Either.isLeft(outcome)).toBe(true);
  });
});
