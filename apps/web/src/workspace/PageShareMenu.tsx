// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { InlineLoading } from "@carbon/react";
import { useStore } from "@tanstack/react-store";
import { Copy, Download, Link, Share } from "@carbon/icons-react";
import { requestConfirm } from "@nfi/widgets";
import {
  useElementStore,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";
import { sharePageAsImage } from "./shareImage";

/**
 * PageShareMenu — header "Share page" trigger beside Search/Layout.
 *
 * - Copy link: copies the current URL, which always carries the shareable
 *   position (`?page=` + `?panel=` via the workspace URL sync) so another
 *   user opening it lands on the same page and focused tab.
 * - Download / Copy image: captures the visible workspace
 *   (`.nfi-workspace-host`) as a PNG via the dependency-free `shareImage`
 *   capture. Hidden tabs stay mounted but `hidden`, so only the visible tab
 *   content appears — the export is WYSIWYG.
 */

const MENU_WIDTH_PX = 13 * 16;

export function PageShareMenu({ pageName }: { pageName: string }) {
  // Menu state in one component store: open, anchor rect, in-flight action.
  interface ShareMenuState {
    open: boolean;
    anchor: DOMRect | null;
    busy: "download" | "copy" | "link" | null;
  }

  const menuStore = useLocalStore<ShareMenuState>({
    open: false,
    anchor: null,
    busy: null,
  });

  const menu = useStore(menuStore, (s) => s);

  const { store: triggerEl, setElement: setTriggerEl } =
    useElementStore<HTMLButtonElement>();

  // Plain function: the store it writes is per-instance stable, so the
  // dismiss listeners below keep their old [open] deps.
  const close = () => menuStore.setState((p) => ({ ...p, open: false }));

  useStoreEffect(() => {
    if (menu.open)
      menuStore.setState(
        (p) => ({ ...p, anchor: triggerEl.state?.getBoundingClientRect() ?? null }),
      );
  }, [menu.open]);

  useStoreEffect(() => {
    if (!menu.open) return;

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
  }, [menu.open]);

  const runShare = (action: "download" | "copy") => {
    if (menu.busy !== null) return;
    menuStore.setState((p) => ({ ...p, busy: action }));
    void sharePageAsImage(action, pageName)
      .catch((cause: unknown) =>
        requestConfirm({
          title:
            action === "download" ? "Page download failed" : "Page copy failed",
          message:
            cause instanceof Error
              ? cause.message
              : "Could not capture this page as an image.",
          confirmLabel: "OK",
        }).then(() => undefined),
      )
      .finally(() => {
        menuStore.setState((p) => ({ ...p, busy: null, open: false }));
      });
  };

  const runCopyLink = () => {
    if (menu.busy !== null) return;
    menuStore.setState((p) => ({ ...p, busy: "link" }));
    void (async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
      } catch (cause: unknown) {
        await requestConfirm({
          title: "Copy link failed",
          message:
            cause instanceof Error
              ? cause.message
              : "Could not copy the share link to the clipboard.",
          confirmLabel: "OK",
        });
      } finally {
        menuStore.setState((p) => ({ ...p, busy: null, open: false }));
      }
    })();
  };

  const GAP_PX = 4;

  const menuStyle: CSSProperties = (() => {
    const height = 3 * 37 + 12;

    if (!menu.anchor) return { top: 0, left: 0, width: MENU_WIDTH_PX };

    const left = Math.max(
      8,
      Math.min(
        window.innerWidth - MENU_WIDTH_PX - 8,
        menu.anchor.right - MENU_WIDTH_PX,
      ),
    );

    const flip = menu.anchor.bottom + GAP_PX + height > window.innerHeight;

    return flip
      ? {
          top: Math.max(8, menu.anchor.top - height - GAP_PX),
          left,
          width: MENU_WIDTH_PX,
        }
      : { top: menu.anchor.bottom + GAP_PX, left, width: MENU_WIDTH_PX };
  })();

  return (
    <>
      <button
        ref={setTriggerEl}
        type="button"
        className="nfi-topbar-button"
        aria-label={`Share ${pageName} (copy link or export image)`}
        title={`Share ${pageName} — copy a link to this position or export it as an image`}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={() => menuStore.setState((p) => ({ ...p, open: !p.open }))}
      >
        <Share size={16} />
      </button>
      {menu.open
        ? createPortal(
            <div
              className="nfi-tabmenu-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              <div
                role="menu"
                aria-label={`Share ${pageName}`}
                className="nfi-tabmenu"
                style={menuStyle}
              >
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Copy a link to this page position (page + focused tab) — anyone opening it lands here"
                  disabled={menu.busy !== null}
                  onClick={runCopyLink}
                >
                  {menu.busy === "link" ? (
                    <InlineLoading description="Copying link…" />
                  ) : (
                    <>
                      <Link size={16} />
                      Copy link
                    </>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Save the visible page as a PNG file"
                  disabled={menu.busy !== null}
                  onClick={() => runShare("download")}
                >
                  {menu.busy === "download" ? (
                    <InlineLoading description="Saving page…" />
                  ) : (
                    <>
                      <Download size={16} />
                      Download page image
                    </>
                  )}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  title="Copy the visible page as an image to the clipboard"
                  disabled={menu.busy !== null}
                  onClick={() => runShare("copy")}
                >
                  {menu.busy === "copy" ? (
                    <InlineLoading description="Copying page…" />
                  ) : (
                    <>
                      <Copy size={16} />
                      Copy page image
                    </>
                  )}
                </button>
              </div>
            </div>,
            document.getElementById("root") ?? document.body,
          )
        : null}
    </>
  );
}
