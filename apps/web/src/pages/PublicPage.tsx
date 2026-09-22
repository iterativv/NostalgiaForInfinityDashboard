// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useCapability } from "../capabilities/live";
import type { PanelId } from "@nfi/api-contract";
import {
  RELATIVE_BALANCE_DEFAULTS,
  RelativeBalanceWidget,
} from "@nfi/widgets";
import { RelativeEquityWidget } from "@nfi/widgets";
import {
  RELATIVE_PROFIT_DEFAULTS,
  RelativeProfitWidget,
} from "@nfi/widgets";

/**
 * Public shareable page (`/public`): performance without absolute numbers.
 *
 * Every widget here is backed by a `.relative` capability (percentages,
 * weights, rebased indices) — grant a public user only
 * `NON_SENSITIVE_CAPABILITIES` (`@nfi/api-contract`) and no option
 * combination can reveal the underlying freqtrade balances or PnL. No
 * workspace, no instance management, no credentials: the page is a fixed,
 * read-only dashboard pinned to the `default` instance.
 */

export function PublicPage() {
  // Capability gate for the whole page: without the relative grant the
  // widgets render their unauthorized state instead of streaming.
  const gate = useCapability("bot.profit.relative", {});
  return (
    <div
      style={{
        padding: "1.5rem",
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
        maxWidth: "1200px",
        margin: "0 auto",
      }}
    >
      <header
        style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          Shared performance
        </h1>
        <p style={{ fontSize: "0.875rem", opacity: 0.65, margin: 0 }}>
          Relative values only — percentages, allocation weights and an index
          rebased to 100. Absolute balances and profits are never exposed here.
          {gate.error ? ` (${gate.error})` : ""}
        </p>
      </header>
      <div className="nfi-stat-grid">
        <RelativeProfitWidget
          panelId={"public-profit" as PanelId}
          config={RELATIVE_PROFIT_DEFAULTS}
          focused={false}
        />
        <RelativeBalanceWidget
          panelId={"public-balance" as PanelId}
          config={RELATIVE_BALANCE_DEFAULTS}
          focused={false}
        />
      </div>
      <RelativeEquityWidget />
    </div>
  );
}
