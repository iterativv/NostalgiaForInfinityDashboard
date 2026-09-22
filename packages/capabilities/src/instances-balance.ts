// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect"
import { BalanceResponse } from "@nfi/api-contract"
import { defineCapability, IdOptions } from "./definition.js"
import { asBackendError } from "./errors.js"

/**
 * `instances.balance` — wallet balances for one instance (ABSOLUTE amounts).
 *
 * Never grant publicly: use `instances.balance.relative` for shareable pages.
 */
export const InstancesBalanceCapability = defineCapability({
  name: "instances.balance",
  optionsSchema: IdOptions,
  resultSchema: BalanceResponse,
  description: "Wallet balances for one instance in absolute coin amounts.",
  streamable: true,
  pollMs: 15_000,
  exposes: ["absolute-balance"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) => service.getBalance()).pipe(
      Effect.mapError((cause) => asBackendError("instance balance", cause)),
    ),
})
