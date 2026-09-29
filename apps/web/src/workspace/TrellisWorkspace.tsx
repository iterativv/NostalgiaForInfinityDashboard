import { useEffect, useMemo, useRef, type ReactNode } from "react";
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
  type ViewApi,
  type WorkspaceHandle,
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

function viewIdForPanel(panelId: string): string {
  return `view-${panelId}`;
}

function panelIdForViewId(viewId: string): string | null {
  return viewId.startsWith("view-") ? viewId.slice("view-".length) : null;
}

/** Latest canvas-level picker opener (set by TrellisWorkspace each render). */
const trellisCanvasOpener: {
  current: ((anchor: DOMRect | null) => void) | null;
} = { current: null };

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
  const fullscreen = useStore(trellisFullscreenStore, (s) => s);

  useViewTitle(customTitle ?? definition?.title ?? panelId);

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
      onClose={guardedClose}
      showHeader={false}
    />
  );
}

/**
 * Trellis tab-bar chrome for the selected view: the strip "+" (canvas-level
 * add, like the old tab strip's) plus the full tab actions menu. Rendered
 * via `ViewType accessory`, so it sits in the tab bar exactly where the old
 * "+" and "⋯" lived. Module-level (no changing props): everything reactive
 * comes from stores, so it never goes stale even though Trellis reads the
 * initial layout once.
 */
function TrellisTabChrome({
  view,
  registry,
}: {
  view: ViewApi<TrellisWidgetParams>;
  registry: WidgetRegistry;
}) {
  const panelId = view.params.panelId;
  const instance = useStore(
    workspaceStore,
    (s) => s.workspace.panels[panelId],
  );
  const locked = useStore(capabilitiesStore, (s) => !s.authenticated);

  if (!instance) return null;

  const definition: AnyWidgetDefinition | undefined = registry.getWidget(
    instance.widgetType,
  );
  const label = instance.title ?? definition?.title ?? instance.widgetType;

  const openCanvas = (event: { currentTarget: HTMLElement }) => {
    trellisCanvasOpener.current?.(
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

  return (
    <>
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
      />
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

/**
 * Previous NFI/Carbon look for the Trellis chrome, as workspace tokens.
 * Every color points at `var(--cds-*)`, which resolve under the app's
 * Carbon Theme scope — light themes (white/g10) restyle automatically.
 * Shape (square tabs, 23px strip, 8px gaps) matches the old tab strip and
 * bento cards; see the `.nfi-trellis` overrides in `styles.css`.
 */
const NFI_TOKENS: Record<string, string> = {
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
  "--trellis-tabbar-height": "1.4375rem",
  "--trellis-tab-max-width": "12rem",
  "--trellis-tab-inset": "0px",
};

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
  const colorTheme = useStore(prefsStore, (s) => s.colorTheme);

  trellisCanvasOpener.current = onOpenCanvas ?? null;

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
      theme={CARBON_THEMES_DARK.has(colorTheme) ? "dark" : "light"}
      tokens={NFI_TOKENS}
      tabs={{ fill: false, inset: 0 }}
      navigation="focus"
      storageKey={`nfi-trellis-${activePageId}`}
      version={1}
      panelMenu={false}
      className="nfi-trellis"
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
      <ViewType
        id="widget"
        accessory={(view) => (
          <TrellisTabChrome
            view={view as ViewApi<TrellisWidgetParams>}
            registry={registry}
          />
        )}
      >
        <WidgetView registry={registry} />
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
