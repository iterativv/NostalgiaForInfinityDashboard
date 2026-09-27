// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Schema } from "effect";
import { BackendError } from "@nfi/api-contract";

const isBackendError = Schema.is(BackendError);

/** Map any failure inside a capability to the shared `BackendError` shape. */
export const toBackendError = (
  operation: string,
  cause: unknown,
): BackendError =>
  BackendError.make({
    error: `capability ${operation} failed`,
    detail: cause instanceof Error ? cause.message : String(cause),
  });

/**
 * Wrap a repo/service failure, passing explicit `BackendError` failures
 * (e.g. not-found, validation) through untouched instead of double-wrapping.
 */
export const asBackendError = (
  operation: string,
  cause: unknown,
): BackendError =>
  isBackendError(cause) ? cause : toBackendError(operation, cause);

export const notFoundError = (scope: string, id: string): BackendError =>
  BackendError.make({ error: `${scope} not found`, detail: id });
