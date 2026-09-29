// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button, InlineLoading } from "@carbon/react";
import {
  BottomPanelOpen,
  Close,
  Copy,
  Download,
  Edit,
  EditOff,
  InformationSquare,
  Link,
  Maximize,
  OverflowMenuVertical,
  PinFilled,
  Restart,
  Settings,
  SidePanelOpen,
} from "@carbon/icons-react";
import { useStore } from "@tanstack/react-store";
import {
  useElementStore,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";
import type { AnyWidgetDefinition } from "@nfi/widget-sdk";
import { isNonSensitiveCapabilities, type JsonValue } from "@nfi/capabilities";
import {
  requestConfirm,
  requestWidgetSettings,
  requestPrompt,
} from "@nfi/widgets";
import { reloadOwnerCapabilities } from "../capabilities/live";
import { sensitivityStore } from "../capabilities/sensitivity";
import { renameWorkspacePanelTitle, workspaceStore } from "./store";
import { isWidgetConfig } from "./floating";
import { buildShareUrl, buildWidgetShareSearch } from "./urlState";
import { WidgetInfoDialog } from "./WidgetInfoDialog";
import { shareWidgetAsImage } from "./shareImage";

/**
 * TabActionsMenu — the single "⋯" trigger per tab (or bare panel header)
 * replacing the separate close × and settings gear buttons.
 *
 * Click-only: the trigger toggles the menu, outside pointer down or
 * Escape closes it. (An earlier hover-to-open variant was removed —
 * sweeping the pointer across the tab strip popped menus open and
 * flickered mid-flight.) The menu portals to `#root` so it escapes the
 * tab strip's scroll clipping. Every widget offers Reload (re-fetches
 * exactly that widget's live data), Rename (a custom tab title —
 * tooltips keep the widget name) and Information (definition,
 * capabilities, config); Full screen and Pin appear when wired; Settings
 * and Close depend on the flags.
 *
 * Share links: "Copy share link" copies a URL carrying the full widget
 * state (`?page=` + `?panel=` + `?widget=` + `?config=`) so another user
 * opening it lands on the same tab with the same configuration. Only
 * non-sensitive widgets (every capability non-sensitive under the root's
 * live criteria) offer it — sensitive tabs explain why and point at the
 * static image export instead.
 */

const MENU_WIDTH_PX = 12 * 16;

export function TabActionsMenu({
  title,
  panelId,
  canClose,
  canConfigure,
  canPin = false,
  canFullScreen = false,
  widgetDefinition,
  widgetConfig,
  renamed = false,
  locked = false,
  onClosePanel,
  onPinPanel,
  onFullScreen,
  onSplitRight,
  onSplitBelow,
  triggerClassName = "nfi-tab-menu",
}: {
  title: string;
  panelId: string;
  /** False for pinned preset tabs: close is withheld, settings still open. */
  canClose: boolean;
  /** True when the widget owns a settings form on the shared bus. */
  canConfigure: boolean;
  /** True on read-only surfaces (signed out): renames hide with the gears. */
  locked?: boolean;
  /** True when the tab may detach into the floating layer (non-locked). */
  canPin?: boolean;
  /** True when a full-screen view is wired for this tab. */
  canFullScreen?: boolean;
  /** Present for every hosted widget: enables the Information action. */
  widgetDefinition?: AnyWidgetDefinition;
  /** Decoded config shown by the Information dialog. */
  widgetConfig?: unknown;
  /** True while a custom tab title exists: shows the "Reset name" action. */
  renamed?: boolean;
  onClosePanel: (panelId: string) => void;
  /** Pin the tab into the floating layer (removes it from the grid). */
  onPinPanel?: (panelId: string) => void;
  /** Blow the tab up into the full-screen dialog. */
  onFullScreen?: (panelId: string) => void;
  /** Tear the tab out into a new column to the right of its group. */
  onSplitRight?: (panelId: string) => void;
  /** Tear the tab out into a new row below its group. */
  onSplitBelow?: (panelId: string) => void;
  triggerClassName?: string;
}) {
  // Menu state in one component store: pinned open + anchor rect.
  interface TabMenuState {
    pinnedOpen: boolean;
    anchor: DOMRect | null;
  }

  const menuStore = useLocalStore<TabMenuState>({
    pinnedOpen: false,
    anchor: null,
  });

  const menu = useStore(menuStore, (s) => s);

  // Async share/export in flight ("download" | "copy" | "link"); null idle.
  const sharingStore = useLocalStore<"download" | "copy" | "link" | null>(null);
  const sharing = useStore(sharingStore, (s) => s);

  const infoStore = useLocalStore(false);
  const infoOpen = useStore(infoStore, (s) => s);

  const { store: triggerEl, setElement: setTriggerEl } =
    useElementStore<HTMLButtonElement>();

  const { store: firstItemEl, setElement: setFirstItemEl } =
    useElementStore<HTMLButtonElement>();

  const canInfo = widgetDefinition !== undefined;

  const runCopyShareLink = () => {
    if (sharing !== null || !widgetDefinition) return;

    if (
      !isNonSensitiveCapabilities(
        widgetDefinition.capabilities,
        sensitivityStore.state.sensitiveKinds,
      )
    ) {
      void requestConfirm({
        title: "Cannot share sensitive widget",
        message: `“${title}” needs capabilities that expose sensitive data under the current criteria — a share link would carry its live configuration. Use Download image or Copy image for a static snapshot instead.`,
        confirmLabel: "OK",
      }).then(() => undefined);

      return;
    }

    let config: Record<string, JsonValue> | undefined;

    if (isWidgetConfig(widgetConfig)) {
      config = widgetConfig;
    } else {
      const stored =
        workspaceStore.state.workspace.panels[panelId]?.widgetConfig;

      if (isWidgetConfig(stored)) config = stored;
    }

    if (!config) {
      void requestConfirm({
        title: "Cannot share widget",
        message: "Its configuration could not be read.",
        confirmLabel: "OK",
      }).then(() => undefined);

      return;
    }

    const share = buildWidgetShareSearch(
      workspaceStore.state.activePageId,
      panelId,
      widgetDefinition.type,
      config,
    );

    if (!share) {
      void requestConfirm({
        title: "Cannot share widget",
        message: "Its configuration is too large to fit in a shareable URL.",
        confirmLabel: "OK",
      }).then(() => undefined);

      return;
    }

    sharingStore.setState(() => "link");
    const url = buildShareUrl(window.location.origin, "/", share);
    void navigator.clipboard
      .writeText(url)
      .catch((cause: unknown) =>
        requestConfirm({
          title: "Copy link failed",
          message:
            cause instanceof Error
              ? cause.message
              : "Could not copy the share link to the clipboard.",
          confirmLabel: "OK",
        }).then(() => undefined),
      )
      .finally(() => {
        sharingStore.setState(() => null);
        close();
      });
  };

  const runShare = (action: "download" | "copy") => {
    if (sharing !== null) return;
    sharingStore.setState(() => action);
    // Keep the menu open through the capture so the busy indicator shows;
    // close on completion like every other action, then surface failures.
    void shareWidgetAsImage(panelId, action, title)
      .catch((cause: unknown) =>
        requestConfirm({
          title: action === "download" ? "Download failed" : "Copy failed",
          message:
            cause instanceof Error
              ? cause.message
              : "Could not capture that widget as an image.",
          confirmLabel: "OK",
        }).then(() => undefined),
      )
      .finally(() => {
        sharingStore.setState(() => null);
        close();
      });
  };

  const open = menu.pinnedOpen;

  // Full dismiss: the portal unmounts at once — an activated item must
  // never leave the menu looking stuck on screen. Plain function: the
  // store it writes is per-instance stable, so the dismiss listeners
  // below keep their [open] deps.
  const close = () =>
    menuStore.setState((p) => ({ ...p, pinnedOpen: false }));

  const toggle = () =>
    menuStore.setState((p) => ({ ...p, pinnedOpen: !p.pinnedOpen }));

  // Keep the anchor fresh whenever the menu opens.
  useStoreEffect(() => {
    if (open) {
      menuStore.setState((p) => ({
        ...p,
        anchor: triggerEl.state?.getBoundingClientRect() ?? null,
      }));
    }
  }, [open]);

  // Focus the first item for keyboard users; return focus on close.
  useStoreEffect(() => {
    if (open) firstItemEl.state?.focus();
  }, [open]);

  useStoreEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        triggerEl.state?.focus();
      }
    };

    const onPointer = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;

      if (target && !document.querySelector(".nfi-tabmenu")?.contains(target)) {
        close();
      }
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Anchor below the trigger, right-aligned, flipped above near the
  // viewport bottom and clamped horizontally.
  const menuStyle: CSSProperties = (() => {
    const items =
      1 + // Reload — always offered
      (locked ? 0 : 1) + // Rename — hidden when locked
      3 + // Copy share link + Download image + Copy image — always offered
      (renamed && !locked ? 1 : 0) + // Reset name (only while a rename exists)
      (canInfo ? 1 : 0) +
      (canConfigure ? 1 : 0) +
      (canFullScreen ? 1 : 0) +
      (onSplitRight ? 1 : 0) +
      (onSplitBelow ? 1 : 0) +
      (canPin ? 1 : 0) +
      (canClose ? 1 : 0);

    const height = items * 37 + 12;

    if (!menu.anchor) {
      return { top: 0, left: 0, width: MENU_WIDTH_PX };
    }

    const left = Math.max(
      8,
      Math.min(
        window.innerWidth - MENU_WIDTH_PX - 8,
        menu.anchor.right - MENU_WIDTH_PX,
      ),
    );

    const GAP_PX = 4;
    const below = menu.anchor.bottom + GAP_PX;

    return below + height > window.innerHeight
      ? {
          top: Math.max(8, menu.anchor.top - height - GAP_PX),
          left,
          width: MENU_WIDTH_PX,
        }
      : { top: below, left, width: MENU_WIDTH_PX };
  })();

  return (
    <>
      <Button
        ref={setTriggerEl}
        size="sm"
        kind="ghost"
        hasIconOnly
        iconDescription={`${title} actions`}
        renderIcon={OverflowMenuVertical}
        className={triggerClassName}
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
      />
      {open
        ? createPortal(
            <div
              className="nfi-tabmenu-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                role="menu"
                aria-label={`${title} actions`}
                className="nfi-tabmenu"
                style={menuStyle}
              >
                {canInfo ? (
                  <button
                    ref={setFirstItemEl}
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      infoStore.setState(() => true);
                      close();
                    }}
                  >
                    <InformationSquare size={16} />
                    Information
                  </button>
                ) : null}
                <button
                  ref={canInfo ? undefined : setFirstItemEl}
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Re-fetch this widget's stream data now"
                  onClick={() => {
                    void reloadOwnerCapabilities(panelId);
                    close();
                  }}
                >
                  <Restart size={16} />
                  Reload
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Save this widget as a PNG image"
                  disabled={sharing !== null}
                  onClick={() => runShare("download")}
                >
                  {sharing === "download" ? (
                    <InlineLoading description="Saving…" />
                  ) : (
                    <>
                      <Download size={16} />
                      Download image
                    </>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Copy this widget as an image to the clipboard"
                  disabled={sharing !== null}
                  onClick={() => runShare("copy")}
                >
                  {sharing === "copy" ? (
                    <InlineLoading description="Copying…" />
                  ) : (
                    <>
                      <Copy size={16} />
                      Copy image
                    </>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Copy a link to this tab with its full configuration — anyone opening it lands here with the same widget state (non-sensitive widgets only)"
                  disabled={sharing !== null || !canInfo}
                  onClick={runCopyShareLink}
                >
                  {sharing === "link" ? (
                    <InlineLoading description="Copying…" />
                  ) : (
                    <>
                      <Link size={16} />
                      Copy share link
                    </>
                  )}
                </button>
                {locked ? null : (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    title="Custom tab title — tooltips keep the widget name"
                    onClick={() => {
                      close();
                      void requestPrompt({
                        title: "Rename tab",
                        label: "Tab name",
                        initialValue: title,
                        confirmLabel: "Rename",
                      }).then((name) => {
                        // null = cancelled (the prompt refuses empty submits)
                        if (name !== null)
                          renameWorkspacePanelTitle(panelId, name);
                      });
                    }}
                  >
                    <Edit size={16} />
                    Rename
                  </button>
                )}
                {renamed && !locked ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    title="Back to the widget's own name"
                    onClick={() => {
                      renameWorkspacePanelTitle(panelId, null);
                      close();
                    }}
                  >
                    <EditOff size={16} />
                    Reset name
                  </button>
                ) : null}
                {canConfigure ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      requestWidgetSettings(panelId);
                      close();
                    }}
                  >
                    <Settings size={16} />
                    Settings
                  </button>
                ) : null}
                {canFullScreen && onFullScreen ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      onFullScreen(panelId);
                      close();
                    }}
                  >
                    <Maximize size={16} />
                    Full screen
                  </button>
                ) : null}
                {onSplitRight ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    title="Move this tab into a new column to the right — drop targets at any panel edge split the same way"
                    onClick={() => {
                      onSplitRight(panelId);
                      close();
                    }}
                  >
                    <SidePanelOpen size={16} />
                    Split right (column)
                  </button>
                ) : null}
                {onSplitBelow ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    title="Move this tab into a new row below — drop targets at any panel edge split the same way"
                    onClick={() => {
                      onSplitBelow(panelId);
                      close();
                    }}
                  >
                    <BottomPanelOpen size={16} />
                    Split below (row)
                  </button>
                ) : null}
                {canPin && onPinPanel ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    title="Detach into a draggable floating window"
                    onClick={() => {
                      onPinPanel(panelId);
                      close();
                    }}
                  >
                    <PinFilled size={16} />
                    Pin to floating
                  </button>
                ) : null}
                {canClose ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => {
                      onClosePanel(panelId);
                      close();
                    }}
                  >
                    <Close size={16} />
                    Close tab
                  </button>
                ) : null}
              </div>
            </div>,
            // Inside #root (under Carbon's g100 Theme) so theme tokens
            // resolve; the menu would lose its colors on document.body.
            document.getElementById("root") ?? document.body,
          )
        : null}
      {infoOpen && widgetDefinition ? (
        <WidgetInfoDialog
          definition={widgetDefinition}
          config={widgetConfig}
          panelId={panelId}
          onClose={() => infoStore.setState(() => false)}
        />
      ) : null}
    </>
  );
}
