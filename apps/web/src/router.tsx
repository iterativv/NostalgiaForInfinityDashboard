// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Outlet, createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { TerminalPage } from "./pages/TerminalPage"
import { PublicPage } from "./pages/PublicPage"
import { LoginPage } from "./pages/LoginPage"
import { ManageUsersPage } from "./pages/ManageUsersPage"
import { RootSetupPage } from "./pages/RootSetupPage"
import { InstanceSetupPage } from "./pages/InstanceSetupPage"

/**
 * Application-level routes only. Widgets are NOT routes — the primary
 * terminal is a persistent workspace (`/`), not a page per widget.
 * Genuinely app-level destinations (auth, admin, fatal flows, first-run
 * setup screens) may add routes here without touching the workspace
 * architecture; settings is a dialog over any page, not a route.
 */

const rootRoute = createRootRoute({ component: () => <Outlet /> })

const terminalRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: TerminalPage,
})

const publicRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/public",
  component: PublicPage,
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
})

const usersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/users",
  component: ManageUsersPage,
})

const rootSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: RootSetupPage,
})

const instanceSetupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup/instances",
  component: InstanceSetupPage,
})

const routeTree = rootRoute.addChildren([
  terminalRoute,
  publicRoute,
  loginRoute,
  usersRoute,
  rootSetupRoute,
  instanceSetupRoute,
])

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
})

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
