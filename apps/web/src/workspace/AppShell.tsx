// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Loading } from "@carbon/react";
import {
  Dashboard,
  Search,
  SidePanelClose,
  SidePanelOpen,
} from "@carbon/icons-react";
import {
  canEnableWidget,
  findFirstTabs,
  findTabsWithPanel,
} from "@nfi/widget-sdk";
import {
  capabilitiesStore,
  hydrateCapabilities,
  useCapabilities,
} from "../auth/capabilities";
import { useFirstRunGate } from "../auth/firstRun";
import { hydrateSensitivity } from "../capabilities/sensitivity";
import { widgetRegistry } from "./registry";
import { buildCommands } from "./commands";
import { WorkspaceRenderer } from "./WorkspaceRenderer";
import { WidgetPicker } from "./WidgetPicker";
import { AddPageDialog } from "./AddPageDialog";
import { AppAside } from "./AppAside";
import { LayoutsDialog } from "./LayoutsDialog";
import { SettingsDialog } from "./SettingsDialog";
import { PagesBar } from "./PagesBar";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { FloatingTabsLayer } from "./FloatingTabsLayer";
import { useViewportSize } from "./GridPreview";
import { DialogHost, requestConfirm, requestPrompt } from "@nfi/widgets";
import { WidgetCtaContext } from "@nfi/ui";
import { consumeTerminalIntent } from "./terminalIntent";
import { openInstanceConnections } from "./credentialsFix";
import { presetAspectBand, type PresetAspectBand } from "./pages";
import { isHomePageId, isPresetBuiltInPanel, isPresetPageId } from "./pages";
import {
  activateWorkspacePanel,
  activateWorkspaceTab,
  closeFloatingTab,
  closeWorkspacePanel,
  deletePage,
  dockFloatingTab,
  hydrateWorkspace,
  moveWorkspacePanel,
  openWidgetPanel,
  pinTabToFloating,
  renameCustomPage,
  resizeWorkspaceGridTracks,
  resizeWorkspaceSplit,
  setWorkspaceAspectBand,
  switchActivePage,
  workspaceStore,
} from "./store";

/**
 * AppShell — global application infrastructure:
 *
 * ```text
 * ┌──────────────────────────────────────────────────────────────┐
 * │ NFI Desk · Home Trading … (+ Add) · ⌕ ▦ ⫸ menu               │
 * ├──────────────────────────────────────────┬───────────────────┤
 * │                         WORKSPACE        │  Aside (toggle)   │
 * │              (tab grids; "+" opens       │  manage users     │
 * │               the widget picker)         │  settings · freq- │
 * ├──────────────────────────────────────────┤  trade connection │
 * │ Status Bar                               │  account          │
 * └──────────────────────────────────────────┴───────────────────┘
 * ```
 *
 * The page menu lives in the main header; its "+" opens the Add-page
 * dialog (curated presets + custom pages with an optional icon). Search
 * and grid-layout stay as header icon actions; the side-panel toggle at
 * the far right opens the AppAside drawer — manage users, settings, the
 * freqtrade instance connections entry and the account block live there.
 * Ctrl/⌘ K still opens the command palette directly.
 *
 * SHARED FRAME: off-terminal pages (/users) pass `children` and get the
 * exact same chrome; page-level actions (switch/add page, layouts,
 * freqtrade connections) navigate back to "/" so their effect is
 * visible. The shell owns NO widget knowledge: the
 * palette resolves commands, the picker resolves widget types, and the
 * renderer resolves widget types through the registry.
 */

interface PickerTarget {
  tabsId: string;
  anchor: DOMRect | null;
}

// Stable CTA value — the handler reads stores imperatively, no closures.
const WIDGET_CTA = { fixCredentials: () => void openInstanceConnections() };

export function AppShell({
  children,
}: {
  /**
   * Main-area content for off-terminal pages (/users) — omitted on the
   * terminal itself, where the workspace renderer fills the area. The
   * whole chrome (pages bar, header actions, aside, status bar, palette,
   * dialogs) is identical everywhere.
   */
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const state = useStore(workspaceStore, (s) => s);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<PickerTarget | null>(null);
  // Add-page dialog (pages bar "+"): presets + custom page with icon.
  const [addPageOpen, setAddPageOpen] = useState(false);
  // Aside drawer (header toggle): search/layout/settings/connections/account.
  const [asideOpen, setAsideOpen] = useState(false);
  const asideToggleRef = useRef<HTMLButtonElement>(null);
  // Layouts dialog target: the grid (tab group) being customized, if any.
  const [layoutsFor, setLayoutsFor] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { workspace, pages, activePageId, status, detail, backendAvailable } =
    state;

  // Pinned built-in tabs (preset pages) cannot be dragged or closed;
  // every other tab — including tabs added to a preset page — is normal.
  const isPanelLocked = useCallback(
    (panelId: string) => isPresetBuiltInPanel(activePageId, panelId),
    [activePageId],
  );

  const viewport = useViewportSize();

  // Aspect band for preset curation: crossing a band (moving the window to
  // a monitor with a different ratio) re-curates the active preset page.
  useEffect(() => {
    setWorkspaceAspectBand(
      presetAspectBand(viewport.width / Math.max(1, viewport.height)),
    );
  }, [viewport.width, viewport.height]);

  // Global layouts target: the active panel's grid, else the first group.
  const openLayouts = useCallback(() => {
    setPickerFor(null);
    setPaletteOpen(false);
    const current = workspaceStore.state.workspace;
    const anchor =
      (current.activePanelId
        ? findTabsWithPanel(current.layout, current.activePanelId)
        : undefined) ?? findFirstTabs(current.layout);
    if (anchor) setLayoutsFor(anchor.id);
  }, []);

  const capabilities = useCapabilities();
  // First-run gate: an unprovisioned root or a freqtrade-less deployment
  // redirects to its setup screen (see `auth/firstRun.ts`).
  useFirstRunGate();
  const commands = useMemo(
    () =>
      buildCommands(widgetRegistry, {
        // Palette entry arranges the active grid — the same dialog the
        // header layout button opens.
        onArrange: openLayouts,
      }),
    [openLayouts],
  );

  // Widget commands the caller cannot use stay VISIBLE in the palette but
  // inert (dimmed + "not permitted") — same discoverability rule as the
  // widget picker. The command's run() enforces the same grant.
  const isCommandDisabled = useMemo(() => {
    const granted = capabilitiesStore.state.granted;
    return (command: { id: string }) => {
      if (!command.id.startsWith("widget.open.")) return false;
      const type = command.id.slice("widget.open.".length);
      const definition = widgetRegistry.getWidget(type);
      return definition ? !canEnableWidget(definition, granted) : true;
    };
    // Recompute when the granted set changes (auth switch / hydration).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capabilities.granted]);

  useEffect(() => {
    void hydrateCapabilities();
    void hydrateSensitivity();
    void hydrateWorkspace();
    // Off-terminal pages (manage users) mirror this header — honor a pending
    // search request after navigating back here. Grid customize lives in the
    // header (and Ctrl/⌘ K → Layout), so no layouts intent remains.
    if (consumeTerminalIntent() === "palette") {
      setPickerFor(null);
      setPaletteOpen(true);
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPickerFor(null);
        setPaletteOpen((open) => !open);
      } else if (event.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runCommand = (commandId: string) => commands.runCommand(commandId);

  const pickWidget = (widgetType: string) => {
    if (!pickerFor) return;
    const definition = widgetRegistry.getWidget(widgetType);
    if (!definition) return;
    if (!canEnableWidget(definition, capabilitiesStore.state.granted)) return;
    openWidgetPanel(
      widgetType,
      structuredClone(definition.defaultConfig),
      { targetTabsId: pickerFor.tabsId },
      definition.capabilities,
    );
    setPickerFor(null);
  };

  const pickerOpenTypes = useMemo(() => {
    if (!pickerFor) return new Set<string>();
    const panels = workspace.panels;
    const collect = (ids: ReadonlyArray<string>): Set<string> => {
      const out = new Set<string>();
      for (const id of ids) {
        const type = panels[id]?.widgetType;
        if (type) out.add(type);
      }
      return out;
    };
    // Types open in the target grid (any group shares the picker's dedupe).
    const visit = (node: typeof workspace.layout): string[] => {
      if (node.type === "panel") return [node.panelId];
      if (node.type === "tabs")
        return node.id === pickerFor.tabsId ? [...node.panels] : [];
      if (node.type === "grid")
        return node.items.flatMap((item) => visit(item.child));
      return [...visit(node.first), ...visit(node.second)];
    };
    return collect(visit(workspace.layout));
  }, [pickerFor, workspace]);

  const handleNewPage = () => {
    setPickerFor(null);
    setPaletteOpen(false);
    setAddPageOpen(true);
  };

  const handleDeletePage = (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page || page.home || isHomePageId(pageId)) return;
    void requestConfirm({
      title: `Delete "${page.name}"?`,
      message: page.preset
        ? "Its added tabs will be discarded; the preset stays available in the Add-page dialog."
        : "Its tabs and grid will be discarded.",
      confirmLabel: "Delete",
      danger: true,
    }).then((confirmed) => {
      if (confirmed) void deletePage(pageId);
    });
  };

  const handleRenamePage = (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    if (!page || page.preset) return;
    void requestPrompt({
      title: "Rename page",
      label: "Page name",
      initialValue: page.name,
      confirmLabel: "Rename",
    }).then((name) => {
      if (name !== null) renameCustomPage(pageId, name);
    });
  };

  const panelCount = Object.keys(workspace.panels).length;
  // Preset pages keep a fixed grid — dividers are locked (no drag/resize).
  const isSplitLocked = isPresetPageId(activePageId);

  const openPalette = () => {
    setPickerFor(null);
    setPaletteOpen(true);
  };

  // Aside actions — each closes the drawer, then opens its surface.
  const asideSettings = () => {
    setPickerFor(null);
    setPaletteOpen(false);
    setSettingsOpen(true);
  };
  const asideConnections = () => {
    ensureTerminal();
    void openInstanceConnections();
  };
  const closeAside = () => {
    setAsideOpen(false);
    asideToggleRef.current?.focus();
  };

  // Off-terminal pages share this shell; page-level actions must land the
  // user back on the terminal to be visible.
  const ensureTerminal = () => {
    if (window.location.pathname !== "/") void navigate({ to: "/" });
  };
  const switchPage = (pageId: string) => {
    switchActivePage(pageId);
    ensureTerminal();
  };
  const layoutsWithTerminal = () => {
    ensureTerminal();
    openLayouts();
  };

  if (status === "loading") {
    // Carbon's global overlay loading: fixed, full-screen, centered spinner.
    return (
      <Loading
        active
        withOverlay
        description="Loading workspace…"
        aria-label="Loading workspace"
      />
    );
  }

  return (
    <WidgetCtaContext.Provider value={WIDGET_CTA}>
      <div className="nfi-shell">
        <div className="nfi-topbar">
          <span className="nfi-topbar-brand" title="NFI Desk">
            NFI Desk
          </span>
          <PagesBar
            pages={pages}
            activePageId={activePageId}
            onSwitch={switchPage}
            onNew={handleNewPage}
            onDelete={handleDeletePage}
            onRename={handleRenamePage}
          />
          <div className="nfi-topbar-actions">
            <button
              type="button"
              className="nfi-topbar-button"
              aria-label={`Search commands in ${workspace.name} (Ctrl or Command K)`}
              title={`Search commands in ${workspace.name} (Ctrl or Command K)`}
              onClick={openPalette}
            >
              <Search size={16} />
            </button>
            <button
              type="button"
              className="nfi-topbar-button"
              aria-label="Change grid layout of the active grid"
              title={
                isSplitLocked
                  ? "Layout is fixed on preset pages — a custom page's grids are editable"
                  : "Change grid layout (Ctrl or Command K → Layout)"
              }
              onClick={layoutsWithTerminal}
              disabled={isSplitLocked}
            >
              <Dashboard size={16} />
            </button>
            <button
              ref={asideToggleRef}
              type="button"
              className="nfi-topbar-button"
              aria-label={asideOpen ? "Close menu" : "Open menu"}
              aria-expanded={asideOpen}
              aria-controls="nfi-aside"
              title="Settings, freqtrade connections and account"
              onClick={() => setAsideOpen((open) => !open)}
            >
              {asideOpen ? (
                <SidePanelClose size={16} />
              ) : (
                <SidePanelOpen size={16} />
              )}
            </button>
          </div>
        </div>
        <div className="nfi-shell-main">
          <main className="nfi-workspace-host" aria-label="Workspace">
            {children ?? (
              <WorkspaceRenderer
                workspace={workspace}
                registry={widgetRegistry}
                onActivatePanel={activateWorkspacePanel}
                onActivateTab={activateWorkspaceTab}
                onClosePanel={closeWorkspacePanel}
                onResizeSplit={resizeWorkspaceSplit}
                onTracksChange={resizeWorkspaceGridTracks}
                onOpenInto={(tabsId, anchor) => {
                  setPaletteOpen(false);
                  setPickerFor({ tabsId, anchor });
                }}
                onMovePanel={(panelId, targetTabsId, targetIndex) => {
                  moveWorkspacePanel(panelId, targetTabsId, targetIndex);
                }}
                onPinPanel={pinTabToFloating}
                isPanelLocked={isPanelLocked}
                isSplitLocked={isSplitLocked}
              />
            )}
          </main>
        </div>
        <FloatingTabsLayer
          pageId={activePageId}
          registry={widgetRegistry}
          onDock={dockFloatingTab}
          onClose={closeFloatingTab}
        />
        <StatusBar
          workspaceName={workspace.name}
          workspaceVersion={workspace.version}
          activePanel={workspace.activePanelId}
          panelCount={panelCount}
          status={status}
          detail={detail}
          backendAvailable={backendAvailable}
        />
        {paletteOpen ? (
          <CommandPalette
            commands={commands.listCommands()}
            isDisabled={isCommandDisabled}
            onRun={runCommand}
            onClose={() => {
              setPaletteOpen(false);
            }}
          />
        ) : null}
        {pickerFor ? (
          <WidgetPicker
            registry={widgetRegistry}
            openWidgetTypes={pickerOpenTypes}
            anchor={pickerFor.anchor}
            onPick={pickWidget}
            onClose={() => setPickerFor(null)}
          />
        ) : null}
        {layoutsFor ? (
          <LayoutsDialog
            tabsId={layoutsFor}
            onClose={() => setLayoutsFor(null)}
          />
        ) : null}
        {addPageOpen ? (
          <AddPageDialog onClose={() => setAddPageOpen(false)} onAdded={ensureTerminal} />
        ) : null}
        {settingsOpen ? (
          <SettingsDialog onClose={() => setSettingsOpen(false)} />
        ) : null}
        <AppAside
          open={asideOpen}
          onClose={closeAside}
          onSettings={asideSettings}
          onConnections={asideConnections}
        />
        <DialogHost />
      </div>
    </WidgetCtaContext.Provider>
  );
}
