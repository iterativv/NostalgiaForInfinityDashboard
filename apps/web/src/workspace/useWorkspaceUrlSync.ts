// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { shallow, useDerived, useStoreEffect } from "@nfi/ui";
import { isNonSensitiveCapabilities } from "@nfi/capabilities";
import { sensitivityStore } from "../capabilities/sensitivity";
import { widgetRegistry } from "./registry";
import {
  activateWorkspacePanel,
  switchActivePage,
  updatePanelConfig,
  workspaceStore,
} from "./store";
import { decodeWidgetConfig, parseTerminalSearch } from "./urlState";

/**
 * Bidirectional sync between the workspace store and the terminal's search
 * params (`/` route, `validateSearch` owns the schema — see `urlState.ts`).
 *
 * - URL -> store: after hydration, an incoming `?page=` switches pages, an
 *   incoming `?panel=` focuses its tab, and a one-shot `?widget=` +
 *   `?config=` applies shared widget state (non-sensitive widgets only).
 *   Unknown ids and sensitive/oversized payloads are ignored.
 * - Store -> URL: page/panel changes replace the URL (no history spam) so
 *   the address bar is always a shareable deep link. One-shot `widget` /
 *   `config` keys are dropped after they are applied so links never go
 *   stale.
 *
 * Mount once on the terminal page. Back/forward works because every search
 * change re-runs the URL -> store pass.
 */
export function useWorkspaceUrlSync(): void {
  const navigate = useNavigate();

  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  const rawSearch = useRouterState({
    select: (state) => state.location.search,
  });

  const search = useDerived(
    [rawSearch] as const,
    // Spread re-types the router's interface as a fresh object literal, so
    // it carries the implicit index signature `parseTerminalSearch` needs
    // (spreading the pre-validation `undefined` is a no-op).
    ([raw]) => parseTerminalSearch({ ...raw }),
    { inputs: shallow },
  );

  const status = useStore(workspaceStore, (state) => state.status);
  const activePageId = useStore(workspaceStore, (state) => state.activePageId);

  const activePanelId = useStore(
    workspaceStore,
    (state) => state.workspace.activePanelId,
  );

  // URL -> store: apply incoming position (reads the store imperatively so
  // this pass only re-runs on search/hydration changes, never on its own
  // writes). The effect waits on the loading->ready TRANSITION, not on
  // `status` itself: a page add flips status to "saving" mid-flight, and an
  // effect keyed on the raw status would re-run with the still-stale `?page=`
  // URL and yank the viewport back to the previous page.
  const ready = status !== "loading";

  useStoreEffect(() => {
    if (pathname !== "/") return;

    if (!ready) return;

    if (
      !search.page &&
      !search.panel &&
      !search.widget &&
      !search.config
    ) {
      return;
    }

    const current = workspaceStore.state;

    if (search.page && search.page !== current.activePageId) {
      const switched = switchActivePage(search.page);

      if (!switched) return;
    }

    const afterPage = workspaceStore.state.workspace;

    if (search.panel && afterPage.panels[search.panel]) {
      if (afterPage.activePanelId !== search.panel) {
        activateWorkspacePanel(search.panel);
      }
    }

    if (search.widget && search.config) {
      const decoded = decodeWidgetConfig(search.config);

      if (!decoded) return;

      const targetPanelId =
        search.panel ?? workspaceStore.state.workspace.activePanelId;

      if (!targetPanelId) return;

      const instance =
        workspaceStore.state.workspace.panels[targetPanelId];

      if (!instance || instance.widgetType !== search.widget) return;

      const definition = widgetRegistry.getWidget(search.widget);

      if (!definition) return;

      if (
        !isNonSensitiveCapabilities(
          definition.capabilities,
          sensitivityStore.state.sensitiveKinds,
        )
      ) {
        return;
      }

      try {
        if (
          JSON.stringify(instance.widgetConfig) !== JSON.stringify(decoded)
        ) {
          updatePanelConfig(targetPanelId, decoded);
        }
      } catch {
        // Incomparable configs — leave the live state untouched.
      }
    }
  }, [
    pathname,
    ready,
    search.page,
    search.panel,
    search.widget,
    search.config,
  ]);

  // Store -> URL: keep the address bar a shareable deep link.
  useStoreEffect(() => {
    if (pathname !== "/") return;

    if (status === "loading") return;

    const desiredPanel = activePanelId ?? undefined;

    if (
      search.page === activePageId &&
      search.panel === desiredPanel &&
      search.widget === undefined &&
      search.config === undefined
    ) {
      return;
    }

    void navigate({
      to: "/",
      search: (previous) => ({
        ...previous,
        page: activePageId,
        panel: desiredPanel,
        widget: undefined,
        config: undefined,
      }),
      replace: true,
    });
  }, [
    pathname,
    status,
    activePageId,
    activePanelId,
    search.page,
    search.panel,
    search.widget,
    search.config,
    navigate,
  ]);
}
