// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import {
  DEFAULT_SENSITIVE_INFO_KINDS,
  type InfoKind,
  type SensitivitySettingsResponse,
} from "@nfi/api-contract";
import { formatQueryError, runApi } from "../api";

/**
 * Root-configurable sensitivity criteria — the frontend half.
 *
 * Capabilities declare what they expose; the ROOT user decides which kinds
 * count as sensitive (Manage users page → "Sensitivity criteria", stored
 * server-side). Every client bootstraps the current set next to the
 * capability grant, and widget marks / capability tags derive from it
 * live: sensitivity labels follow the root's definition, not a hard-coded
 * one. Enforcement is unaffected — grants still gate every call.
 */

export interface SensitivityState {
  /** Kinds the root considers sensitive right now. */
  readonly sensitiveKinds: ReadonlyArray<InfoKind>;
  readonly status: "loading" | "ready" | "offline";
  readonly detail: string | null;
}

export const sensitivityStore = new Store<SensitivityState>({
  sensitiveKinds: [...DEFAULT_SENSITIVE_INFO_KINDS],
  status: "loading",
  detail: null,
});

let hydrated = false;

export function resetSensitivityHydration(): void {
  hydrated = false;
}

/** Fetch the current criteria once (idempotent; safe to call again after reset). */
export async function hydrateSensitivity(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  sensitivityStore.setState((state) => ({
    ...state,
    status: "loading",
    detail: null,
  }));
  try {
    const response = await runApi((client) => client.System.sensitivity());
    sensitivityStore.setState(() => ({
      sensitiveKinds: [...response.sensitiveKinds],
      status: "ready",
      detail: null,
    }));
  } catch (error) {
    // Offline fallback: the default criteria, so marks still render.
    sensitivityStore.setState((state) => ({
      sensitiveKinds: [...DEFAULT_SENSITIVE_INFO_KINDS],
      status: "offline",
      detail: formatQueryError(error) ?? "sensitivity criteria unavailable",
    }));
  }
}

/** Root-only save (PUT); updates the store from the server's response. */
export async function saveSensitivity(
  sensitiveKinds: ReadonlyArray<InfoKind>,
): Promise<SensitivitySettingsResponse> {
  const response = await runApi((client) =>
    client.System.sensitivityUpdate({
      payload: { sensitiveKinds: [...sensitiveKinds] },
    }),
  );
  sensitivityStore.setState(() => ({
    sensitiveKinds: [...response.sensitiveKinds],
    status: "ready",
    detail: null,
  }));
  return response;
}

/** Reactive read for components deriving marks from the live criteria. */
export function useSensitivity(): SensitivityState {
  return useStore(sensitivityStore, (state) => state);
}

/** Human labels for the information kinds (checkbox editor + tag tooltips). */
export const INFO_KIND_META: Record<InfoKind, { label: string; hint: string }> =
  {
    "absolute-balance": {
      label: "Absolute balances",
      hint: "Total, equity and wallet amounts (and their history) in coin or fiat.",
    },
    "absolute-profit": {
      label: "Absolute profit",
      hint: "Profit and PnL amounts — daily, closed and aggregated.",
    },
    "trade-details": {
      label: "Trade details",
      hint: "Individual open/closed positions including amounts.",
    },
    "stake-amount": {
      label: "Stake amounts",
      hint: "Configured stake sizes (bot / instance config summaries).",
    },
    "strategy-config": {
      label: "Strategy config",
      hint: "Strategy, exchange and run-mode configuration.",
    },
    "infra-location": {
      label: "Infrastructure location",
      hint: "Hosts and base URLs that locate your servers.",
    },
    "user-accounts": {
      label: "User accounts",
      hint: "Usernames, roles and capability grants.",
    },
    "user-workspaces": {
      label: "Saved workspaces",
      hint: "Users' saved dashboards.",
    },
    "relative-values": {
      label: "Relative values",
      hint: "Percentages, allocation weights and rebased indices.",
    },
    "market-data": {
      label: "Market data",
      hint: "Candles, pair lists, black/whitelists and plot layouts.",
    },
    "bot-state": {
      label: "Bot state",
      hint: "Status, health, locks, trade counts and versions.",
    },
    "session-identity": {
      label: "Session identity",
      hint: "The caller's own identity and granted capabilities.",
    },
  };

/** Every kind in a stable order (editor lists all, checked = sensitive). */
export const ALL_INFO_KINDS: ReadonlyArray<InfoKind> = Object.keys(
  INFO_KIND_META,
) as ReadonlyArray<InfoKind>;
