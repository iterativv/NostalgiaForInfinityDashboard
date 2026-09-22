// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Effect } from "effect";
import { LocksResponse } from "@nfi/api-contract";
import { defineCapability, IdOptions } from "./definition.js";
import { asBackendError } from "./errors.js";

/** `instances.locks` — pairs currently locked from trading on one instance. */
export const InstancesLocksCapability = defineCapability({
  name: "instances.locks",
  optionsSchema: IdOptions,
  resultSchema: LocksResponse,
  description: "Active pair locks (pairs temporarily blocked from trading).",
  streamable: true,
  pollMs: 30_000,
  exposes: ["bot-state"],
  run: (options, ctx) =>
    Effect.flatMap(ctx.resolveInstance(options.id), (service) =>
      service.getLocks(),
    ).pipe(Effect.mapError((cause) => asBackendError("instance locks", cause))),
});
