// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import type { PageDefaultsConfig } from "@nfi/api-contract";
import { formatQueryError } from "../api";
import { callCapability } from "../capabilities/client";
import type { PageSummary } from "./store";

/**
 * Page defaults — who lands where, and which pages they see.
 *
 * The backend stores one global landing page plus one override per identity
 * (user id or the `anonymous` role): default landing page, visible pages,
 * default tab per page. This store holds the CALLER's scoped view
 * (`system.page-defaults` with no user id: global + own override), hydrated
 * next to capabilities so workspace hydration can pick a landing page other
 * than Home. Reads for OTHER identities (view-as preview, manage-page
 * editors) go through `fetchPageDefaultsFor` on demand — the scoped read
 * never leaks the whole map.
 *
 * Offline / 403 (anonymous without the read grant): fall back to Home +
 * all pages. The backend remains the enforcement point for data; this only
 * steers navigation and the pages bar.
 */

export interface PageDefaultsState {
  /** Resolved identity the scoped view belongs to. */
  readonly userId: string | null;
  /** Deployment-wide landing page (null = Home). */
  readonly globalDefaultPageId: string | null;
  /** Own override (null = follow the global). */
  readonly defaults: PageDefaultsConfig | null;
  readonly status: "loading" | "ready" | "offline";
  readonly detail: string | null;
}

export const pageDefaultsStore = new Store<PageDefaultsState>({
  userId: null,
  globalDefaultPageId: null,
  defaults: null,
  status: "loading",
  detail: null,
});

let hydrated = false;

export function resetPageDefaultsHydration(): void {
  hydrated = false;
}

/** Fetch the caller's scoped view once (idempotent). */
export async function hydratePageDefaults(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  pageDefaultsStore.setState((state) => ({
    ...state,
    status: "loading",
    detail: null,
  }));

  try {
    const response = await callCapability("system.page-defaults", {});
    pageDefaultsStore.setState(() => ({
      userId: response.userId,
      globalDefaultPageId: response.globalDefaultPageId,
      defaults: response.defaults,
      status: "ready",
      detail: null,
    }));
  } catch (error) {
    pageDefaultsStore.setState(() => ({
      userId: null,
      globalDefaultPageId: null,
      defaults: null,
      status: "offline",
      detail: formatQueryError(error) ?? "page defaults unavailable",
    }));
  }
}

/** Scoped read for ANOTHER identity (preview/editors). Null on failure. */
export async function fetchPageDefaultsFor(userId: string): Promise<{
  globalDefaultPageId: string | null;
  defaults: PageDefaultsConfig | null;
} | null> {
  try {
    const response = await callCapability("system.page-defaults", { userId });

    return {
      globalDefaultPageId: response.globalDefaultPageId,
      defaults: response.defaults,
    };
  } catch {
    return null;
  }
}

/** Persist a patch (global and/or one identity). Throws on failure. */
export async function savePageDefaults(input: {
  globalDefaultPageId?: string | null;
  userId?: string;
  defaults?: PageDefaultsConfig | null;
}): Promise<void> {
  await callCapability("system.page-defaults.update", {
    globalDefaultPageId: input.globalDefaultPageId,
    userId: input.userId,
    defaults: input.defaults,
  });
  resetPageDefaultsHydration();
  await hydratePageDefaults();
}

export function usePageDefaults(): PageDefaultsState {
  return useStore(pageDefaultsStore, (s) => s);
}

/**
 * Effective landing page for an identity: own default, else the global,
 * else null (callers fall back to Home / last-visited).
 */
export function resolveLandingPage(state: PageDefaultsState): string | null {
  return state.defaults?.defaultPageId ?? state.globalDefaultPageId;
}

/**
 * Pages visible to an identity: the override's list, else every page.
 * Unknown ids in the list are ignored so deleted pages never blank the bar.
 */
export function filterVisiblePages(
  pages: ReadonlyArray<PageSummary>,
  visiblePageIds: ReadonlyArray<string> | null,
): ReadonlyArray<PageSummary> {
  if (visiblePageIds === null) return pages;
  const allowed = new Set(visiblePageIds);
  const filtered = pages.filter((page) => allowed.has(page.id));

  return filtered.length > 0 ? filtered : pages;
}

/** Preferred tab for a page (null = keep the workspace's active tab). */
export function resolveDefaultTab(
  defaults: PageDefaultsConfig | null,
  pageId: string,
): string | null {
  return defaults?.defaultPanels[pageId] ?? null;
}
