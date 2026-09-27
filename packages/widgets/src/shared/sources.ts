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

import type { ClosedPosition, OpenPosition } from "@nfi/api-contract";
import { useDerived } from "@nfi/ui";
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
  /**
   * Full-history size behind the window when the backend reports it
   * (closed trades on record; the fleet variant sums instances) — drives
   * the tables' load-more affordance.
   */
  readonly total: number | undefined;
}

/**
 * Open positions for one instance or the whole fleet
 * (`instanceId === "all"`). `search` is applied server-side, before any
 * slicing, so matches outside the fetched window still surface.
 */
export function useOpenPositionsSource(
  instanceId: string,
  opts?: { enabled?: boolean; search?: string },
): SourceResult<ReadonlyArray<SourcedOpenPosition>> {
  const enabled = opts?.enabled ?? true;
  const search = opts?.search?.trim() || undefined;
  const fleet = instanceId === ALL_INSTANCES;

  const perInstanceView = useCapability(
    "instances.open-positions",
    { id: fleet ? "default" : instanceId, search },
    { enabled: enabled && !fleet },
  );

  const fleetView = useCapability(
    "instances.positions-all",
    { search },
    { enabled: enabled && fleet },
  );

  // Stable identity: the fleet `.map(tagged)` allocated a fresh array
  // every render, defeating every downstream derivation (reference equality
  // is all store selectors compare by). Derive through a store keyed on the
  // liveStore payload identity so re-renders from resize/store ticks reuse
  // the same array reference; only a real SSE frame recomputes.
  const fleetPositions = fleetView.data;
  const perPositions = perInstanceView.data;

  const fleetMapped = useDerived(
    fleetPositions,
    (payload) => (payload ? payload.positions.map(tagged) : undefined),
  );

  if (!enabled)
    return { data: undefined, error: null, isLoading: false, total: undefined };

  if (fleet) {
    return {
      data: fleetMapped,
      error: fleetView.error,
      isLoading: fleetView.isLoading,
      // Open positions are complete by construction — no windowed total.
      total: undefined,
    };
  }

  return {
    data: perPositions ? perPositions.positions : undefined,
    error: perInstanceView.error,
    isLoading: perInstanceView.isLoading,
    total: undefined,
  };
}

/**
 * Recent closed positions for one instance or the whole fleet. `search` is
 * applied server-side, before the limit window is sliced, so matches beyond
 * the fetched page still surface.
 */
export function useClosedPositionsSource(
  instanceId: string,
  limit: number,
  opts?: { enabled?: boolean; search?: string },
): SourceResult<ReadonlyArray<SourcedClosedPosition>> {
  const enabled = opts?.enabled ?? true;
  const search = opts?.search?.trim() || undefined;
  const fleet = instanceId === ALL_INSTANCES;

  const perInstanceView = useCapability(
    "instances.closed-positions",
    { id: fleet ? "default" : instanceId, limit: String(limit), search },
    { enabled: enabled && !fleet },
  );

  const fleetView = useCapability(
    "instances.closed-all",
    { limit: String(limit), search },
    { enabled: enabled && fleet },
  );

  // Same stable-identity derivation as the open-positions source above.
  const fleetClosed = fleetView.data;
  const perClosed = perInstanceView.data;

  const fleetClosedMapped = useDerived(
    fleetClosed,
    (payload) => (payload ? payload.positions.map(tagged) : undefined),
  );

  if (!enabled)
    return { data: undefined, error: null, isLoading: false, total: undefined };

  if (fleet) {
    return {
      data: fleetClosedMapped,
      error: fleetView.error,
      isLoading: fleetView.isLoading,
      total: fleetClosed?.totalTrades,
    };
  }

  return {
    data: perClosed ? perClosed.positions : undefined,
    error: perInstanceView.error,
    isLoading: perInstanceView.isLoading,
    total: perClosed?.totalTrades,
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
