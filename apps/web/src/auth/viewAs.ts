// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Either, Schema } from "effect";
import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import type { Capability } from "@nfi/api-contract";
import { capabilitiesStore } from "./capabilities";

/**
 * View-as preview — a frontend-only mock of another identity's dashboard.
 *
 * A holder of `users.list` picks a target (a user from the manage page or
 * the `anonymous` role) in the header switcher. While active:
 * - capability gating (Panel forbidden states, widget picker, palette,
 *   open guards) reads the TARGET's grant instead of the caller's own,
 * - the pages bar filters to the target's configured visible pages.
 *
 * This never impersonates server-side: REST/SSE still run as the real
 * session, so previewing a MORE privileged identity shows backend error
 * states (403) where the caller lacks the grant — exactly what the target
 * would NOT see, which the banner says. Previewing a LESS privileged
 * identity faithfully shows their forbidden widgets. The banner + header
 * highlight make the mock unmistakable; clearing returns to the real grant.
 *
 * Layout edits while previewing are staged, never autosaved: commits apply
 * to the live canvas only (no backend writes, no Home localStorage), so a
 * root arranging the public dashboard as `anonymous` cannot leak half-done
 * work to real visitors. The banner offers Save (persists the active page
 * on demand) and Discard (restores every touched page) — the only paths
 * that move preview edits anywhere durable.
 */

export interface ViewAsState {
  /** Target identity id (`anonymous`, `root`, or `usr-*`). Null = self. */
  readonly targetUserId: string | null;
  readonly targetUsername: string | null;
  /** The target's granted capabilities (from `users.list`). */
  readonly targetGranted: ReadonlyArray<Capability> | null;
}

const VIEW_AS_KEY = "nfi-view-as";

/** Shape persisted to localStorage: the identity alone (grants never stored). */
const PersistedViewAsSchema = Schema.Struct({
  targetUserId: Schema.String,
  targetUsername: Schema.NullOr(Schema.String),
});

const CLEARED: ViewAsState = {
  targetUserId: null,
  targetUsername: null,
  targetGranted: null,
};

const loadViewAs = (): ViewAsState => {
  try {
    if (typeof localStorage === "undefined") return CLEARED;

    const raw = localStorage.getItem(VIEW_AS_KEY);

    if (!raw) return CLEARED;

    const decoded = Schema.decodeUnknownEither(
      Schema.parseJson(PersistedViewAsSchema),
    )(raw);

    if (Either.isRight(decoded)) {
      // Grants refresh from users.list on boot (stored copy is stale-safe:
      // cleared below when the target vanishes); identity alone restores.
      return {
        targetUserId: decoded.right.targetUserId,
        targetUsername: decoded.right.targetUsername,
        targetGranted: null,
      };
    }
  } catch {
    // Private mode / corrupt — preview simply starts cleared.
  }

  return CLEARED;
};

export const viewAsStore = new Store<ViewAsState>(loadViewAs());

viewAsStore.subscribe((state) => {
  try {
    if (typeof localStorage === "undefined") return;

    if (state.targetUserId) {
      localStorage.setItem(
        VIEW_AS_KEY,
        JSON.stringify({
          targetUserId: state.targetUserId,
          targetUsername: state.targetUsername,
        }),
      );
    } else {
      localStorage.removeItem(VIEW_AS_KEY);
    }
  } catch {
    // Best-effort persistence only.
  }
});

/** True while previewing another identity's dashboard. */
export function isViewAsActive(): boolean {
  return viewAsStore.state.targetUserId !== null;
}

/** Grant the UI gates against: target's while previewing, else the caller's. */
export function effectiveGranted(): ReadonlyArray<Capability> {
  const viewAs = viewAsStore.state;

  if (viewAs.targetUserId !== null && viewAs.targetGranted !== null) {
    return viewAs.targetGranted;
  }

  return capabilitiesStore.state.granted;
}

export function useEffectiveGranted(): ReadonlyArray<Capability> {
  const target = useStore(viewAsStore, (s) => s.targetGranted);
  const targetId = useStore(viewAsStore, (s) => s.targetUserId);
  const granted = useStore(capabilitiesStore, (s) => s.granted);

  if (targetId !== null && target !== null) return target;

  return granted;
}

export function setViewAs(
  targetUserId: string,
  targetUsername: string | null,
  targetGranted: ReadonlyArray<Capability>,
): void {
  viewAsStore.setState(() => ({
    targetUserId,
    targetUsername,
    targetGranted: [...targetGranted],
  }));
}

export function clearViewAs(): void {
  viewAsStore.setState(() => ({
    targetUserId: null,
    targetUsername: null,
    targetGranted: null,
  }));
}

export function useViewAs(): ViewAsState {
  return useStore(viewAsStore, (s) => s);
}
