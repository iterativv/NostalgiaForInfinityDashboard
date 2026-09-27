// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { TerminalPage } from "./pages/TerminalPage";
import { PublicPage } from "./pages/PublicPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage, parseSettingsTab } from "./pages/settings/SettingsPage";
import { RootSetupPage } from "./pages/RootSetupPage";
import { InstanceSetupPage } from "./pages/InstanceSetupPage";
import { parseTerminalSearch, type RawSearch } from "./workspace/urlState";

/**
 * Application-level routes only. Widgets are NOT routes — the primary
 * terminal is a persistent workspace (`/`), not a page per widget.
 * Genuinely app-level destinations (auth, admin, fatal flows, first-run
 * setup screens) may add routes here without touching the workspace
 * architecture. Every configuration surface lives on `/settings` (tabs in
 * the `?tab=` search param); `/instances` and `/users` redirect there so
 * older links, bookmarks and the credentials-fix CTA keep working.
 */

const rootRoute = createRootRoute({ component: () => <Outlet /> });

export const terminalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  // Search params ARE state (single source of truth — see `urlState.ts`):
  // `page` + `panel` reproduce the same position for anyone opening the
  // URL; `widget` + `config` carry one-shot shared widget state from a
  // tab's "Copy share link" (non-sensitive widgets only).
  validateSearch: (search: RawSearch) => parseTerminalSearch(search),
  component: TerminalPage,
});

const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/public",
  component: PublicPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  validateSearch: (search: RawSearch) => ({
    tab: parseSettingsTab(search),
  }),
  component: SettingsPage,
});

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { tab: "users" } });
  },
});

const instancesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/instances",
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { tab: "instances" } });
  },
});

const rootSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: RootSetupPage,
});

const instanceSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup/instances",
  component: InstanceSetupPage,
});

const routeTree = rootRoute.addChildren([
  terminalRoute,
  publicRoute,
  loginRoute,
  settingsRoute,
  usersRoute,
  instancesRoute,
  rootSetupRoute,
  instanceSetupRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
