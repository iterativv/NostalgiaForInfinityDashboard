// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Trellis grid presets — fixed slot grids with live card-stack previews.
 *
 * Why this exists: the compiled Trellis layout is a single column, so its
 * dividers only drag up/down (vertical resize). Trellis dividers already
 * work on both axes — a row split's divider drags left/right — but nothing
 * puts panels side by side out of the box. These presets do: each one lays
 * out a FIXED grid of pane slots (e.g. side-by-side always makes two),
 * fills them with the current views in order, and leaves the leftovers as
 * EMPTY slots — dashed panes with an Add-widget affordance that opens the
 * picker targeted at that exact slot. That is how a new pane lands on a
 * row. Once a row split exists both divider orientations are live, so
 * panels resize vertically AND horizontally.
 *
 * Every preset carries a card-stack preview: the dialog renders the exact
 * cell arrangement the preset produces for the live view count — filled
 * cells as mini cards (offset ghost layers + tab counts for stacks),
 * empty cells dashed — so what you click is what the grid becomes.
 */

import type { CSSProperties } from "react";
import { Modal } from "@carbon/react";
import { Grid } from "@carbon/icons-react";
import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import {
  createDocument,
  layout,
  useView,
  useViewTitle,
  type LayoutDocument,
  type LayoutSpec,
  type ViewInfo,
  type WorkspaceHandle,
} from "@danfessler/trellis-react";
import { useLocalStore, useStoreEffect } from "@nfi/ui";
import { requestConfirm } from "@nfi/widgets";
import { capabilitiesStore } from "../auth/capabilities";
import { EmptyPane } from "./EmptyPane";

/** One view as the presets see it (subset of Trellis `ViewInfo`). */
export interface PresetView {
  readonly id: string;
  readonly type: string;
  readonly params: object;
  readonly title: string;
  readonly selected: boolean;
}

/** Views sharing a tab group — presets never split a stack across cells. */
export interface ViewGroup {
  readonly views: PresetView[];
}

/**
 * Stage widget views grouped by tab panel, first-seen order. Slot
 * placeholders and floating/hidden views are excluded — presets rearrange
 * real panels; slots are rebuilt by the preset itself and floating/hidden
 * views must never be moved or resurrected.
 */
export function groupStageViews(views: ReadonlyArray<ViewInfo>): ViewGroup[] {
  const groups: PresetView[][] = [];
  const byPanel = new Map<string, PresetView[]>();

  for (const view of views) {
    if (view.type !== "widget") continue;

    if (view.placement !== "docked" && view.placement !== "stage") continue;

    const item: PresetView = {
      id: view.id,
      type: view.type,
      params: view.params,
      title: view.title,
      selected: view.selected,
    };

    const existing = byPanel.get(view.panelId);

    if (existing) {
      existing.push(item);
    } else {
      const list = [item];
      byPanel.set(view.panelId, list);
      groups.push(list);
    }
  }

  return groups.map((viewList) => ({ views: viewList }));
}

/**
 * Intermediate preset tree — the single source of truth both the Trellis
 * spec compiler and the miniature preview render from, so the preview can
 * never drift from the applied layout. A cell with zero groups is an
 * EMPTY slot (fillable placeholder); a cell with several groups merges
 * them as tabs.
 */
export type PresetNode =
  | { kind: "row"; children: PresetNode[]; weights?: number[] }
  | { kind: "column"; children: PresetNode[]; weights?: number[] }
  | { kind: "cell"; groups: ViewGroup[] };

/** Preview twin of `PresetNode`: cells carry live tab counts, not views. */
export type PreviewNode =
  | { kind: "row"; children: PreviewNode[]; weights?: number[] }
  | { kind: "column"; children: PreviewNode[]; weights?: number[] }
  | { kind: "cell"; tabs: number };

const cellOf = (groups: ViewGroup[]): PresetNode => ({ kind: "cell", groups });

const emptyCell = (): PresetNode => ({ kind: "cell", groups: [] });

const tabsOf = (groups: ViewGroup[]): number =>
  groups.reduce((sum, g) => sum + g.views.length, 0);

/**
 * Groups → exactly `slotCount` cells. Fewer groups than slots pads the
 * tail with EMPTY (fillable) slots; more groups than slots keeps the first
 * `slotCount - 1` intact and merges the rest as tabs into the last cell —
 * fixed shapes stay fixed, and the preview always says so.
 */
export function distributeSlots(
  groups: ViewGroup[],
  slotCount: number,
): ViewGroup[][] {
  if (slotCount <= 0) return [];

  if (groups.length >= slotCount) {
    const cells = groups
      .slice(0, slotCount - 1)
      .map((g): ViewGroup[] => [g]);

    cells.push(groups.slice(slotCount - 1));

    return cells;
  }

  return [
    ...groups.map((g): ViewGroup[] => [g]),
    ...Array.from({ length: slotCount - groups.length }, (): ViewGroup[] => []),
  ];
}

export interface GridPreset {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  /** Popover grouping ("Split", "Grids", "Focus", "Stack"). */
  readonly section: string;
  /** Minimum stage groups before the preset makes sense (else disabled). */
  readonly minGroups: number;
  readonly arrange: (groups: ViewGroup[]) => PresetNode;
}

/**
 * Fixed `cols × rows` slot grid (row-major). The workhorse behind every
 * wall/desk preset: groups fill left-to-right, top-to-bottom, leftovers
 * pad as empties, overflow merges as tabs into the last cell.
 */
function gridPreset(
  id: string,
  name: string,
  hint: string,
  section: string,
  cols: number,
  rows: number,
): GridPreset {
  return {
    id,
    name,
    hint,
    section,
    minGroups: 1,
    arrange: (groups) => {
      const cells = distributeSlots(groups, cols * rows);

      const rowOf = (row: ViewGroup[][]): PresetNode => ({
        kind: "row",
        children: row.map((cell) => cellOf(cell)),
      });

      if (rows <= 1) return rowOf(cells);

      const rowChunks: ViewGroup[][][] = [];

      for (let r = 0; r < rows; r++) {
        rowChunks.push(cells.slice(r * cols, (r + 1) * cols));
      }

      return {
        kind: "column",
        children: rowChunks.map(rowOf),
      };
    },
  };
}

export const GRID_PRESETS: ReadonlyArray<GridPreset> = [
  {
    id: "stack",
    name: "Stack",
    hint: "One column — today's default shape",
    section: "Split",
    minGroups: 1,
    arrange: (groups) => ({
      kind: "column",
      children: groups.map((g) => cellOf([g])),
    }),
  },
  gridPreset(
    "side-by-side",
    "Side by side",
    "Two slots — empties stay fillable",
    "Split",
    2,
    1,
  ),
  {
    id: "split-vertical",
    name: "Split vertical",
    hint: "Two slots stacked — the column twin of side by side",
    section: "Split",
    minGroups: 1,
    arrange: (groups) => ({
      kind: "column",
      children: distributeSlots(groups, 2).map((cell) => cellOf(cell)),
    }),
  },
  {
    id: "triple-stack",
    name: "Triple stack",
    hint: "Three slots stacked in one column",
    section: "Split",
    minGroups: 1,
    arrange: (groups) => ({
      kind: "column",
      children: distributeSlots(groups, 3).map((cell) => cellOf(cell)),
    }),
  },
  gridPreset("grid-2x2", "Grid 2 × 2", "Four slots in two columns", "Grids", 2, 2),
  gridPreset("triple", "Triple", "Three slots across", "Grids", 3, 1),
  gridPreset("triple-deck", "Triple deck", "Two columns across three rows", "Grids", 2, 3),
  gridPreset("four-across", "Four across", "Four slots in one row", "Grids", 4, 1),
  gridPreset("five-across", "Five across", "Five slots in one row", "Grids", 5, 1),
  gridPreset("desk-6", "Desk 6", "Six slots, three across", "Grids", 3, 2),
  gridPreset("wall-8", "Wall 8", "Eight slots, four across", "Grids", 4, 2),
  gridPreset("wall-9", "Wall 9", "Nine-slot video wall", "Grids", 3, 3),
  gridPreset("wall-12", "Wall 12", "Twelve slots, four across", "Grids", 4, 3),
  {
    id: "main-left",
    name: "Main + sidebar",
    hint: "First tab wide left, rest stacked right",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [main, ...rest] = groups;

      if (!main) return emptyCell();

      const sidebar: PresetNode =
        rest.length === 0
          ? emptyCell()
          : {
              kind: "column",
              children: rest.map((g) => cellOf([g])),
            };

      return {
        kind: "row",
        weights: [0.68, 0.32],
        children: [cellOf([main]), sidebar],
      };
    },
  },
  {
    id: "main-right",
    name: "Sidebar + main",
    hint: "Rest stacked narrow left, first tab wide right",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [main, ...rest] = groups;

      if (!main) return emptyCell();

      const sidebar: PresetNode =
        rest.length === 0
          ? emptyCell()
          : {
              kind: "column",
              children: rest.map((g) => cellOf([g])),
            };

      return {
        kind: "row",
        weights: [0.32, 0.68],
        children: [sidebar, cellOf([main])],
      };
    },
  },
  {
    id: "main-top",
    name: "Hero top",
    hint: "First tab full-width top, two slots below",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [hero, ...rest] = groups;

      return {
        kind: "column",
        weights: [0.55, 0.45],
        children: [
          hero ? cellOf([hero]) : emptyCell(),
          {
            kind: "row",
            children: distributeSlots(rest, 2).map((cell) => cellOf(cell)),
          },
        ],
      };
    },
  },
  {
    id: "main-bottom",
    name: "Hero bottom",
    hint: "Two slots top, first tab full-width bottom",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [hero, ...rest] = groups;

      return {
        kind: "column",
        weights: [0.45, 0.55],
        children: [
          {
            kind: "row",
            children: distributeSlots(rest, 2).map((cell) => cellOf(cell)),
          },
          hero ? cellOf([hero]) : emptyCell(),
        ],
      };
    },
  },
  {
    id: "pro-terminal",
    name: "Pro terminal",
    hint: "Watchlist | chart | ticket",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => ({
      kind: "row",
      weights: [0.22, 0.56, 0.22],
      children: distributeSlots(groups, 3).map((cell) => cellOf(cell)),
    }),
  },
  {
    id: "chart-desk",
    name: "Chart desk",
    hint: "Chart left, ticket + orders stacked right",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [main, ...rest] = groups;

      return {
        kind: "row",
        weights: [0.7, 0.3],
        children: [
          main ? cellOf([main]) : emptyCell(),
          {
            kind: "column",
            children: distributeSlots(rest, 2).map((cell) => cellOf(cell)),
          },
        ],
      };
    },
  },
  {
    id: "terminal-classic",
    name: "Terminal classic",
    hint: "Chart top, three desks below",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [hero, ...rest] = groups;

      return {
        kind: "column",
        weights: [0.62, 0.38],
        children: [
          hero ? cellOf([hero]) : emptyCell(),
          {
            kind: "row",
            children: distributeSlots(rest, 3).map((cell) => cellOf(cell)),
          },
        ],
      };
    },
  },
  {
    id: "chart-strip",
    name: "Chart + strip",
    hint: "Chart over a thin tape strip",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [hero, ...rest] = groups;
      const strip = distributeSlots(rest, 1)[0] ?? [];

      return {
        kind: "column",
        weights: [0.78, 0.22],
        children: [
          hero ? cellOf([hero]) : emptyCell(),
          cellOf(strip),
        ],
      };
    },
  },
  {
    id: "hero-quad",
    name: "Hero quad",
    hint: "Chart top, four desks below in a 2 × 2",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [hero, ...rest] = groups;
      const cells = distributeSlots(rest, 4);

      return {
        kind: "column",
        weights: [0.5, 0.5],
        children: [
          hero ? cellOf([hero]) : emptyCell(),
          {
            kind: "column",
            children: [
              {
                kind: "row",
                children: cells.slice(0, 2).map((cell) => cellOf(cell)),
              },
              {
                kind: "row",
                children: cells.slice(2, 4).map((cell) => cellOf(cell)),
              },
            ],
          },
        ],
      };
    },
  },
  {
    id: "corner-office",
    name: "Corner office",
    hint: "Split corner cell in a 2 × 2 — five slots",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const cells = distributeSlots(groups, 5);
      const [a = [], b = [], c = [], d = [], e = []] = cells;

      return {
        kind: "column",
        children: [
          {
            kind: "row",
            children: [
              {
                kind: "row",
                children: [cellOf(a), cellOf(b)],
              },
              cellOf(c),
            ],
          },
          {
            kind: "row",
            children: [cellOf(d), cellOf(e)],
          },
        ],
      };
    },
  },
  {
    id: "center-stage",
    name: "Center stage",
    hint: "Main act center, two stacks flanking each side",
    section: "Focus",
    minGroups: 1,
    arrange: (groups) => {
      const [main, ...rest] = groups;
      const mid = Math.ceil(rest.length / 2);
      const left = rest.slice(0, mid);
      const right = rest.slice(mid);

      return {
        kind: "row",
        weights: [0.2, 0.6, 0.2],
        children: [
          {
            kind: "column",
            children: distributeSlots(left, 2).map((cell) => cellOf(cell)),
          },
          main ? cellOf([main]) : emptyCell(),
          {
            kind: "column",
            children: distributeSlots(right, 2).map((cell) => cellOf(cell)),
          },
        ],
      };
    },
  },
  {
    id: "tabs",
    name: "Tab stack",
    hint: "Every view stacked in one panel",
    section: "Stack",
    minGroups: 2,
    arrange: (groups) => ({ kind: "cell", groups: [...groups] }),
  },
  {
    id: "sidecar-tabs",
    name: "Sidecar tabs",
    hint: "Two fixed slots left, the rest tabbed right",
    section: "Stack",
    minGroups: 1,
    arrange: (groups) => {
      const fixed = groups.slice(0, 2);
      const tabbed = groups.slice(2);

      return {
        kind: "row",
        weights: [0.38, 0.62],
        children: [
          {
            kind: "column",
            children: distributeSlots(fixed, 2).map((cell) => cellOf(cell)),
          },
          cellOf(tabbed),
        ],
      };
    },
  },
];

/** Preview tree for a preset at the live group count (mirrors `arrange`). */
export function previewForPreset(
  preset: GridPreset,
  groups: ViewGroup[],
): PreviewNode {
  // Same zero-cell wrap as the apply path, so the preview can never show
  // a structure the apply won't build (stack on an empty page).
  const root = ensureNonEmptyPreset(preset.arrange(groups));

  const convert = (node: PresetNode): PreviewNode => {
    if (node.kind === "cell") return { kind: "cell", tabs: tabsOf(node.groups) };

    const children = node.children.map(convert);

    return node.kind === "row"
      ? { kind: "row", children, weights: node.weights }
      : { kind: "column", children, weights: node.weights };
  };

  return convert(root);
}

/**
 * Popover enablement: the normal minimums apply once panels exist, but an
 * EMPTY page enables every preset — each one still yields fillable slots.
 */
export function isPresetUsable(
  preset: GridPreset,
  groupCount: number,
): boolean {
  if (groupCount === 0) return true;

  return groupCount >= preset.minGroups;
}

/** Leaf labels in tree order (shared by the summary compressor). */
function leavesOf(node: PreviewNode): string[] {
  if (node.kind === "cell") {
    return [node.tabs > 0 ? String(node.tabs) : "empty"];
  }

  return node.children.flatMap(leavesOf);
}

/**
 * `2 + empty` style cell summary; runs of empties collapse
 * (`1 + empty × 3`) so wide grids stay one line.
 */
export function previewSummary(node: PreviewNode): string {
  // Fully flattened leaf order — row structure lives in the miniature,
  // the sub-label is one compact line with empty-runs collapsed.
  const flat: string[] = leavesOf(node);

  const out: string[] = [];
  let empties = 0;

  const flush = () => {
    if (empties > 0) {
      out.push(empties === 1 ? "empty" : `empty × ${empties}`);
      empties = 0;
    }
  };

  for (const label of flat) {
    if (label === "empty") {
      empties += 1;
    } else {
      flush();
      out.push(label);
    }
  }

  flush();

  return out.join(" + ");
}

function panelSpecFor(groups: ViewGroup[]): LayoutSpec {
  const views = groups.flatMap((g) => g.views);

  const selected = Math.max(
    0,
    views.findIndex((v) => v.selected),
  );

  if (views.length === 1 && views[0]) {
    const only = views[0];

    return layout.view(only.type, {
      id: only.id,
      params: only.params,
      title: only.title,
    });
  }

  // Multi-view cells (tab stacks, merged overflow) become one tab group.
  // `layout.panel` takes variadic views — spread keeps the call readable
  // and preserves order (first-selected wins the selected index).
  const specs = views.map((v) =>
    layout.view(v.type, { id: v.id, params: v.params, title: v.title }),
  );

  return layout.panel({ selected }, ...specs);
}

/**
 * Preset tree → Trellis spec (row/column map 1:1; filled cells become
 * panels, empty cells become fillable `slot` placeholder views with
 * traversal-order ids, stable across repeated applies of one shape).
 */
export function nodeToSpec(node: PresetNode): LayoutSpec {
  let slots = 0;

  const convert = (current: PresetNode): LayoutSpec => {
    if (current.kind === "cell") {
      if (current.groups.length === 0) {
        const id = `slot-${slots++}`;

        return layout.view("slot", {
          id,
          params: { slot: id },
          title: "Empty pane",
        });
      }

      return panelSpecFor(current.groups);
    }

    const children = current.children.map(convert);

    return current.kind === "row"
      ? layout.row(children, current.weights)
      : layout.column(children, current.weights);
  };

  return convert(node);
}

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

/** Legacy per-browser Trellis key (pre-shared era). Only read once for
 * migration and then removed — the backend `trellis` field is the shared
 * arrangement now. */
export const trellisStorageKey = (pageId: string): string =>
  `nfi-trellis-${pageId}`;

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

/** Zero-cell trees (stack on an empty page) become one fillable slot. */
export function ensureNonEmptyPreset(node: PresetNode): PresetNode {
  const count = (current: PresetNode): number =>
    current.kind === "cell"
      ? 1
      : current.children.reduce((sum, child) => sum + count(child), 0);

  return count(node) === 0 ? emptyCell() : node;
}

export function applyPresetToEmptyPage(
  pageId: string,
  presetId: string,
): boolean {
  const preset = GRID_PRESETS.find((p) => p.id === presetId);

  if (!preset) return false;

  const node = ensureNonEmptyPreset(preset.arrange([]));
  const doc = createDocument(nodeToSpec(node), { version: 3 });

  try {
    // A stale pre-shared localStorage doc overrides `defaultLayout` on
    // mount — drop it so the picked slots actually appear. The applied
    // layout reports back through `onDocumentChange` into the shared
    // backend `trellis` field afterwards.
    localStorage.removeItem(trellisStorageKey(pageId));
  } catch {
    // Private mode / denied storage — mounting still shows the slots for
    // this session via `defaultLayout`.
  }

  pendingLayoutStore.setState(() => ({ pageId, doc }));

  return true;
}

/**
 * Apply a preset, live or empty:
 * - workspace mounted WITH widget views → rebuild the stage in place via
 *   `setDocument` (tab stacks intact, leftovers pad as EMPTY fillable
 *   slots or merge as tabs into the last cell on overflow);
 * - empty stage (no workspace, or mounted with zero widget views) → a
 *   slot-only document: set live when mounted, else staged as the pending
 *   layout for TrellisWorkspace to mount with.
 * Floating + hidden + navigation state carry over untouched. The rebuilt
 * document reports back through Trellis `onDocumentChange` into the
 * workspace store, which persists the shared backend `trellis` field — that
 * is what makes the preset stick for anonymous visitors.
 */
export function applyPreset(
  ws: WorkspaceHandle | null,
  pageId: string,
  presetId: string,
): boolean {
  const preset = GRID_PRESETS.find((p) => p.id === presetId);

  if (!preset) return false;

  const groups = ws ? groupStageViews(ws.views({ type: "widget" })) : [];

  if (groups.length > 0 && groups.length < preset.minGroups) return false;

  if (!ws || groups.length === 0) {
    if (ws) {
      // Mounted but viewless (e.g. only old slots left): rebuild live —
      // a pending layout would never be consumed past mount.
      // Unreferenced old slots drop out of the document on their own
      // (`commit` unmounts views the new root doesn't reference), so no
      // explicit close round-trip — one commit per apply, no interleaving.
      const node = ensureNonEmptyPreset(preset.arrange([]));
      const current = ws.getDocument();

      const live = createDocument(nodeToSpec(node), {
        version: current.version ?? 3,
      });

      live.floating = current.floating;
      live.hidden = current.hidden;
      live.views = { ...current.views, ...live.views };
      live.navigation = current.navigation;

      ws.setDocument(live, { animate: true });

      return true;
    }

    return applyPresetToEmptyPage(pageId, presetId);
  }

  // Old slots share the new ones' traversal ids, so the rebuilt document
  // overwrites them in place — one commit per apply, no close interleaving
  // (unreferenced views unmount with the commit).
  const spec = nodeToSpec(ensureNonEmptyPreset(preset.arrange(groups)));
  const current = ws.getDocument();
  const built = createDocument(spec, { version: current.version ?? 3 });

  // `createDocument` only records views in the new root — restore the live
  // floating windows and merge the full current record so floating/hidden
  // views keep their params + titles. Unreferenced extras are ignored by
  // `setDocument`, never resurrected.
  built.floating = current.floating;
  built.hidden = current.hidden;
  built.views = { ...current.views, ...built.views };
  built.navigation = current.navigation;

  ws.setDocument(built, { animate: true });

  return true;
}

// --- Slot placeholder view -------------------------------------------------

/**
 * Empty pane body: dashed slot with an Add-widget affordance. The button
 * arms the slot target and opens the widget picker; the bridge lands the
 * picked widget INTO this panel and closes the placeholder. Read-only
 * surfaces get the label without the button. The corner × retires the
 * placeholder on its own (Trellis drops the emptied group automatically),
 * so stray empties — including a slot left behind by a pick — are always
 * dismissible without opening the presets dialog.
 */
export function SlotView() {
  const view = useView<{ slot: string }>();
  const locked = useStore(capabilitiesStore, (s) => !s.authenticated);

  useViewTitle("Empty pane");

  const closeSlot = () => {
    void view.close({ force: true });
  };

  // Same component as every other workspace empty state — only the title
  // differs. The Add action arms this slot (view + panel) as the pick
  // target first.
  return (
    <EmptyPane
      title="Empty pane"
      onAdd={
        locked
          ? undefined
          : (anchor) => {
              const target = { viewId: view.id, panelId: view.panelId };
              setPendingSlotTarget(target);
              getTrellisCanvasOpener()?.(anchor, target);
            }
      }
      onClose={locked ? undefined : closeSlot}
    />
  );
}

/** Canvas-level picker opener contract (anchor + optional slot target). */
export type TrellisCanvasOpener = (
  anchor: DOMRect | null,
  slotTarget?: PendingSlotTarget,
) => void;

/** Latest canvas-level picker opener (set by TrellisWorkspace each render). */
interface TrellisCanvasOpenerRef {
  current: TrellisCanvasOpener | null;
}

const trellisCanvasOpener: TrellisCanvasOpenerRef = { current: null };

export const getTrellisCanvasOpener = () =>
  trellisCanvasOpener.current;

export const setTrellisCanvasOpener = (
  opener: TrellisCanvasOpener | null,
): void => {
  trellisCanvasOpener.current = opener;
};

// --- Dialog UI --------------------------------------------------------------

/** Miniature card: tab strip + body, ghost layer behind tab stacks. */
function MiniCard({ tabs }: { tabs: number }) {
  if (tabs === 0) {
    return <span className="nfi-pv-empty" aria-hidden />;
  }

  return (
    <span className="nfi-pv-card" aria-hidden>
      {tabs > 1 ? <span className="nfi-pv-ghost" aria-hidden /> : null}
      <span className="nfi-pv-tabbar" aria-hidden />
      <span className="nfi-pv-body" aria-hidden />
      {tabs > 1 ? <span className="nfi-pv-count">{tabs}</span> : null}
    </span>
  );
}

function PreviewTree({ node }: { node: PreviewNode }) {
  if (node.kind === "cell") return <MiniCard tabs={node.tabs} />;

  const style: CSSProperties = {
    display: "flex",
    flexDirection: node.kind === "row" ? "row" : "column",
    gap: 2,
    flex: "1 1 0",
    minWidth: 0,
    minHeight: 0,
  };

  return (
    <span style={style} aria-hidden>
      {node.children.map((child, i) => {
        const weight = node.weights?.[i];

        const childStyle: CSSProperties = {
          display: "flex",
          flexDirection: child.kind === "row" ? "row" : "column",
          gap: 2,
          flex: weight !== undefined ? `${weight} 1 0` : "1 1 0",
          minWidth: 0,
          minHeight: 0,
        };

        return (
          <span key={i} style={childStyle}>
            <PreviewTree node={child} />
          </span>
        );
      })}
    </span>
  );
}

// --- Header button + popover -------------------------------------------------

/**
 * Live Trellis handle mirror for chrome OUTSIDE the workspace (the header
 * cannot use `useWorkspace` — it renders above `<Workspace>`). Set by the
 * bridge on mount; `generation` bumps so header buttons re-render as the
 * workspace comes and goes across page switches.
 */
const trellisHandleStore = new Store<{
  ws: WorkspaceHandle | null;
  generation: number;
}>({ ws: null, generation: 0 });

export const setTrellisWorkspaceHandle = (
  ws: WorkspaceHandle | null,
): void => {
  trellisHandleStore.setState((s) => ({ ws, generation: s.generation + 1 }));
};

export const getTrellisWorkspaceHandle = (): WorkspaceHandle | null =>
  trellisHandleStore.state.ws;

function PresetsDialog({
  views,
  onClose,
  onApply,
}: {
  views: ReadonlyArray<ViewInfo>;
  onClose: () => void;
  /** Apply a preset by id; false keeps the dialog open. */
  onApply: (presetId: string) => boolean;
}) {
  const groups = groupStageViews(
    views.filter((v) => v.type === "widget"),
  );

  // Sections in first-seen order (mirrors GRID_PRESETS declaration).
  const sections: Array<{ name: string; presets: GridPreset[] }> = [];

  for (const preset of GRID_PRESETS) {
    const existing = sections.find((s) => s.name === preset.section);

    if (existing) existing.presets.push(preset);
    else sections.push({ name: preset.section, presets: [preset] });
  }

  const countLabel =
    groups.length === 0
      ? "no panels"
      : `${groups.length} panel${groups.length === 1 ? "" : "s"}`;

  return (
    <Modal
      open
      passiveModal
      size="lg"
      modalHeading="Grid presets"
      modalLabel={countLabel}
      onRequestClose={onClose}
      className="nfi-presets-dialog"
    >
      <div className="nfi-presets-dialog-body">
        {sections.map((section) => (
          <div key={section.name} role="group" aria-label={section.name}>
            <p className="nfi-presets-section">{section.name}</p>
            <div className="nfi-preset-grid">
              {section.presets.map((preset) => {
                const usable = isPresetUsable(preset, groups.length);

                const preview = usable
                  ? previewForPreset(preset, groups)
                  : null;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    className="nfi-preset-card"
                    disabled={!usable}
                    title={
                      usable
                        ? `${preset.hint} — applies to this page`
                        : `Needs at least ${preset.minGroups} panels`
                    }
                    onClick={() => {
                      if (onApply(preset.id)) onClose();
                    }}
                  >
                    <span
                      className="nfi-preset-preview nfi-preset-preview--lg"
                      aria-hidden
                    >
                      {preview ? (
                        <PreviewTree node={preview} />
                      ) : (
                        <MiniCard tabs={0} />
                      )}
                    </span>
                    <span className="nfi-preset-meta">
                      <span className="nfi-preset-name">{preset.name}</span>
                      <span className="nfi-preset-sub">
                        {usable && preview
                          ? previewSummary(preview)
                          : preset.hint}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * Global grid-preset action for the main header (next to Search): presets
 * rearrange the whole page, not one tab, so they live with the other
 * global actions. Rendered only on the terminal while signed in (AppShell
 * gates both); null until the Trellis workspace mounts. Live view counts
 * refresh via a workspace subscription while the dialog is open, and a
 * page switch (handle generation bump) dismisses it.
 */
export function GridPresetsHeaderButton({
  activePageId,
}: {
  /** Page the picked preset applies to (empty pages have no workspace). */
  activePageId: string;
}) {
  const generation = useStore(trellisHandleStore, (s) => s.generation);
  const openStore = useLocalStore(false);
  const open = useStore(openStore, (s) => s);
  const tickStore = useLocalStore(0);
  useStore(tickStore, (s) => s);

  const close = () => openStore.setState(() => false);

  // A page switch swaps the workspace underneath — never apply a stale
  // dialog to the new page.
  useStoreEffect(() => {
    close();
  }, [generation]);

  useStoreEffect(() => {
    if (!open) return;

    const ws = getTrellisWorkspaceHandle();
    const release = ws?.subscribe(() => tickStore.setState((v) => v + 1));

    return () => {
      release?.();
    };
  }, [open, generation ]);

  // No workspace on empty pages (Trellis mounts with ≥1 view) — the
  // dialog still opens with all-empty previews and the pick mounts the
  // slot grid via the pending layout instead of `setDocument`.
  const ws = getTrellisWorkspaceHandle();

  const views =
    open && ws
      ? ws.getSnapshot().views.filter((v) => v.type === "widget")
      : [];

  const apply = (presetId: string): boolean => {
    try {
      return applyPreset(ws, activePageId, presetId);
    } catch (cause) {
      // Layout switches must never fail silently (the reported
      // first-select no-op): surface the cause and keep the dialog open
      // so the user can retry or pick another preset.
      void requestConfirm({
        title: "Layout preset failed",
        message:
          cause instanceof Error
            ? cause.message
            : "The preset could not be applied to this page.",
        confirmLabel: "OK",
      }).then(() => undefined);

      return false;
    }
  };

  return (
    <>
      <button
        type="button"
        className="nfi-topbar-button"
        title="Grid presets — rearrange this page's panels"
        aria-label="Grid presets"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else openStore.setState(() => true);
        }}
      >
        <Grid size={16} />
      </button>
      {open ? (
        <PresetsDialog views={views} onClose={close} onApply={apply} />
      ) : null}
    </>
  );
}
