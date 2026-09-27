// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { router } from "../router";

/**
 * One destination for "manage freqtrade instances": the "Freqtrade
 * instances" tab of the `/settings` page (list, add, edit, delete, live
 * health — per-action gated on the `instances.*` capabilities). Shared by
 * the aside's Settings entry and the "Freqtrade rejected the credentials"
 * widget CTA (`WidgetCtaContext.fixCredentials`).
 *
 * The failing instance id rides separately through `credentialsFixStore`
 * (recorded by the live layer) — the tab consumes it on arrival and
 * pre-opens that row's edit form. The dashboard's Freqtrade Instances
 * widget consumes the same request while the terminal is in view.
 */

/** Land on the instance manager tab (see module doc). */
export function openInstanceConnections(): void {
  void router.navigate({
    to: "/settings",
    search: { tab: "instances" },
  });
}

/**
 * CTA target for the "Freqtrade rejected the credentials" widget state
 * (`WidgetCtaContext.fixCredentials`) — the same destination as the aside
 * menu entry.
 */
export function openCredentialsFixer(): void {
  openInstanceConnections();
}
