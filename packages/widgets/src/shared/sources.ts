// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Per-instance vs fleet data sources.
 *
 * Widgets whose `instanceId` is `"all"` subscribe to the fleet aggregate
 * capabilities (`instances.positions-all` / `instances.closed-all`, one
 * server-side fan-out over every configured instance); any other id
 * subscribes to the per-instance capability. Rows are normalized to carry
 * optional `instanceId`/`instanceName` tags so fleet views can attribute
 * rows while single-instance views stay unchanged.
 */

import type {
  ClosedPosition,
  FleetClosedPositionsResponse,
  FleetOpenPositionsResponse,
  OpenPosition,
} from "@nfi/api-contract";
import { useCapability } from "../live/live";
import { ALL_INSTANCES } from "./InstanceSelect";

/** A position row, tagged with its source instance on fleet views. */
export type SourcedOpenPosition = OpenPosition & {
  readonly instanceId?: string;
  readonly instanceName?: string;
};

/** A closed-position row, tagged with its source instance on fleet views. */
export type SourcedClosedPosition = ClosedPosition & {
  readonly instanceId?: string;
  readonly instanceName?: string;
};

export interface SourceResult<T> {
  readonly data: T | undefined;
  readonly error: string | null;
  readonly isLoading: boolean;
}

/** Open positions for one instance or the whole fleet (`instanceId === "all"`). */
export function useOpenPositionsSource(
  instanceId: string,
  opts?: { enabled?: boolean },
): SourceResult<ReadonlyArray<SourcedOpenPosition>> {
  const enabled = opts?.enabled ?? true;
  const fleet = instanceId === ALL_INSTANCES;
  const perInstanceView = useCapability(
    "instances.open-positions",
    { id: fleet ? "default" : instanceId },
    { enabled: enabled && !fleet },
  );
  const fleetView = useCapability(
    "instances.positions-all",
    {},
    { enabled: enabled && fleet },
  );
  if (!enabled) return { data: undefined, error: null, isLoading: false };
  if (fleet) {
    return {
      data: fleetView.data
        ? (fleetView.data as FleetOpenPositionsResponse).positions.map(tagged)
        : undefined,
      error: fleetView.error,
      isLoading: fleetView.isLoading,
    };
  }
  return {
    data: perInstanceView.data ? perInstanceView.data.positions : undefined,
    error: perInstanceView.error,
    isLoading: perInstanceView.isLoading,
  };
}

/** Recent closed positions for one instance or the whole fleet. */
export function useClosedPositionsSource(
  instanceId: string,
  limit: number,
  opts?: { enabled?: boolean },
): SourceResult<ReadonlyArray<SourcedClosedPosition>> {
  const enabled = opts?.enabled ?? true;
  const fleet = instanceId === ALL_INSTANCES;
  const perInstanceView = useCapability(
    "instances.closed-positions",
    { id: fleet ? "default" : instanceId, limit: String(limit) },
    { enabled: enabled && !fleet },
  );
  const fleetView = useCapability(
    "instances.closed-all",
    { limit: String(limit) },
    { enabled: enabled && fleet },
  );
  if (!enabled) return { data: undefined, error: null, isLoading: false };
  if (fleet) {
    return {
      data: fleetView.data
        ? (fleetView.data as FleetClosedPositionsResponse).positions.map(tagged)
        : undefined,
      error: fleetView.error,
      isLoading: fleetView.isLoading,
    };
  }
  return {
    data: perInstanceView.data ? perInstanceView.data.positions : undefined,
    error: perInstanceView.error,
    isLoading: perInstanceView.isLoading,
  };
}

/**
 * True when the caller may read *both* the per-instance capability and its
 * fleet aggregate (widgets list all capabilities they can switch between).
 */
export const sourceCapabilities = (
  perInstance: string,
  fleet: string,
): ReadonlyArray<string> => [perInstance, fleet];

const tagged = <T>(row: T): T => row;
