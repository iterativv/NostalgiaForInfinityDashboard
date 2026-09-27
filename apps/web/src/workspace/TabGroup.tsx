// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Either, Schema } from "effect";
import { Button } from "@carbon/react";
import { Add } from "@carbon/icons-react";
import { useStore } from "@tanstack/react-store";
import { useLocalStore } from "@nfi/ui";
import { PanelVisibleContext } from "../capabilities/live";
import type {
  PanelInstance,
  TabsLayoutNode,
  Workspace,
} from "@nfi/api-contract";
import type { WidgetProps, WidgetRegistry } from "@nfi/widget-sdk";
import { Panel } from "./Panel";
import { SlimScroll } from "./SlimScroll";
import { TabActionsMenu } from "./TabMenu";
import { TabFullScreen } from "./TabFullScreen";

/**
 * TabGroup — workspace infrastructure (NOT a widget).
 *
 * Tab state (panels, active tab) lives in the workspace model; only
 * transient interaction (keyboard nav within the tab strip, drag state,
 * hover menus, full screen) is local. Only the active tab mounts its
 * Panel — inactive tabs render an empty placeholder so hidden widgets cost
 * nothing (no decode, no queries, no charts); identity comes from the
 * model, not from mount order.
 *
 * Tabs are draggable across grids (HTML5 drag-and-drop onto another group's
 * strip, or onto a specific tab to insert before it). The "+" button opens
 * the widget picker anchored to it — no sidebar, no palette detour.
 *
 * Each tab is plain elements only (no nested buttons): the title is a
 * native tab button plus a single "⋯" actions trigger on the active tab
 * only. The menu opens on CLICK of the trigger and carries Information,
 * Settings, Full screen, Pin to floating and Close. Full screen unmounts
 * the grid instance and mounts the dialog's — one live panel at a time.
 * Pin hands the panel to the floating layer, which removes it from this
 * group entirely.
 *
 * On preset pages built-in tabs are pinned (`isPanelLocked`) while
 * user-added tabs stay fully editable: locked tabs cannot be dragged,
 * closed or floated (their gear still opens settings).
 *
 * The "+" add button sits right after the last tab inside the scrolling
 * strip; overflow is scrolled by a SlimScroll overlay bar (a native
 * browser-sized bar would eat the 1.44rem strip). The whole group is the
 * drop zone for strip-append drops — the strip itself needs no handlers.
 * There is no per-grid layout button: the global one lives in the header
 * (Ctrl/⌘ K → Layout opens the same dialog).
 */

const DRAG_MIME = "application/x-nfi-panel";

interface DragPayload {
  panelId: string;
  sourceTabsId: string;
}

const DragPayloadSchema = Schema.Struct({
  panelId: Schema.String,
  sourceTabsId: Schema.String,
});

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

function readDragPayload(event: React.DragEvent): DragPayload | null {
  if (!event.dataTransfer.types.includes(DRAG_MIME)) return null;

  try {
    const decoded = Schema.decodeUnknownEither(DragPayloadSchema)(
      JSON.parse(event.dataTransfer.getData(DRAG_MIME)),
    );

    if (Either.isRight(decoded)) return decoded.right;
  } catch {
    // Foreign or malformed drag — not ours.
  }

  return null;
}

export function TabGroup({
  node,
  workspace,
  registry,
  onActivatePanel,
  onActivateTab,
  onClosePanel,
  onOpenInto,
  onMovePanel,
  onPinPanel,
  isPanelLocked = () => false,
  locked = false,
}: {
  node: TabsLayoutNode;
  workspace: Workspace;
  registry: WidgetRegistry;
  onActivatePanel: (panelId: string) => void;
  onActivateTab: (tabsId: string, panelId: string) => void;
  onClosePanel: (panelId: string) => void;
  onOpenInto: (tabsId: string, anchor: DOMRect | null) => void;
  onMovePanel: (
    panelId: string,
    targetTabsId: string,
    targetIndex?: number,
  ) => void;
  /** Detach a tab into the floating layer (removes it from this group). */
  onPinPanel?: (panelId: string) => void;
  /** True for pinned tabs (preset built-ins): no drag, no close, no float. */
  isPanelLocked?: (panelId: string) => boolean;
  /** True on read-only surfaces (signed out): add buttons and gears hide
      (tab drag/close/pin stay on `isPanelLocked`). */
  locked?: boolean;
}) {
  const activeId =
    node.activePanelId !== null && node.panels.includes(node.activePanelId)
      ? node.activePanelId
      : (node.panels[0] ?? null);

  // Transient strip interaction (drop indicator, full screen) in ONE
  // local store — the tab state itself lives in the workspace model.
  interface TabInteractionState {
    /** Drop indicator: tab index to insert before, or "end" for append. */
    dropAt: number | "end" | null;
    /** Full-screen state: which panel, plus its cell aspect when captured. */
    fullscreen: { panelId: string; aspect: number } | null;
  }

  const interactionStore = useLocalStore<TabInteractionState>({
    dropAt: null,
    fullscreen: null,
  });

  const dropAt = useStore(interactionStore, (s) => s.dropAt);
  const fullscreen = useStore(interactionStore, (s) => s.fullscreen);

  // Tabpanel elements by panel id — written from ref callbacks, read
  // imperatively (full-screen aspect capture), never subscribed.
  const tabpanelRefsStore = useLocalStore(
    () => new Map<string, HTMLElement | null>(),
  );

  const setDropAt = (dropAt: number | "end" | null): void => {
    interactionStore.setState((prev) => ({ ...prev, dropAt }));
  };

  const openPicker = (event: React.MouseEvent<HTMLElement>) => {
    onOpenInto(node.id, event.currentTarget.getBoundingClientRect());
  };

  const openFullScreen = (panelId: string) => {
    const el = tabpanelRefsStore.state.get(panelId);
    const rect = el?.getBoundingClientRect();

    const aspect =
      rect && rect.width > 0 && rect.height > 0
        ? rect.width / rect.height
        : 16 / 9;

    interactionStore.setState((prev) => ({
      ...prev,
      fullscreen: { panelId, aspect },
    }));
  };

  return (
    <div
      className={
        dropAt !== null ? "nfi-tabgroup nfi-tabgroup-drop" : "nfi-tabgroup"
      }
      role="tablist"
      aria-label="Workspace tab group"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";

        if (dropAt === null || dropAt === "end") setDropAt("end");
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer leaves the whole group (not just a child).
        if (
          !event.currentTarget.contains(
            event.relatedTarget instanceof Node ? event.relatedTarget : null,
          )
        )
          setDropAt(null);
      }}
      onDrop={(event) => {
        const payload = readDragPayload(event);
        setDropAt(null);

        if (!payload) return;
        event.preventDefault();
        onMovePanel(payload.panelId, node.id);
      }}
    >
      <div className="nfi-tabstrip-row">
        {/* Append-drop indicator rides the outer box (same visual footprint
            the strip had); the tabs themselves carry per-tab indicators. */}
        <SlimScroll
          axis="x"
          className={dropAt === "end" ? "nfi-tabstrip-drop" : undefined}
          contentClassName="nfi-tabstrip"
        >
          {node.panels.map((panelId, index) => {
            const instance = workspace.panels[panelId];

            const definition = instance
              ? registry.getWidget(instance.widgetType)
              : undefined;

            // Tooltips always name the WIDGET (renames must not confuse);
            // the visible label prefers the user's custom tab title.
            const widgetName =
              definition?.title ?? instance?.widgetType ?? panelId;

            const label = instance?.title ?? widgetName;
            const renamed = instance?.title !== undefined;
            const selected = panelId === activeId;
            const panelLocked = locked || isPanelLocked(panelId);
            const configurable = definition?.hasSettings === true;

            return (
              <div
                key={panelId}
                role="presentation"
                draggable={panelLocked ? false : true}
                onDragStart={(event) => {
                  if (panelLocked) return;
                  event.dataTransfer.setData(
                    DRAG_MIME,
                    JSON.stringify({ panelId, sourceTabsId: node.id }),
                  );
                  event.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(event) => {
                  if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
                  event.preventDefault();
                  event.stopPropagation();
                  event.dataTransfer.dropEffect = "move";
                  setDropAt(index);
                }}
                onDrop={(event) => {
                  const payload = readDragPayload(event);
                  setDropAt(null);

                  if (!payload) return;
                  event.preventDefault();
                  event.stopPropagation();
                  onMovePanel(payload.panelId, node.id, index);
                }}
                onDragEnd={() => setDropAt(null)}
                className={
                  selected
                    ? "nfi-tab nfi-tab-active"
                    : dropAt === index
                      ? "nfi-tab nfi-tab-drop"
                      : "nfi-tab"
                }
                title={
                  renamed
                    ? `${widgetName} — renamed to “${label}”`
                    : selected || panelLocked
                      ? widgetName
                      : `Drag to move · ${widgetName}`
                }
              >
                <button
                  role="tab"
                  aria-selected={selected}
                  tabIndex={selected ? 0 : -1}
                  className="nfi-tab-button"
                  title={`${widgetName} (${panelId})`}
                  onClick={() => onActivateTab(node.id, panelId)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                      return;
                    event.preventDefault();
                    const nextIndex = node.panels.indexOf(panelId);

                    const next =
                      node.panels[
                        (nextIndex +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          node.panels.length) %
                          node.panels.length
                      ];

                    if (next) {
                      onActivateTab(node.id, next);
                      document
                        .getElementById(`nfi-tab-${node.id}-${next}`)
                        ?.focus();
                    }
                  }}
                  id={`nfi-tab-${node.id}-${panelId}`}
                >
                  <span className="nfi-tab-code">{label}</span>
                </button>
                {!selected ? null : (
                  <TabActionsMenu
                    title={label}
                    panelId={panelId}
                    renamed={renamed}
                    locked={panelLocked}
                    canClose={!panelLocked}
                    canConfigure={configurable && !panelLocked}
                    canPin={!panelLocked && onPinPanel !== undefined}
                    canFullScreen
                    widgetDefinition={definition}
                    widgetConfig={decodeForInfo(
                      definition,
                      instance?.widgetConfig,
                    )}
                    onClosePanel={onClosePanel}
                    onPinPanel={onPinPanel}
                    onFullScreen={openFullScreen}
                  />
                )}
              </div>
            );
          })}
          {locked ? null : (
            <button
              type="button"
              className="nfi-tab-add"
              title="Add widget to this grid"
              aria-label="Add widget to this grid"
              onClick={openPicker}
            >
              <Add size={14} />
            </button>
          )}
        </SlimScroll>
      </div>
      <div className="nfi-tabpanels">
        {node.panels.length === 0 ? (
          <div className="nfi-panel" data-focused="false">
            <div className="nfi-panel-body nfi-empty-group">
              <p>Empty tab group.</p>
              {locked ? null : (
                <Button
                  size="sm"
                  kind="secondary"
                  renderIcon={Add}
                  onClick={openPicker}
                >
                  Open widget here
                </Button>
              )}
            </div>
          </div>
        ) : (
          node.panels.map((panelId) => {
            const instance = workspace.panels[panelId];
            const selected = panelId === activeId;

            // Perf: only the active tab mounts its Panel. Previously every
            // inactive tab stayed mounted (hidden) with a live widget
            // subtree — full decode, full render, full indicator math and a
            // one-shot REST seed per hidden tab — so cost scaled with total
            // open tabs, not visible ones. Hidden tabs re-seed + resubscribe
            // via the live layer on reveal (PanelVisibleContext), so no
            // stale data; only ephemeral widget-local UI state resets.
            if (!selected) {
              return (
                <div
                  key={panelId}
                  role="tabpanel"
                  hidden
                  aria-label={instance?.widgetType ?? panelId}
                  className="nfi-tabpanel"
                />
              );
            }

            return (
              <div
                key={panelId}
                ref={(el) => {
                  tabpanelRefsStore.setState((prev) =>
                    new Map(prev).set(panelId, el),
                  );
                }}
                role="tabpanel"
                aria-label={instance?.widgetType ?? panelId}
                className="nfi-tabpanel"
              >
                {/* Full screen keeps ONE live instance: the dialog mounts
                    the panel while the grid slot sits empty. */}
                {fullscreen?.panelId === panelId ? null : (
                  <PanelVisibleContext.Provider value>
                    <Panel
                      panelId={panelId}
                      widgetType={instance?.widgetType}
                      widgetConfig={instance?.widgetConfig}
                      title={undefined}
                      focused={workspace.activePanelId === panelId}
                      registry={registry}
                      onActivate={onActivatePanel}
                      onClose={onClosePanel}
                      showHeader={false}
                    />
                  </PanelVisibleContext.Provider>
                )}
              </div>
            );
          })
        )}
        {fullscreen
          ? (() => {
              const instance = workspace.panels[fullscreen.panelId];

              const title = instance
                ? (instance.title ??
                  registry.getWidget(instance.widgetType)?.title ??
                  instance.widgetType)
                : fullscreen.panelId;

              return (
                <TabFullScreen
                  title={title}
                  panelId={fullscreen.panelId}
                  widgetType={instance?.widgetType}
                  widgetConfig={instance?.widgetConfig}
                  workspace={workspace}
                  registry={registry}
                  aspect={fullscreen.aspect}
                  onActivate={onActivatePanel}
                  onClosePanel={onClosePanel}
                  onRestore={() =>
                    interactionStore.setState((prev) => ({
                      ...prev,
                      fullscreen: null,
                    }))
                  }
                />
              );
            })()
          : null}
      </div>
    </div>
  );
}
