// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Button } from "@carbon/react";
import { useStore } from "@tanstack/react-store";
import {
  Close,
  Edit,
  Image,
  OverflowMenuVertical,
  Restart,
} from "@carbon/icons-react";
import {
  useElementStore,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";

/**
 * PageActionsMenu — the single "⋯" trigger per page tab, mirroring the
 * tab's `TabActionsMenu` (same click-only behavior, same portal, same
 * dark menu styles).
 *
 * It replaces the old per-page × close button: every added page offers
 * Rename, Change icon, Reset layout (discard any widget/layout modification
 * and restore the canonical Home / preset / default layout) and Delete;
 * Home offers Rename + Change icon + Reset only (it cannot be deleted).
 *
 * Click-only: the trigger toggles the menu, outside pointer down or
 * Escape closes it. (The earlier hover-to-open variant was removed with
 * the tab menu's — sweeping the pages bar popped menus and flickered.)
 * It portals to `#root` so it escapes the pages-bar overflow clipping.
 */

const MENU_WIDTH_PX = 12 * 16;

export function PageActionsMenu({
  pageName,
  pageId,
  canDelete,
  onRename,
  onReset,
  onDelete,
  onChangeIcon,
  triggerClassName = "nfi-page-menu",
}: {
  pageName: string;
  pageId: string;
  /** False for Home: delete is withheld, rename + reset still open. */
  canDelete: boolean;
  onRename: (pageId: string) => void;
  /** Discard widget/layout modifications, restore the canonical layout. */
  onReset: (pageId: string) => void;
  onDelete: (pageId: string) => void;
  /** Open the icon picker for this page (Home, preset or custom). */
  onChangeIcon: (pageId: string) => void;
  triggerClassName?: string;
}) {
  // Menu state in one component store: open + anchor rect.
  interface PageMenuState {
    pinnedOpen: boolean;
    anchor: DOMRect | null;
  }

  const menuStore = useLocalStore<PageMenuState>({
    pinnedOpen: false,
    anchor: null,
  });

  const menu = useStore(menuStore, (s) => s);

  const { store: triggerEl, setElement: setTriggerEl } =
    useElementStore<HTMLButtonElement>();

  const { store: firstItemEl, setElement: setFirstItemEl } =
    useElementStore<HTMLButtonElement>();

  const open = menu.pinnedOpen;

  // Full dismiss: the portal unmounts at once — an activated item must
  // never leave the menu looking stuck on screen. Plain function: the
  // store it writes is per-instance stable, so the dismiss listeners
  // below keep their old [open] deps.
  const close = () => menuStore.setState((p) => ({ ...p, pinnedOpen: false }));

  const toggle = () =>
    menuStore.setState((p) => ({ ...p, pinnedOpen: !p.pinnedOpen }));

  // Keep the anchor fresh whenever the menu opens.
  useStoreEffect(() => {
    if (open)
      menuStore.setState(
        (p) => ({
          ...p,
          anchor: triggerEl.state?.getBoundingClientRect() ?? null,
        }),
      );
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

      if (target && !document.querySelector(".nfi-pagemenu")?.contains(target)) {
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
    const items = 3 + (canDelete ? 1 : 0);
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
        iconDescription={`${pageName} actions`}
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
                aria-label={`${pageName} actions`}
                className="nfi-tabmenu nfi-pagemenu"
                style={menuStyle}
              >
                <button
                  ref={setFirstItemEl}
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Rename this page"
                  onClick={() => {
                    onRename(pageId);
                    close();
                  }}
                >
                  <Edit size={16} />
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Change this page's icon in the pages bar"
                  onClick={() => {
                    onChangeIcon(pageId);
                    close();
                  }}
                >
                  <Image size={16} />
                  Change icon
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Discard any widget or layout modification and restore this page's canonical layout"
                  onClick={() => {
                    onReset(pageId);
                    close();
                  }}
                >
                  <Restart size={16} />
                  Reset layout
                </button>
                {canDelete ? (
                  <button
                    type="button"
                    role="menuitem"
                    className="nfi-tabmenu-item nfi-tabmenu-item--danger"
                    title={`Delete ${pageName}`}
                    onClick={() => {
                      onDelete(pageId);
                      close();
                    }}
                  >
                    <Close size={16} />
                    Delete page
                  </button>
                ) : null}
              </div>
            </div>,
            document.getElementById("root") ?? document.body,
          )
        : null}
    </>
  );
}
