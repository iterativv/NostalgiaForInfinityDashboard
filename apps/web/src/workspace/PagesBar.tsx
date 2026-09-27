// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useStore } from "@tanstack/react-store";
import { Button, OverflowMenu, OverflowMenuItem } from "@carbon/react";
import { Add, Home } from "@carbon/icons-react";
import { useElementStore, useLocalStore, useStoreEffect } from "@nfi/ui";
import type { PageSummary } from "./store";
import { getPresetPage } from "./pages";
import { PageIconView } from "./pageIcons";
import { PageActionsMenu } from "./PageMenu";

/**
 * PagesBar — the page menu, embedded in the main header.
 *
 * Home leads (editable, shared), then the pages the user added — preset
 * dashboards and custom pages (all fully editable, optional icon).
 * Double-click renames renamable pages; the "⋯" actions menu on the
 * active page (mirroring the tab actions menu, click-only) offers Rename,
 * Reset layout and Delete — a deleted preset returns to the Add-page
 * dialog. "+" opens the Add-page dialog (presets + custom).
 *
 * When the header cannot fit every tab, the last several collapse into a
 * "More pages" overflow popover (measured with a ResizeObserver — no
 * fixed breakpoint, no horizontal scrolling).
 */

function PageIcon({ page }: { page: PageSummary }) {
  if (page.home) return <Home size={14} />;

  return (
    <PageIconView
      iconKey={page.preset ? getPresetPage(page.id)?.icon : page.icon}
      size={14}
    />
  );
}

export function PagesBar({
  pages,
  activePageId,
  terminalActive = true,
  onSwitch,
  onNew,
  onDelete,
  onRename,
  onReset,
  locked = false,
}: {
  pages: ReadonlyArray<PageSummary>;
  activePageId: string;
  /**
   * True only while the router shows the terminal itself. The bar stays
   * visible on off-terminal pages (as the way back), but no page may read
   * as active there — a highlighted page is a workspace position, not a
   * route.
   */
  terminalActive?: boolean;
  onSwitch: (pageId: string) => void;
  onNew: () => void;
  onDelete: (pageId: string) => void;
  onRename: (pageId: string) => void;
  onReset: (pageId: string) => void;
  /** True on read-only surfaces (signed out): add/actions hide. */
  locked?: boolean;
}) {
  const { store: tabsEl, setElement: setTabsEl } =
    useElementStore<HTMLDivElement>();

  const visibleCountStore = useLocalStore(pages.length);
  const visibleCount = useStore(visibleCountStore, (s) => s);

  // Collapse trailing tabs into the overflow menu when space runs out.
  // The "+ New" button lives inside the same row, right after the last
  // page — reserve its width so tabs never slide underneath it.
  useStoreEffect(() => {
    const el = tabsEl.state;

    if (!el) return;

    const compute = () => {
      const tabs = Array.from(
        el.querySelectorAll<HTMLElement>("[data-page-tab]"),
      );

      if (tabs.length === 0) {
        visibleCountStore.setState(() => 0);

        return;
      }

      const newReserve = 36;
      const avail = el.clientWidth - newReserve;
      const moreReserve = 44;
      let used = 0;
      let count = 0;

      for (let i = 0; i < tabs.length; i++) {
        const width = tabs[i]?.offsetWidth ?? 0;

        // Hidden tabs report 0 — treat them as fitting so a widening
        // container restores them instead of sticking at the old count.
        if (width === 0) {
          count = i + 1;
          continue;
        }

        const needMore = i < tabs.length - 1;

        if (used + width + 2 + (needMore ? moreReserve : 0) <= avail) {
          used += width + 2;
          count = i + 1;
        } else {
          break;
        }
      }

      const next = count >= tabs.length ? tabs.length : Math.max(1, count);
      visibleCountStore.setState((prev) => (prev === next ? prev : next));
    };

    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    document.fonts?.ready.then(() => compute()).catch(() => undefined);

    return () => observer.disconnect();
  }, [pages, activePageId]);

  const overflow = visibleCount < pages.length ? pages.slice(visibleCount) : [];

  return (
    <nav className="nfi-pagesbar" aria-label="Pages">
      <div ref={setTabsEl} className="nfi-pagesbar-tabs">
        {pages.map((page, index) => {
          const active = terminalActive && page.id === activePageId;
          const renamable = !locked;
          const hidden = index >= visibleCount;

          return (
            <div
              key={page.id}
              data-page-tab=""
              style={hidden ? { display: "none" } : undefined}
              className={active ? "nfi-page nfi-page-active" : "nfi-page"}
            >
              <button
                type="button"
                className="nfi-page-button"
                aria-current={active ? "page" : undefined}
                title={
                  page.home
                    ? `${page.name} (shared layout — edits save to the server, visible to signed-out visitors)`
                    : page.preset
                      ? `${page.name} (preset dashboard — fully editable, Reset restores its canonical layout)`
                      : page.name
                }
                onClick={() => onSwitch(page.id)}
                onDoubleClick={() => {
                  if (renamable) onRename(page.id);
                }}
              >
                <PageIcon page={page} />
                <span>{page.name}</span>
              </button>
              {active && !locked ? (
                <PageActionsMenu
                  pageName={page.name}
                  pageId={page.id}
                  canDelete={!page.home}
                  onRename={onRename}
                  onReset={onReset}
                  onDelete={onDelete}
                />
              ) : null}
            </div>
          );
        })}
        {overflow.length > 0 ? (
          <OverflowMenu
            aria-label="More pages"
            flipped
            size="sm"
            className="nfi-pages-more"
            menuOptionsClass="nfi-pages-more-menu"
          >
            {overflow.map((page) => (
              <OverflowMenuItem
                key={page.id}
                itemText={page.name}
                onClick={() => onSwitch(page.id)}
              />
            ))}
          </OverflowMenu>
        ) : null}
        {locked ? null : (
          <Button
            size="sm"
            kind="ghost"
            hasIconOnly
            iconDescription="Add page"
            renderIcon={Add}
            className="nfi-page-new"
            onClick={onNew}
            title="Add a preset or custom page"
          />
        )}
      </div>
    </nav>
  );
}
