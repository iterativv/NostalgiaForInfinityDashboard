// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { RelativeBalance } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"
import { toRelativeBalance } from "./relative.js"

/**
 * `instances.balance.relative` — per-instance allocation weights (shareable).
 */
export const InstancesBalanceRelativeCapability = defineCapability({
  name: "instances.balance.relative",
  optionsSchema: IdOptions,
  resultSchema: RelativeBalance,
  description: "Per-instance allocation weights (relative, shareable).",
  streamable: true,
  pollMs: 15_000,
  exposes: ["relative-values"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      Effect.map(service.getBalance(), toRelativeBalance),
    ).pipe(Effect.mapError((cause) => asBackendError("instance balance.relative", cause))),
})
