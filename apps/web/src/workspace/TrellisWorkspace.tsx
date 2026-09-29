import { useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  Panel as TrellisPanel,
  Split as TrellisSplit,
  Stage as TrellisStage,
  View as TrellisView,
  ViewType,
  Workspace,
  useView,
  useViewTitle,
  type WorkspaceHandle,
} from "@danfessler/trellis-react";
import "@danfessler/trellis/style.css";
import { useStore } from "@tanstack/react-store";
import type { LayoutNode, Workspace as NfiWorkspace } from "@nfi/api-contract";
import type { WidgetRegistry } from "@nfi/widget-sdk";
import { Panel } from "./Panel";
import { workspaceStore } from "./store";

/**
 * TrellisWorkspace — layouting migrated to Trellis
 * (https://trellisui.com/docs/quick-start-react).
 *
 * Quick-start steps implemented here:
 * 1. Render a workspace — `<Workspace>` fills `.nfi-workspace-host`.
 * 2. Register view types — single `<ViewType id="widget">`; each view is
 *    one NFI panel (`params: { panelId }`).
 * 3. Describe the initial layout — the current `Workspace.layout` tree is
 *    compiled once (on mount) to `<Split>/<Stage>/<Panel>/<View>`.
 *    After mount the user owns the layout (drag, split, float, zoom).
 * 4. Read view state in content — `WidgetView` uses `useView()` +
 *    `useViewTitle()` and renders the existing `Panel`.
 * 5. Open views — new store panels are opened with `ws.open("widget")`;
 *    content can also use `useWorkspace()` (Trellis keeps views mounted
 *    across docking/tabbing/floating/hiding, so iframes keep sessions).
 * 6. Remember the layout — `storageKey` per page + `version`; bump the
 *    version when the default layout changes.
 */

interface TrellisWidgetParams {
  panelId: string;
}

function viewIdForPanel(panelId: string): string {
  return `view-${panelId}`;
}

function panelIdForViewId(viewId: string): string | null {
  return viewId.startsWith("view-") ? viewId.slice("view-".length) : null;
}

function WidgetView({
  registry,
  onActivatePanel,
  onClosePanel,
}: {
  registry: WidgetRegistry;
  onActivatePanel: (panelId: string) => void;
  onClosePanel: (panelId: string) => void;
}) {
  const view = useView<TrellisWidgetParams>();
  const panelId = view.params.panelId;

  const instance = useStore(
    workspaceStore,
    (s) => s.workspace.panels[panelId],
  );
  const customTitle = instance?.title;
  const definition = instance
    ? registry.getWidget(instance.widgetType)
    : undefined;
  const focused = useStore(
    workspaceStore,
    (s) => s.workspace.activePanelId === panelId,
  );

  useViewTitle(customTitle ?? definition?.title ?? panelId);

  return (
    <Panel
      panelId={panelId}
      widgetType={instance?.widgetType}
      widgetConfig={instance?.widgetConfig}
      title={undefined}
      focused={focused}
      registry={registry}
      onActivate={onActivatePanel}
      onClose={onClosePanel}
      showHeader={false}
    />
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

function toTrellis(node: LayoutNode, workspace: NfiWorkspace): ReactNode {
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
          {toTrellis(node.first, workspace)}
          {toTrellis(node.second, workspace)}
        </TrellisSplit>
      );
    case "grid":
      // Legacy grids migrate to auto on load; a grid reaching Trellis is a
      // stale tree — flatten its cells in reading order into a column.
      if (node.items.length === 0) return null;
      if (node.items.length === 1 && node.items[0])
        return toTrellis(node.items[0].child, workspace);
      return (
        <TrellisSplit axis="y">
          {[...node.items]
            .sort((a, b) => a.row - b.row || a.col - b.col)
            .map((item) => (
              <TrellisSplit axis="x" key={item.id}>
                {toTrellis(item.child, workspace)}
              </TrellisSplit>
            ))}
        </TrellisSplit>
      );
    case "flow":
    case "masonry":
    case "auto": {
      const children = node.items.map((item) => item.child);
      if (children.length === 0) return null;
      if (children.length === 1 && children[0])
        return toTrellis(children[0], workspace);
      // Bento/masonry/flow cards become Trellis panels in a column — Trellis
      // then owns packing via splits, docking, floating and zoom. Exact
      // persisted card geometry (px height, fractional span) stays in the
      // NFI document for a future controlled-layout bridge.
      return (
        <TrellisSplit axis="y">
          {node.items.map((item) => (
            <TrellisSplit axis="x" key={item.id}>
              {toTrellis(item.child, workspace)}
            </TrellisSplit>
          ))}
        </TrellisSplit>
      );
    }
  }
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
  const wsRef = useRef<WorkspaceHandle | null>(null);
  // `isSplitLocked` mirrors `locked` from the shell today (read-only
  // surfaces); Trellis owns its dividers, so both collapse to read-only.
  const readOnly = locked || isSplitLocked;

  const initialLayout = useMemo(
    () => toTrellis(workspace.layout, workspace),
    // Compiled once per page (Trellis reads JSX layout on mount only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activePageId],
  );

  // Bridge store → Trellis: panels opened via the picker/palette/command
  // (store ops) are opened as Trellis views; panels closed in the store are
  // closed in Trellis. Trellis-owned moves (drag/split/float) persist via
  // `storageKey` and need no store round-trip.
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws) return;
    let cancelled = false;
    // Wait a frame so Trellis has mounted its initial layout.
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const handle = wsRef.current;
      if (!handle) return;
      try {
        const snapshot = handle.getSnapshot();
        const existing = new Set(snapshot.views.map((v) => v.id));
        for (const panelId of Object.keys(workspace.panels)) {
          const viewId = viewIdForPanel(panelId);
          if (!existing.has(viewId)) {
            handle.open("widget", {
              id: viewId,
              params: { panelId } satisfies TrellisWidgetParams,
              focus: false,
            });
          }
        }
        for (const view of snapshot.views) {
          if (view.type !== "widget") continue;
          const params = view.params as Partial<TrellisWidgetParams> | undefined;
          const panelId =
            typeof params?.panelId === "string"
              ? params.panelId
              : panelIdForViewId(view.id);
          if (panelId && !(panelId in workspace.panels)) {
            void handle.close(view.id, { force: true });
          }
        }
      } catch {
        // Trellis not ready yet — next panels commit retries.
      }
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspace.panels]);

  return (
    <Workspace
      ref={wsRef}
      theme="dark"
      navigation="focus"
      storageKey={`nfi-trellis-${activePageId}`}
      version={1}
      panelMenu={!readOnly}
      onFocus={(viewId) => {
        if (viewId === null) return;
        const ws = wsRef.current;
        const params = ws
          ?.getSnapshot()
          .views.find((v) => v.id === viewId)?.params as
          | Partial<TrellisWidgetParams>
          | undefined;
        const panelId =
          typeof params?.panelId === "string"
            ? params.panelId
            : panelIdForViewId(viewId);
        if (panelId) {
          onActivatePanel(panelId);
          onActivateTab(viewId, panelId);
        }
      }}
      onClose={(view) => {
        const params = view.params as Partial<TrellisWidgetParams> | undefined;
        const panelId =
          typeof params?.panelId === "string"
            ? params.panelId
            : panelIdForViewId(view.id);
        if (panelId && panelId in workspace.panels) onClosePanel(panelId);
      }}
    >
      <ViewType id="widget">
        <WidgetView
          registry={registry}
          onActivatePanel={onActivatePanel}
          onClosePanel={onClosePanel}
        />
      </ViewType>

      <TrellisStage
        empty={
          <div className="nfi-panel" data-focused="false">
            <div className="nfi-panel-body nfi-empty-group">
              <p>No widgets yet.</p>
              {readOnly || !onOpenCanvas ? null : (
                <button
                  type="button"
                  className="cds--btn cds--btn--secondary cds--btn--sm"
                  onClick={(event) =>
                    onOpenCanvas(
                      event.currentTarget.getBoundingClientRect(),
                    )
                  }
                >
                  Add widget
                </button>
              )}
            </div>
          </div>
        }
      >
        {initialLayout}
      </TrellisStage>

      <Workspace.Empty>
        <div className="nfi-panel" data-focused="false">
          <div className="nfi-panel-body nfi-empty-group">
            <p>Workspace is empty.</p>
            {readOnly || !onOpenCanvas ? null : (
              <button
                type="button"
                className="cds--btn cds--btn--secondary cds--btn--sm"
                onClick={(event) =>
                  onOpenCanvas(event.currentTarget.getBoundingClientRect())
                }
              >
                Add widget
              </button>
            )}
          </div>
        </div>
      </Workspace.Empty>
    </Workspace>
  );
}

// Re-exported for tests/docs: stable Trellis view id for an NFI panel.
export { viewIdForPanel };
