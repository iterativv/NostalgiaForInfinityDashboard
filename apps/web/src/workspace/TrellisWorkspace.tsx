// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Fragment, useEffect, useMemo, type ReactNode } from "react";
import { Either, Schema } from "effect";
import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import { Add } from "@carbon/icons-react";
import {
  Panel as TrellisPanel,
  Split as TrellisSplit,
  Stage as TrellisStage,
  View as TrellisView,
  ViewType,
  Workspace,
  useView,
  useViewTitle,
  useOptionalWorkspace,
  type Params as TrellisParams,
  type ViewApi,
} from "@danfessler/trellis-react";
import "@danfessler/trellis/style.css";
import type {
  LayoutNode,
  PanelInstance,
  Workspace as NfiWorkspace,
} from "@nfi/api-contract";
import type {
  AnyWidgetDefinition,
  WidgetProps,
  WidgetRegistry,
} from "@nfi/widget-sdk";
import { capabilitiesStore } from "../auth/capabilities";
import { prefsStore } from "../store";
import { CARBON_THEMES_DARK } from "../carbonTheme";
import { Panel } from "./Panel";
import { TabActionsMenu } from "./TabMenu";
import {
  SlotView,
  clearPendingSlotLayout,
  clearPendingSlotTarget,
  getTrellisCanvasOpener,
  getTrellisWorkspaceHandle,
  peekPendingSlotTarget,
  setPendingSlotTarget,
  setTrellisCanvasOpener,
  setTrellisWorkspaceHandle,
  takePendingSlotTarget,
  usePendingSlotLayout,
} from "./TrellisPresets";
import { EmptyPane } from "./EmptyPane";
import { TabFullScreen } from "./TabFullScreen";
import {
  activateWorkspacePanel,
  closeWorkspacePanel,
  pinTabToFloating,
  workspaceStore,
} from "./store";

/**
 * TrellisWorkspace — Trellis handles layout only.
 * (https://trellisui.com/docs/quick-start-react).
 *
 * Every visible pixel follows the previous NFI/Carbon style: Trellis theme
 * tokens map to `var(--cds-*)` (which resolve under the app's Carbon Theme
 * scope, so light themes keep working) plus the `.nfi-trellis` overrides in
 * `styles.css` (square tabs, 23px strip, active-tab underline). Trellis owns
 * docking, splitting, tabbing, floating, hiding and zoom — every view stays
 * mounted so iframes keep sessions and React keeps state.
 *
 * Quick-start steps implemented here:
 * 1. Render a workspace — `<Workspace>` fills `.nfi-workspace-host`.
 * 2. Register view types — single `<ViewType id="widget">`; each view is
 *    one NFI panel (`params: { panelId }`).
 * 3. Describe the initial layout — the current `Workspace.layout` tree is
 *    compiled once (on mount) to `<Split>/<Stage>/<Panel>/<View>`.
 *    After mount the user owns the layout.
 * 4. Read view state in content — `WidgetView` uses `useView()` +
 *    `useViewTitle()` and renders the existing `Panel` (header off; the
 *    tab strip + actions live in the Trellis tab bar via `accessory`).
 * 5. Open views — new store panels are opened with `ws.open("widget")`.
 * 6. Remember the layout — `storageKey` per page + `version`.
 *
 * Tab actions restored (previously in `TabGroup`): the `accessory` renders
 * the strip "+" (canvas-level add) and the full `TabActionsMenu`
 * (Information, Reload, Download/Copy image, Copy share link, Rename/Reset
 * name, Settings, Full screen, Pin to floating, Close tab). The Trellis
 * built-in panel menu stays off (`panelMenu={false}`) so there is exactly
 * one menu, like before. Full screen reuses `TabFullScreen`; while it is
 * open the Trellis slot renders the dialog instead of a second live Panel.
 */

interface TrellisWidgetParams {
  panelId: string;
}

const TrellisWidgetParamsSchema = Schema.Struct({
  panelId: Schema.String,
});

/**
 * Decode Trellis view params at the Trellis I/O boundary: persisted
 * documents outlive code, so params are unknown until validated here.
 */
function panelIdFromTrellisParams(
  params: TrellisParams | undefined,
  fallbackViewId: string,
): string | null {
  const decoded = Schema.decodeUnknownEither(TrellisWidgetParamsSchema)(params);

  if (Either.isRight(decoded)) return decoded.right.panelId;

  return panelIdForViewId(fallbackViewId);
}

function viewIdForPanel(panelId: string): string {
  return `view-${panelId}`;
}

function panelIdForViewId(viewId: string): string | null {
  return viewId.startsWith("view-") ? viewId.slice("view-".length) : null;
}

interface FullscreenRequest {
  panelId: string;
  aspect: number;
}

const trellisFullscreenStore = new Store<FullscreenRequest | null>(null);

function guardedClose(panelId: string): void {
  if (!capabilitiesStore.state.authenticated) return;
  closeWorkspacePanel(panelId);
}

function guardedPin(panelId: string): void {
  if (!capabilitiesStore.state.authenticated) return;
  pinTabToFloating(panelId);
}

/** Best-effort decode for the Information dialog (falls back to raw config). */
function decodeForInfo(
  definition:
    | {
        decodeConfig: (
          input: PanelInstance["widgetConfig"],
        ) => WidgetProps<unknown>["config"];
      }
    | undefined,
  config: PanelInstance["widgetConfig"],
): WidgetProps<unknown>["config"] {
  if (!definition) return config;

  try {
    return definition.decodeConfig(config);
  } catch {
    return config;
  }
}

function WidgetView({ registry }: { registry: WidgetRegistry }) {
  const view = useView<TrellisWidgetParams>();
  const panelId = view.params.panelId;

  const instance = useStore(workspaceStore, (s) => s.workspace.panels[panelId]);

  const customTitle = instance?.title;

  const definition = instance
    ? registry.getWidget(instance.widgetType)
    : undefined;

  const focused = useStore(
    workspaceStore,
    (s) => s.workspace.activePanelId === panelId,
  );

  const fullscreen = useStore(trellisFullscreenStore, (s) => s);

  useViewTitle(customTitle ?? definition?.title ?? panelId);

  // A view without a store panel is stale (a persisted Trellis document
  // outlived its panel): offer a close that drops the Trellis view itself
  // instead of the store no-op, so stale tabs are always dismissible.
  const closeStaleView = () => {
    void view.close({ force: true });
  };

  if (fullscreen?.panelId === panelId) {
    return (
      <TabFullScreen
        title={
          customTitle ?? definition?.title ?? instance?.widgetType ?? panelId
        }
        panelId={panelId}
        widgetType={instance?.widgetType}
        widgetConfig={instance?.widgetConfig}
        workspace={workspaceStore.state.workspace}
        registry={registry}
        aspect={fullscreen.aspect}
        onActivate={activateWorkspacePanel}
        onClosePanel={guardedClose}
        onRestore={() => trellisFullscreenStore.setState(() => null)}
      />
    );
  }

  return (
    <Panel
      panelId={panelId}
      widgetType={instance?.widgetType}
      widgetConfig={instance?.widgetConfig}
      title={undefined}
      focused={focused}
      registry={registry}
      onActivate={activateWorkspacePanel}
      onClose={instance ? guardedClose : closeStaleView}
      showHeader={false}
    />
  );
}

/**
 * Trellis tab-bar chrome for the selected view: the tab actions menu plus
 * the strip "+" (canvas-level add, like the old tab strip's). Rendered via
 * `ViewType accessory` at the end of the tab bar — with the tabs hugging
 * the left (see `.nfi-trellis` CSS), the ⋯ sits right after the active tab
 * and the + follows it, matching the old strip order. Module-level (no
 * changing props): everything reactive comes from stores, so it never goes
 * stale even though Trellis reads the initial layout once.
 */
function TrellisTabChrome({
  view,
  registry,
}: {
  view: ViewApi<TrellisWidgetParams>;
  registry: WidgetRegistry;
}) {
  const panelId = view.params.panelId;
  // Null until the workspace mounts; the accessory only renders after that.
  const ws = useOptionalWorkspace();

  const instance = useStore(workspaceStore, (s) => s.workspace.panels[panelId]);

  const locked = useStore(capabilitiesStore, (s) => !s.authenticated);

  if (!instance) return null;

  const definition: AnyWidgetDefinition | undefined = registry.getWidget(
    instance.widgetType,
  );

  const label = instance.title ?? definition?.title ?? instance.widgetType;

  const openCanvas = (event: { currentTarget: HTMLElement }) => {
    getTrellisCanvasOpener()?.(
      event.currentTarget.getBoundingClientRect(),
    );
  };

  const openFullscreen = () => {
    const width = view.size.width;
    const height = view.size.height;
    trellisFullscreenStore.setState(() => ({
      panelId,
      aspect: width > 0 && height > 0 ? width / height : 16 / 9,
    }));
  };

  // Fractal splits: tear this tab out beside its own group — Trellis drops
  // the emptied group automatically, so any layout nests arbitrarily deep.
  const splitTab = (edge: "right" | "bottom") => {
    if (!ws) return;

    try {
      ws.dock(view.id, { beside: view.panelId, edge, share: 0.5 });
    } catch {
      // Unknown ids (stale view): no-op.
    }
  };

  return (
    <>
      <TabActionsMenu
        title={label}
        panelId={panelId}
        renamed={instance.title !== undefined}
        locked={locked}
        canClose={!locked}
        canConfigure={definition?.hasSettings === true && !locked}
        canPin={!locked}
        canFullScreen
        widgetDefinition={definition}
        widgetConfig={decodeForInfo(definition, instance.widgetConfig)}
        onClosePanel={guardedClose}
        onPinPanel={guardedPin}
        onFullScreen={openFullscreen}
        onSplitRight={locked ? undefined : () => splitTab("right")}
        onSplitBelow={locked ? undefined : () => splitTab("bottom")}
      />
      {locked ? null : (
        <button
          type="button"
          className="nfi-tab-add"
          title="Add widget"
          aria-label="Add widget"
          onClick={openCanvas}
        >
          <Add size={14} />
        </button>
      )}
    </>
  );
}

function selectedIndex(
  panels: ReadonlyArray<string>,
  activePanelId: string | null,
): number {
  if (activePanelId === null) return 0;
  const index = panels.indexOf(activePanelId);

  return index >= 0 ? index : 0;
}

/**
 * Span units Trellis packs into one row when compiling bento cards.
 * Presets pair span 3 (wide) + span 2 (narrow) = 5 per row; a 3 + 3 pair
 * (two wide tables) never shares a row — each takes a full-width row
 * instead of squeezing below its minimum.
 */
export const TRELLIS_GRID_ROW_UNITS = 5;

/** Clamp a persisted card span into 1..TRELLIS_GRID_ROW_UNITS; NaN reads as 1. */
function coerceSpanUnits(span: number): number {
  return Number.isFinite(span) && span >= 1
    ? Math.max(1, Math.min(TRELLIS_GRID_ROW_UNITS, Math.round(span)))
    : 1;
}

/**
 * Pack card spans into rows of at most `TRELLIS_GRID_ROW_UNITS` units.
 * Pure index math (no DOM) so presets and tests share the exact row
 * breaks the renderer compiles. Never emits an empty row; spans outside
 * 1..5 coerce into range and NaN reads as 1.
 */
export function packBentoRows(
  spans: ReadonlyArray<number>,
  unitsPerRow: number = TRELLIS_GRID_ROW_UNITS,
): number[][] {
  const cap =
    Number.isFinite(unitsPerRow) && unitsPerRow >= 1
      ? Math.floor(unitsPerRow)
      : TRELLIS_GRID_ROW_UNITS;

  const rows: number[][] = [];
  let current: number[] = [];
  let used = 0;

  spans.forEach((raw, index) => {
    const units = Number.isFinite(raw) && raw >= 1
      ? Math.max(1, Math.min(cap, Math.round(raw)))
      : 1;

    if (current.length > 0 && used + units > cap) {
      rows.push(current);
      current = [];
      used = 0;
    }

    current.push(index);
    used += units;
  });

  if (current.length > 0) rows.push(current);

  return rows;
}

function toTrellis(node: LayoutNode): ReactNode {
  switch (node.type) {
    case "panel":
      return (
        <TrellisView
          type="widget"
          id={viewIdForPanel(node.panelId)}
          params={{ panelId: node.panelId } satisfies TrellisWidgetParams}
        />
      );
    case "tabs":
      return (
        <TrellisPanel selected={selectedIndex(node.panels, node.activePanelId)}>
          {node.panels.map((panelId) => (
            <TrellisView
              key={panelId}
              type="widget"
              id={viewIdForPanel(panelId)}
              params={{ panelId } satisfies TrellisWidgetParams}
            />
          ))}
        </TrellisPanel>
      );
    case "split":
      return (
        <TrellisSplit
          axis={node.direction === "horizontal" ? "x" : "y"}
          weights={[node.ratio, 1 - node.ratio]}
        >
          {toTrellis(node.first)}
          {toTrellis(node.second)}
        </TrellisSplit>
      );
    case "grid": {
      // Legacy grids compile to a real 2-D Trellis grid: cells grouped by
      // row (reading order), each row a horizontal split weighted by column
      // spans, rows stacked vertically weighted by row spans. Degenerate
      // coordinates coerce to 1 so a corrupt track can never collapse it.
      if (node.items.length === 0) return null;

      if (node.items.length === 1 && node.items[0])
        return toTrellis(node.items[0].child);
      const byRow = new Map<number, Array<(typeof node.items)[number]>>();

      for (const item of node.items) {
        const row = Number.isInteger(item.row) && item.row >= 1 ? item.row : 1;
        const list = byRow.get(row) ?? [];
        list.push(item);
        byRow.set(row, list);
      }

      const orderedRows = [...byRow.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, cells]) =>
          [...cells].sort((a, b) => a.col - b.col),
        );

      if (orderedRows.length === 1 && orderedRows[0]!.length === 1)
        return toTrellis(orderedRows[0]![0]!.child);

      return (
        <TrellisSplit
          axis="y"
          weights={orderedRows.map((cells) =>
            Math.max(
              ...cells.map((cell) =>
                Number.isInteger(cell.rowSpan) && cell.rowSpan >= 1
                  ? cell.rowSpan
                  : 1,
              ),
            ),
          )}
        >
          {orderedRows.map((cells, rowIndex) => {
            if (cells.length === 1 && cells[0])
              return (
                <Fragment key={cells[0].id}>
                  {toTrellis(cells[0].child)}
                </Fragment>
              );

            return (
              <TrellisSplit
                key={`grid-row-${rowIndex}`}
                axis="x"
                weights={cells.map((cell) =>
                  Number.isInteger(cell.colSpan) && cell.colSpan >= 1
                    ? cell.colSpan
                    : 1,
                )}
              >
                {cells.map((cell) => (
                  <Fragment key={cell.id}>
                    {toTrellis(cell.child)}
                  </Fragment>
                ))}
              </TrellisSplit>
            );
          })}
        </TrellisSplit>
      );
    }

    case "flow":
    case "masonry":
    case "auto": {
      if (node.items.length === 0) return null;

      if (node.items.length === 1 && node.items[0])
        return toTrellis(node.items[0].child);

      // Bento/masonry/flow cards compile to a real responsive grid, not a
      // single full-width column: spans pack into rows of at most 5 units
      // (span 3 wide + span 2 narrow per row; 3 + 3 never shares), each row
      // a horizontal split weighted by spans, rows stacked vertically
      // weighted by their tallest card. Tall tables keep tall rows, stat
      // strips keep short ones, and side-by-side cards share a row instead
      // of each taking the full stage width. Below 56rem the CSS stacks
      // every panel into a scrolling column (pure render override), so the
      // same document is a tiled grid on desktop and a readable column on
      // phones. Trellis owns the result after mount (dividers, docking).
      // Flow cards carry no span (width lives on the item); masonry/auto
      // cards declare it, and coerceSpanUnits absorbs corrupt NaN/Infinity.
      const spans = node.items.map((item) =>
        coerceSpanUnits("span" in item ? item.span : 1),
      );

      const rows = packBentoRows(spans);

      if (rows.length === 1 && rows[0]!.length === 1 && node.items[0])
        return toTrellis(node.items[0].child);

      const rowHeights = rows.map(
        (row) =>
          Math.max(
            ...row.map((index) => {
              const height = node.items[index]!.height;

              return Number.isFinite(height) && height > 0 ? height : 1;
            }),
          ),
      );

      return (
        <TrellisSplit axis="y" weights={rowHeights}>
          {rows.map((row, rowIndex) => {
            const first = row[0]!;

            if (row.length === 1 && node.items[first])
              return (
                <Fragment key={node.items[first]!.id}>
                  {toTrellis(node.items[first]!.child)}
                </Fragment>
              );

            return (
              <TrellisSplit
                key={`bento-row-${rowIndex}`}
                axis="x"
                weights={row.map((index) => spans[index]!)}
              >
                {row.map((index) => (
                  <Fragment key={node.items[index]!.id}>
                    {toTrellis(node.items[index]!.child)}
                  </Fragment>
                ))}
              </TrellisSplit>
            );
          })}
        </TrellisSplit>
      );
    }
  }
}

/**
 * Previous NFI/Carbon look for the Trellis chrome, as workspace tokens.
 * Every color points at `var(--cds-*)`, which resolve under the app's
 * Carbon Theme scope — light themes (white/g10) restyle automatically.
 * Shape (square tabs, 23px strip, 8px gaps) matches the old tab strip and
 * bento cards; see the `.nfi-trellis` overrides in `styles.css`.
 */
const NFI_TOKENS = {
  "--trellis-font": '"IBM Plex Sans", ui-sans-serif, system-ui, sans-serif',
  "--trellis-font-size": "12px",
  "--trellis-bg": "var(--cds-background)",
  "--trellis-panel": "var(--cds-layer-01)",
  "--trellis-tabbar": "var(--cds-layer-01)",
  "--trellis-tab-hover": "var(--cds-layer-hover)",
  "--trellis-tab-active": "var(--cds-layer-02)",
  "--trellis-text": "var(--cds-text-primary)",
  "--trellis-text-muted": "var(--cds-text-secondary)",
  "--trellis-border": "var(--cds-border-subtle)",
  "--trellis-accent": "var(--cds-border-interactive)",
  "--trellis-accent-contrast": "#ffffff",
  "--trellis-stage": "var(--cds-background)",
  "--trellis-slot": "var(--cds-layer-hover)",
  "--trellis-gap": "8px",
  "--trellis-radius": "0px",
  "--trellis-tab-radius": "0px",
  // NOTE: Trellis reads this token with parseFloat (px assumed) for layout
  // math — a rem value would collapse the bar to ~1px and hide every tab.
  // 23px == the old 1.4375rem strip at the default root font size.
  "--trellis-tabbar-height": "23px",
  "--trellis-tab-max-width": "12rem",
  "--trellis-tab-inset": "0px",
} satisfies Record<string, string>;

/**
 * Store ↔ Trellis bridge. Lives in `Workspace.Chrome` so it can use the
 * documented workspace hooks instead of a ref: null until the workspace
 * mounts, then keeps the two in sync —
 * - panels opened via the picker/palette/commands (store ops) are opened
 *   as Trellis views;
 * - Trellis views whose panel is gone from the store (a persisted document
 *   outlived its panels) are closed;
 * - with zero store panels left, Trellis resets to the empty workspace so
 *   no degenerate skeleton (stuck splits, slivered empty slot) survives.
 * Trellis-owned moves (drag/split/float) persist via `storageKey` and need
 * no store round-trip.
 */
function TrellisBridge({ panels }: { panels: NfiWorkspace["panels"] }) {
  const ws = useOptionalWorkspace();

  useEffect(() => {
    if (!ws) return;
    setTrellisWorkspaceHandle(ws);
    let cancelled = false;
    // Surfaces settle a frame after mount; retry briefly if not ready.
    let attempts = 0;

    const attempt = () => {
      if (cancelled) return;

      try {
        if (Object.keys(panels).length === 0) {
          // Slot-only grids (a preset picked on an empty page) have
          // views but no store panels — resetting would wipe the fresh
          // slots, so only a truly viewless workspace resets.
          if (ws.getSnapshot().views.length === 0) ws.reset();

          return;
        }

        // First widget open consumes any pending empty-page layout.
        clearPendingSlotLayout();
        const snapshot = ws.getSnapshot();
        const existing = new Set(snapshot.views.map((v) => v.id));
        // Slot-targeted pick (empty pane Add button): land the new widget
        // INTO the slot's panel and retire the placeholder by its VIEW id.
        // Read-only — only the pick path consumes it, the picker-cancel
        // path clears it, so a pending target can never hijack an unrelated
        // add. Consumed exactly once: later new panels in the same commit
        // fall through to default placement.
        let pendingSlot = peekPendingSlotTarget();

        for (const panelId of Object.keys(panels)) {
          const viewId = viewIdForPanel(panelId);

          if (existing.has(viewId)) continue;

          let placed = false;

          if (pendingSlot) {
            const target = pendingSlot;
            pendingSlot = null;

            try {
              const opened = ws.open("widget", {
                id: viewId,
                params: { panelId } satisfies TrellisWidgetParams,
                focus: true,
                placement: { into: target.panelId },
              });

              // Only retire the placeholder when the widget actually landed
              // in its panel — a stale `into` falls back to side/stage
              // placement and must leave the slot grid untouched.
              placed = opened.panelId === target.panelId;
            } catch {
              placed = false;
            }

            takePendingSlotTarget();

            if (placed) {
              // Retire the exact placeholder first (cannot miss), then sweep
              // any other slot views still sharing its panel (stale
              // traversal ids after repeated preset applies) so no "Empty
              // pane" tab survives next to the new widget.
              void ws.close(target.viewId, { force: true });

              for (const slot of ws.views({ type: "slot" })) {
                if (slot.panelId === target.panelId && slot.id !== target.viewId) {
                  void ws.close(slot.id, { force: true });
                }
              }
            }
          }

          if (!placed) {
            ws.open("widget", {
              id: viewId,
              params: { panelId } satisfies TrellisWidgetParams,
              focus: false,
            });
          }
        }

        for (const view of snapshot.views) {
          if (view.type !== "widget") continue;

          const panelId = panelIdFromTrellisParams(view.params, view.id);

          if (panelId && !(panelId in panels)) {
            void ws.close(view.id, { force: true });
          }
        }
      } catch {
        attempts += 1;

        if (attempts < 20) window.setTimeout(attempt, 100);
      }
    };

    const timer = window.setTimeout(attempt, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [ws, panels]);

  return null;
}

export function TrellisWorkspace({
  workspace,
  registry,
  activePageId,
  onActivatePanel,
  onActivateTab,
  onClosePanel,
  onOpenCanvas,
  isSplitLocked = false,
  locked = false,
}: {
  workspace: NfiWorkspace;
  registry: WidgetRegistry;
  /** Scopes Trellis persistence (`storageKey`) per page. */
  activePageId: string;
  onActivatePanel: (panelId: string) => void;
  onActivateTab: (tabsId: string, panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  onOpenCanvas?: (anchor: DOMRect | null) => void;
  isSplitLocked?: boolean;
  locked?: boolean;
}) {
  const colorTheme = useStore(prefsStore, (s) => s.colorTheme);
  // `isSplitLocked` mirrors `locked` from the shell today (read-only
  // surfaces); Trellis owns its dividers, so both collapse to read-only.
  const readOnly = locked || isSplitLocked;

  // A preset picked on an empty page waits here: the empty branch below
  // mounts Trellis with it as `defaultLayout` (scoped per page, cleared
  // on first widget open and on layout reset).
  const pendingLayout = usePendingSlotLayout();

  const pendingForPage =
    pendingLayout?.pageId === activePageId ? pendingLayout : null;

  // Canvas picker channel: plain opens clear any pending slot target (an
  // explicit "add anywhere" wins); slot opens arm it so the bridge lands
  // the picked widget into that panel. Picker-cancel clears it in AppShell.
  setTrellisCanvasOpener(
    onOpenCanvas
      ? (anchor, slotTarget) => {
          if (slotTarget) setPendingSlotTarget(slotTarget);
          else clearPendingSlotTarget();
          onOpenCanvas(anchor);
        }
      : null,
  );

  const initialLayout = useMemo(
    () => toTrellis(workspace.layout),
    // The NFI tree can gain/lose its first card while staying on the page
    // (empty ↔ non-empty toggles the fallback below). Trellis itself reads
    // the layout once per mount — the bridge opens later additions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePageId, workspace.layout],
  );

  // Empty page: don't mount Trellis at all — the shared empty state
  // directly — unless a preset was just picked for it (pending layout),
  // which mounts Trellis with the slot grid as its initial document.
  // Trellis only mounts with ≥1 view, so no degenerate
  // skeleton can ever exist; adding the first widget mounts it fresh.
  // (Corrupt non-empty trees still mount Trellis — the bridge opens the
  // store panels with default placement and heals them live.)
  if (!initialLayout && Object.keys(workspace.panels).length === 0 && !pendingForPage) {
    return (
      <div className="nfi-trellis-empty">
        <EmptyPane
          title="No widgets yet."
          onAdd={
            readOnly || !onOpenCanvas
              ? undefined
              : (anchor) => onOpenCanvas(anchor)
          }
        />
      </div>
    );
  }

  return (
    <Workspace
      // Trellis reads storageKey/version/layout once per mount — remount
      // per page or every page would show the first-loaded layout.
      key={activePageId}
      theme={CARBON_THEMES_DARK.has(colorTheme) ? "dark" : "light"}
      tokens={NFI_TOKENS}
      tabs={{ fill: false, inset: 0 }}
      navigation="focus"
      storageKey={`nfi-trellis-${activePageId}`}
      // v4: v3 persisted documents predate the 2-D grid compiler (every
      // bento page mounted as a single full-width column) — discard them
      // and rebuild from the NFI document. Panel configs are untouched;
      // only Trellis divider/dock positions reset.
      version={4}
      // A preset picked on the empty page becomes the initial document
      // (the pick handler already dropped any stale persisted doc that
      // would override it). Absent everywhere else.
      defaultLayout={pendingForPage?.doc}
      panelMenu={false}
      className="nfi-trellis"
      onFocus={(viewId) => {
        if (viewId === null) return;
        const ws = getTrellisWorkspaceHandle();

        const params = ws
          ?.getSnapshot()
          .views.find((v) => v.id === viewId)?.params;

        const panelId = panelIdFromTrellisParams(params, viewId);

        if (panelId) {
          onActivatePanel(panelId);
          onActivateTab(viewId, panelId);
        }
      }}
      onClose={(view) => {
        const panelId = panelIdFromTrellisParams(view.params, view.id);

        if (panelId && panelId in workspace.panels) onClosePanel(panelId);
      }}
    >
      <ViewType
        id="widget"
        accessory={(view) => (
          <TrellisTabChrome
            // SAFETY: this accessory belongs to ViewType id="widget", whose
            // views are always created with TrellisWidgetParams (initial
            // layout above plus ws.open in the bridge).
            view={view as ViewApi<TrellisWidgetParams>}
            registry={registry}
          />
        )}
      >
        <WidgetView registry={registry} />
      </ViewType>

      {/* Empty-pane placeholders minted by grid presets — a dashed slot
          with an Add-widget affordance, never a store panel, so the
          bridge ignores them (open/close sync is widget-typed only).
          `tabbar="never"`: a slot is exactly the empty-page look (no
          tab strip), just embedded in the grid. */}
      <ViewType id="slot" tabbar="never">
        <SlotView />
      </ViewType>

      <TrellisStage
        empty={
          <EmptyPane
            title="No widgets yet."
            onAdd={
              readOnly || !onOpenCanvas
                ? undefined
                : (anchor) => onOpenCanvas(anchor)
            }
          />
        }
      >
        {initialLayout}
      </TrellisStage>

      <Workspace.Empty>
        <EmptyPane
          title="Workspace is empty."
          onAdd={
            readOnly || !onOpenCanvas
              ? undefined
              : (anchor) => onOpenCanvas(anchor)
          }
        />
      </Workspace.Empty>

      <Workspace.Chrome>
        <TrellisBridge panels={workspace.panels} />
      </Workspace.Chrome>
    </Workspace>
  );
}

// Re-exported for tests/docs: stable Trellis view id for an NFI panel.
export { viewIdForPanel };
