// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { BackendError } from "@nfi/api-contract"

/** Map any failure inside a capability to the shared `BackendError` shape. */
export const toBackendError = (operation: string, cause: unknown): BackendError =>
  BackendError.make({
    error: `capability ${operation} failed`,
    detail: cause instanceof Error ? cause.message : String(cause),
  })

/**
 * Wrap a repo/service failure, passing explicit `BackendError` failures
 * (e.g. not-found, validation) through untouched instead of double-wrapping.
 */
export const asBackendError = (operation: string, cause: unknown): BackendError => {
  if (typeof cause === "object" && cause !== null && (cause as { _tag?: unknown })._tag === "BackendError") {
    return cause as BackendError
  }
  return toBackendError(operation, cause)
}

export const notFoundError = (scope: string, id: string): BackendError =>
  BackendError.make({ error: `${scope} not found`, detail: id })
