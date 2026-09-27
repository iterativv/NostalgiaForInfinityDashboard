// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Loading } from "@carbon/react";
import { Search } from "@carbon/icons-react";
import { canEnableWidget } from "@nfi/widget-sdk";
import {
  shallow,
  useDerived,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";
import { capabilitiesStore, hydrateCapabilities } from "../auth/capabilities";
import { effectiveGranted, viewAsStore } from "../auth/viewAs";
import { useFirstRunGate } from "../auth/firstRun";
import { hydrateSensitivity } from "../capabilities/sensitivity";
import { widgetRegistry } from "./registry";
import {
  fetchPageDefaultsFor,
  filterVisiblePages,
  hydratePageDefaults,
} from "./pageDefaults";
import { UserMenu, ViewAsBanner } from "./UserMenu";
import { buildCommands } from "./commands";
import { WorkspaceRenderer } from "./WorkspaceRenderer";
import { WidgetPicker } from "./WidgetPicker";
import { AddPageDialog } from "./AddPageDialog";
import { PagesBar } from "./PagesBar";
import { PageShareMenu } from "./PageShareMenu";
import { StatusBar } from "./StatusBar";
import { CommandPalette } from "./CommandPalette";
import { FloatingTabsLayer } from "./FloatingTabsLayer";
import { DialogHost, requestConfirm, requestPrompt } from "@nfi/widgets";
import { WidgetCtaContext } from "@nfi/ui";
import { consumeTerminalIntent } from "./terminalIntent";
import { openInstanceConnections } from "./credentialsFix";
import { buildPositionSearch } from "./urlState";
import { HOME_PAGE_ID, isHomePageId } from "./pages";
import { WorkspaceErrorBoundary } from "./WorkspaceErrorBoundary";
import {
  activateWorkspacePanel,
  activateWorkspaceTab,
  closeFloatingTab,
  closeWorkspacePanel,
  deletePage,
  dockFloatingTab,
  hydrateWorkspace,
  moveWorkspaceAutoItem,
  moveWorkspacePanel,
  openWidgetPanel,
  pinTabToFloating,
  renameCustomPage,
  resetPageById,
  resetWorkspaceLayout,
  resizeWorkspaceAutoItem,
  resizeWorkspaceFlowItem,
  resizeWorkspaceMasonryItem,
  switchActivePage,
  workspaceStore,
} from "./store";

/**
 * AppShell — global application infrastructure:
 *
 * ```text
 * ┌──────────────────────────────────────────────────────────────┐
 * │ NFI Desk · Home Trading … (+ Add) · ⌕ ▦ ⫸ 👤                 │
 * ├──────────────────────────────────────────────────────────────┤
 * │                         WORKSPACE                            │
 * │              (tab grids; "+" opens                          │
 * │               the widget picker)                             │
 * ├──────────────────────────────────────────────────────────────┤
 * │ Status Bar                                                   │
 * └──────────────────────────────────────────────────────────────┘
 * ```
 *
 * The page menu lives in the main header; its "+" opens the Add-page
 * dialog (curated presets + custom pages with an optional icon). Search
 * and grid-layout stay as header icon actions; the account icon at the
 * far right opens the user menu (identity, view-as preview picker,
 * settings, sign out) — the aside drawer it replaces is gone.
 * Ctrl/⌘ K still opens the command palette directly.
 *
 * SHARED FRAME: off-terminal pages (/users, /instances) pass `children`
 * and get the exact same chrome; page-level actions (switch/add page,
 * layouts) navigate back to "/" so their effect is
 * visible. The shell owns NO widget knowledge: the
 * palette resolves commands, the picker resolves widget types, and the
 * renderer resolves widget types through the registry.
 */

/**
 * Picker target: the tab group to open into ("+"), or null for a
 * CANVAS-level open (the bento pane's add affordance) — a null target
 * appends a fresh card on auto pages instead of tabbing into a group.
 */
interface PickerTarget {
  tabsId: string | null;
  anchor: DOMRect | null;
}

// Stable CTA value — the handler reads stores imperatively, no closures.
const WIDGET_CTA = { fixCredentials: () => void openInstanceConnections() };

// Palette commands are registry-static (the registry is a module singleton):
// built once at module scope, not per shell mount.
const COMMANDS = buildCommands(widgetRegistry);

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
  // Narrow selectors: the shell used to subscribe to the whole store
  // (`(s) => s`), so every persist-status tick (`saving` → `saved`,
  // `lastSavedAt` churn) re-rendered the entire grid tree at pointer/resize
  // frequency. Each field below re-renders only when it actually changes.
  const workspace = useStore(workspaceStore, (s) => s.workspace);
  const pages = useStore(workspaceStore, (s) => s.pages);
  const activePageId = useStore(workspaceStore, (s) => s.activePageId);
  const status = useStore(workspaceStore, (s) => s.status);
  const detail = useStore(workspaceStore, (s) => s.detail);
  const backendAvailable = useStore(workspaceStore, (s) => s.backendAvailable);

  // Shell overlays share one store — their open/close handlers always clear
  // one surface while opening another (exactly one layer at a time).
  interface ShellOverlayState {
    paletteOpen: boolean;
    pickerFor: PickerTarget | null;
    // Add-page dialog (pages bar "+"): custom page with icon.
    addPageOpen: boolean;
  }

  const overlayStore = useLocalStore<ShellOverlayState>({
    paletteOpen: false,
    pickerFor: null,
    // Add-page dialog (pages bar "+"): custom page with icon.
    addPageOpen: false,
  });

  const paletteOpen = useStore(overlayStore, (s) => s.paletteOpen);
  const pickerFor = useStore(overlayStore, (s) => s.pickerFor);
  const addPageOpen = useStore(overlayStore, (s) => s.addPageOpen);

  // The shell is shared by the terminal and the off-terminal pages
  // (/settings, /public, …). Page-level chrome (active page highlight,
  // floating tab windows) belongs to the TERMINAL only — while a settings
  // route is in view nothing in the header may look "active" and no
  // floating window may hover over the form surface.
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const onTerminal = pathname === "/";

  // Signed-out visitors are read-only: no tab drag/close/pin, no card
  // grips or handles, no adds, no renames, no palette. Signed-in preview
  // (view-as) stays fully editable — its persistence is staged instead.
  const authenticated = useStore(capabilitiesStore, (s) => s.authenticated);
  const readOnly = !authenticated;
  const isPanelLocked = () => readOnly;

  // Capability gating follows the view-as preview while one is active (the
  // backend still enforces the real grant — see `auth/viewAs.ts`). Store
  // reads inlined from `auth/viewAs`'s helper — same selectors.
  const viewAsTarget = useStore(viewAsStore, (s) => s.targetUserId);
  const viewAsGrant = useStore(viewAsStore, (s) => s.targetGranted);
  const ownGrant = useStore(capabilitiesStore, (s) => s.granted);

  const effectiveGrant =
    viewAsTarget !== null && viewAsGrant !== null ? viewAsGrant : ownGrant;

  // First-run gate: an unprovisioned root or a freqtrade-less deployment
  // redirects to its setup screen (see `auth/firstRun.ts`).
  useFirstRunGate();

  // Widget commands the caller cannot use stay VISIBLE in the palette but
  // inert (dimmed + "not permitted") — same discoverability rule as the
  // widget picker. The command's run() enforces the same grant.
  // Recomputed when the granted set changes (auth switch / hydration).
  const isCommandDisabled = useDerived(
    [effectiveGrant] as const,
    ([granted]) =>
      (command: { id: string }) => {
        if (!command.id.startsWith("widget.open.")) return false;
        const type = command.id.slice("widget.open.".length);
        const definition = widgetRegistry.getWidget(type);

        return definition ? !canEnableWidget(definition, granted) : true;
      },
    { inputs: shallow },
  );

  // Preview page visibility for the view-as target (their configured list,
  // else every page). Null while loading or when previewing self.
  const previewVisibleStore = useLocalStore<ReadonlyArray<string> | null>(null);
  const previewVisible = useStore(previewVisibleStore, (s) => s);

  useStoreEffect(() => {
    if (viewAsTarget === null) {
      previewVisibleStore.setState(() => null);

      return;
    }

    let cancelled = false;
    void fetchPageDefaultsFor(viewAsTarget).then((scoped) => {
      if (!cancelled)
        previewVisibleStore.setState(
          () => scoped?.defaults?.visiblePageIds ?? null,
        );
    });

    return () => {
      cancelled = true;
    };
  }, [viewAsTarget]);

  useStoreEffect(() => {
    // Boot order matters: the grant first, then page defaults (landing page
    // other than Home), then the workspace (which consumes the defaults).
    void (async () => {
      await hydrateCapabilities();
      await Promise.allSettled([hydrateSensitivity(), hydratePageDefaults()]);
      await hydrateWorkspace();
    })();

    // Off-terminal pages (manage users) mirror this header — honor a pending
    // search request after navigating back here. Grid customize lives in the
    // header (and Ctrl/⌘ K → Layout), so no layouts intent remains.
    if (consumeTerminalIntent() === "palette") {
      overlayStore.setState((p) => ({
        ...p,
        pickerFor: null,
        paletteOpen: true,
      }));
    }
  }, []);

  useStoreEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;

      // The palette only offers mutating commands: signed-out visitors
      // never open it. Read imperatively (empty deps) so sign-in/out flips
      // the gate without rebinding.
      if (mod && event.key.toLowerCase() === "k") {
        if (!capabilitiesStore.state.authenticated) return;
        event.preventDefault();
        overlayStore.setState((p) => ({
          ...p,
          pickerFor: null,
          paletteOpen: !p.paletteOpen,
        }));
      } else if (event.key === "Escape") {
        overlayStore.setState((p) => ({ ...p, paletteOpen: false }));
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const runCommand = (commandId: string) => COMMANDS.runCommand(commandId);

  const pickWidget = (widgetType: string) => {
    if (readOnly || !pickerFor) return;
    const definition = widgetRegistry.getWidget(widgetType);

    if (!definition) return;

    if (!canEnableWidget(definition, effectiveGranted())) return;
    openWidgetPanel(
      widgetType,
      structuredClone(definition.defaultConfig),
      // Canvas-level opens (bento add affordance) carry NO tab target, so
      // the store appends a fresh card instead of tabbing into a group.
      pickerFor.tabsId !== null ? { targetTabsId: pickerFor.tabsId } : {},
      definition.capabilities,
    );
    overlayStore.setState((p) => ({ ...p, pickerFor: null }));
  };

  // Widget types already open in the picker's target group (dedupe); an
  // empty set for canvas-level opens and while no picker is up.
  const pickerOpenTypes = useDerived(
    [pickerFor, workspace] as const,
    ([target, ws]) => {
      if (!target || target.tabsId === null) return new Set<string>();
      const panels = ws.panels;

      const collect = (ids: ReadonlyArray<string>): Set<string> => {
        const out = new Set<string>();

        for (const id of ids) {
          const type = panels[id]?.widgetType;

          if (type) out.add(type);
        }

        return out;
      };

      // Types open in the target group (any group shares the picker's dedupe).
      const visit = (node: typeof ws.layout): string[] => {
        if (node.type === "panel") return [node.panelId];

        if (node.type === "tabs")
          return node.id === target.tabsId ? [...node.panels] : [];

        if (node.type === "grid") return [];

        if (node.type === "flow")
          return node.items.flatMap((item) => visit(item.child));

        if (node.type === "masonry")
          return node.items.flatMap((item) => visit(item.child));

        if (node.type === "auto")
          return node.items.flatMap((item) => visit(item.child));

        return [...visit(node.first), ...visit(node.second)];
      };

      return collect(visit(ws.layout));
    },
    { inputs: shallow },
  );

  const handleNewPage = () => {
    if (readOnly) return;
    overlayStore.setState((p) => ({
      ...p,
      pickerFor: null,
      paletteOpen: false,
      addPageOpen: true,
    }));
  };

  const handleDeletePage = (pageId: string) => {
    if (readOnly) return;
    const page = pages.find((p) => p.id === pageId);

    if (!page || page.home || isHomePageId(pageId)) return;
    void requestConfirm({
      title: `Delete "${page.name}"?`,
      message: "Its tabs and cards will be discarded.",
      confirmLabel: "Delete",
      danger: true,
    }).then((confirmed) => {
      if (confirmed) void deletePage(pageId);
    });
  };

  const handleRenamePage = (pageId: string) => {
    if (readOnly) return;
    const page = pages.find((p) => p.id === pageId);

    if (!page) return;
    void requestPrompt({
      title: "Rename page",
      label: "Page name",
      initialValue: page.name,
      confirmLabel: "Rename",
    }).then((name) => {
      if (name !== null) renameCustomPage(pageId, name);
    });
  };

  const handleResetPage = (pageId: string) => {
    if (readOnly) return;
    const page = pages.find((p) => p.id === pageId);

    if (!page) return;
    void requestConfirm({
      title: `Reset "${page.name}"?`,
      message:
        "Any widget or layout modification on this page will be discarded and its canonical layout restored.",
      confirmLabel: "Reset",
      danger: true,
    }).then((confirmed) => {
      if (confirmed) resetPageById(pageId);
    });
  };

  const panelCount = Object.keys(workspace.panels).length;

  // Signed-out visitors are read-only: card grips/handles hide and every
  // mutation below no-ops. Signed-in pages (including view-as previews)
  // stay fully editable.
  const isSplitLocked = readOnly;

  const activePageName =
    pages.find((page) => page.id === activePageId)?.name ?? workspace.name;

  const openPalette = () => {
    overlayStore.setState((p) => ({
      ...p,
      pickerFor: null,
      paletteOpen: true,
    }));
  };

  // Off-terminal pages share this shell; page-level actions must land the
  // user back on the terminal to be visible. The navigation carries the
  // shareable position so the landing URL is already a deep link (the sync
  // hook keeps it exact afterwards).
  const ensureTerminal = () => {
    if (window.location.pathname !== "/") {
      const current = workspaceStore.state;
      void navigate({
        to: "/",
        search: buildPositionSearch(
          current.activePageId,
          current.workspace.activePanelId,
        ),
      });
    }
  };

  const switchPage = (pageId: string) => {
    switchActivePage(pageId);
    ensureTerminal();
  };

  const goHome = () => {
    switchActivePage(HOME_PAGE_ID);
    ensureTerminal();
  };

  if (status === "loading") {
    // First-run overlay: our own full-screen layer (Carbon's overlay styles
    // are bypassed) with a chromeless spinner — see `.nfi-loading-overlay`.
    return (
      <div
        className="nfi-loading-overlay"
        role="status"
        aria-label="Loading workspace"
      >
        <Loading
          active
          withOverlay={false}
          description="Loading workspace…"
          aria-label="Loading workspace"
        />
      </div>
    );
  }

  // View-as preview filters the pages bar to the target's configured
  // visible pages (self = every page). The active page stays switchable even
  // when filtered out.
  const displayPages =
    previewVisible === null ? pages : filterVisiblePages(pages, previewVisible);

  return (
    <WidgetCtaContext.Provider value={WIDGET_CTA}>
      <div className="nfi-shell">
        <div className="nfi-topbar">
          <span className="nfi-topbar-brand" title="NFI Desk">
            NFI Desk
          </span>
          <PagesBar
            pages={displayPages}
            activePageId={activePageId}
            // Off-terminal pages keep the pages bar visible (to jump back)
            // but NO page reads as active — the highlighted page is a
            // workspace position, not a route (bug: "Home" glowed while the
            // user was on /settings).
            terminalActive={onTerminal}
            onSwitch={switchPage}
            onNew={handleNewPage}
            onDelete={handleDeletePage}
            onRename={handleRenamePage}
            onReset={handleResetPage}
            locked={readOnly}
          />
          <div className="nfi-topbar-actions">
            {readOnly ? null : (
              <button
                type="button"
                className="nfi-topbar-button"
                aria-label={`Search commands in ${workspace.name} (Ctrl or Command K)`}
                title={`Search commands in ${workspace.name} (Ctrl or Command K)`}
                onClick={openPalette}
              >
                <Search size={16} />
              </button>
            )}
            <PageShareMenu pageName={activePageName} />
            <UserMenu />
          </div>
        </div>
        <ViewAsBanner />
        <WorkspaceErrorBoundary
          pageId={activePageId}
          pageName={activePageName}
          onHome={goHome}
          onReset={() => {
            if (!readOnly) resetWorkspaceLayout();
          }}
        >
          <div className="nfi-shell-main">
            <main className="nfi-workspace-host" aria-label="Workspace">
              {children ?? (
                <WorkspaceRenderer
                  workspace={workspace}
                  registry={widgetRegistry}
                  onActivatePanel={activateWorkspacePanel}
                  onActivateTab={activateWorkspaceTab}
                  onClosePanel={(panelId) => {
                    if (!readOnly) closeWorkspacePanel(panelId);
                  }}
                  onFlowItemResize={resizeWorkspaceFlowItem}
                  onMasonryItemResize={resizeWorkspaceMasonryItem}
                  onAutoItemResize={resizeWorkspaceAutoItem}
                  onAutoItemMove={moveWorkspaceAutoItem}
                  onOpenInto={(tabsId, anchor) => {
                    if (readOnly) return;
                    overlayStore.setState((p) => ({
                      ...p,
                      paletteOpen: false,
                      pickerFor: { tabsId, anchor },
                    }));
                  }}
                  onOpenCanvas={(anchor) => {
                    if (readOnly) return;
                    overlayStore.setState((p) => ({
                      ...p,
                      paletteOpen: false,
                      pickerFor: { tabsId: null, anchor },
                    }));
                  }}
                  onMovePanel={(panelId, targetTabsId, targetIndex) => {
                    if (readOnly) return;
                    moveWorkspacePanel(panelId, targetTabsId, targetIndex);
                  }}
                  onPinPanel={readOnly ? undefined : pinTabToFloating}
                  isPanelLocked={isPanelLocked}
                  isSplitLocked={isSplitLocked}
                  locked={readOnly}
                />
              )}
            </main>
          </div>
          {/* Floating tab windows exist per WORKSPACE page — the terminal
              only. On /settings they would hover the forms with nothing to
              dock back into. */}
          {onTerminal ? (
            <FloatingTabsLayer
              pageId={activePageId}
              registry={widgetRegistry}
              onDock={readOnly ? undefined : dockFloatingTab}
              onClose={closeFloatingTab}
            />
          ) : null}
        </WorkspaceErrorBoundary>
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
            commands={COMMANDS.listCommands()}
            isDisabled={isCommandDisabled}
            onRun={runCommand}
            onClose={() => {
              overlayStore.setState((p) => ({ ...p, paletteOpen: false }));
            }}
          />
        ) : null}
        {pickerFor ? (
          <WidgetPicker
            registry={widgetRegistry}
            openWidgetTypes={pickerOpenTypes}
            anchor={pickerFor.anchor}
            onPick={pickWidget}
            onClose={() =>
              overlayStore.setState((p) => ({ ...p, pickerFor: null }))
            }
          />
        ) : null}
        {addPageOpen ? (
          <AddPageDialog
            onClose={() =>
              overlayStore.setState((p) => ({ ...p, addPageOpen: false }))
            }
            onAdded={ensureTerminal}
          />
        ) : null}
        <DialogHost />
      </div>
    </WidgetCtaContext.Provider>
  );
}
