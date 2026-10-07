// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import type { LayoutDocument } from "@danfessler/trellis-react";

/**
 * Pending-slot channels between the widget picker and the Trellis bridge.
 *
 * Lived in `TrellisPresets` until the preset applier needed to touch the
 * workspace store (`setWorkspaceStacked`) — store.ts already imports
 * `clearPendingSlotLayout`, so keeping these here would have made that
 * import circular. They are picker/bridge plumbing, not preset logic.
 *
 * Two independent one-shot stores:
 * - slot TARGET: an empty pane's Add button arms (view + panel) as the
 *   landing zone for the next picked widget;
 * - slot LAYOUT: a preset picked on an EMPTY page stages the slot grid for
 *   TrellisWorkspace to mount with.
 */

/**
 * Pending slot target for the widget picker: set when an empty pane's Add
 * button opens the picker, consumed by the Trellis bridge when the picked
 * widget's panel opens (placed INTO the slot's panel, slot placeholder
 * closed by its VIEW id), cleared when the picker closes without a pick.
 * Read-only in the bridge — only the pick/cancel paths clear it, so a
 * pending target can never hijack an unrelated later add.
 *
 * Both ids are kept: `panelId` is the `into` placement target, `viewId` is
 * the exact placeholder view to retire. Matching by panel alone left the
 * empty pane as a second tab when the lookup missed — closing by view id
 * cannot miss.
 */
export interface PendingSlotTarget {
  readonly viewId: string;
  readonly panelId: string;
}

const slotTargetStore = new Store<PendingSlotTarget | null>(null);

export const setPendingSlotTarget = (target: PendingSlotTarget): void => {
  slotTargetStore.setState(() => target);
};

export const clearPendingSlotTarget = (): void => {
  slotTargetStore.setState(() => null);
};

export const takePendingSlotTarget = (): PendingSlotTarget | null => {
  const target = slotTargetStore.state;
  slotTargetStore.setState(() => null);

  return target;
};

/** Read-only peek for the bridge (consumption clears via `take`). */
export const peekPendingSlotTarget = (): PendingSlotTarget | null =>
  slotTargetStore.state;

/**
 * A preset picked on an EMPTY page (no workspace mounted to `setDocument`
 * into). TrellisWorkspace consumes it on its next render by mounting with
 * it as `defaultLayout`, after dropping any stale persisted doc that would
 * otherwise win. Scoped per page; cleared on first widget open and on
 * layout reset, so it can never resurrect where it wasn't picked.
 */
export interface PendingSlotLayout {
  readonly pageId: string;
  readonly doc: LayoutDocument;
}

const pendingLayoutStore = new Store<PendingSlotLayout | null>(null);

export const clearPendingSlotLayout = (): void => {
  pendingLayoutStore.setState(() => null);
};

/** Reactive read for TrellisWorkspace (mounts the pending grid). */
export function usePendingSlotLayout(): PendingSlotLayout | null {
  return useStore(pendingLayoutStore, (s) => s);
}

/** Write access for the preset applier (`applyPresetToEmptyPage`). */
export const stagePendingSlotLayout = (layout: PendingSlotLayout): void => {
  pendingLayoutStore.setState(() => layout);
};
