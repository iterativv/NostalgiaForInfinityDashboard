// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Session-scoped widget config — the read-only-visitor fallback.
 *
 * `applyWidgetSettings` persists widget settings through the app's panel
 * sink, which REFUSES writes for signed-out visitors (shared dashboards
 * are read-only by design). The candle toolbars (timeframe buttons,
 * indicator toggles, chip pickers) are always visible though, so for an
 * anonymous visitor every click used to be a silent no-op — the reported
 * "switching timeframe does nothing".
 *
 * This hook keeps that UX honest: a patch first tries the real sink; when
 * the sink refuses, it lands in a per-browser session layer keyed by
 * panel id that overlays the panel's own config for this visit only.
 * Signed-in writes clear their keys from the session layer so the
 * persisted config stays the single source of truth.
 */

import { Schema } from "effect";
import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { applyWidgetSettings } from "./panelConfig";

/**
 * A session-storable config value. Candle widget configs are JSON
 * primitives (strings, numbers, booleans) — the same predicate that
 * guards the global-settings localStorage layer keeps junk out of the
 * session layer too.
 */
export type SessionConfigValue = string | number | boolean;

const isSessionValue = Schema.is(
  Schema.Union(Schema.String, Schema.Number, Schema.Boolean),
);

/** One panel's session overrides: config key → primitive value. */
export type SessionOverrideLayer = Readonly<
  Record<string, SessionConfigValue>
>;

const sessionOverrides = new Store<
  Readonly<Record<string, SessionOverrideLayer>>
>({});

const EMPTY_LAYER: SessionOverrideLayer = {};

export interface WidgetConfigSink<T extends object> {
  /** Effective config: panel config with this session's overrides merged. */
  readonly config: T;
  /** Persist when possible; otherwise keep the change for this session. */
  readonly patch: (patch: Partial<T>) => void;
}

/** Runtime-filtered view of a patch: primitives only, junk dropped. */
const primitivePatchOf = <T extends object>(
  patch: Partial<T>,
): SessionOverrideLayer => {
  const out = new Map<string, SessionConfigValue>();

  for (const [key, value] of Object.entries(patch)) {
    if (isSessionValue(value)) out.set(key, value);
  }

  return Object.fromEntries(out);
};

/**
 * Widget-side config binding with the session fallback. Pass the panel's
 * `config` prop and the widget type id used by `applyWidgetSettings`.
 */
export function useWidgetConfigSink<T extends object>(
  panelId: string,
  widgetType: string,
  base: T,
): WidgetConfigSink<T> {
  const layer = useStore(
    sessionOverrides,
    (state) => state[panelId] ?? EMPTY_LAYER,
  );

  const config: T = layer === EMPTY_LAYER ? base : { ...base, ...layer };

  const patch = (p: Partial<T>): void => {
    const persisted = applyWidgetSettings(panelId, widgetType, config, p);

    if (persisted) {
      // The write landed in the panel config (or the global settings
      // layer) — drop these keys from the session layer so it cannot
      // shadow the persisted values later.
      sessionOverrides.setState((state) => {
        const current = state[panelId];

        if (!current) return state;

        const next = { ...current };

        for (const key of Object.keys(p)) delete next[key];

        const panels = { ...state };

        if (Object.keys(next).length === 0) delete panels[panelId];
        else panels[panelId] = next;

        return panels;
      });

      return;
    }

    const sessionPatch = primitivePatchOf(p);

    if (Object.keys(sessionPatch).length === 0) return;

    sessionOverrides.setState((state) => ({
      ...state,
      [panelId]: { ...state[panelId], ...sessionPatch },
    }));
  };

  return { config, patch };
}
