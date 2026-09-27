// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties } from "react";
import { shallow, useStore } from "@tanstack/react-store";
import { Search, Checkmark } from "@carbon/icons-react";
import { TextInput } from "@carbon/react";
import {
  canEnableWidget,
  type AnyWidgetDefinition,
  type WidgetRegistry,
} from "@nfi/widget-sdk";
import { isNonSensitiveCapabilities } from "@nfi/capabilities";
import {
  useDerived,
  useElementStore,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";
import { useEffectiveGranted } from "../auth/viewAs";
import { useSensitivity } from "../capabilities/sensitivity";

/**
 * Widget picker — opened from a tab group's "+" (or its empty state).
 * Searchable, grouped, and grid-aware: widgets already open in the target
 * grid are marked and focus instead of duplicating (see `openWidgetPanel`).
 * Widgets the caller is not permitted to enable stay VISIBLE but dimmed
 * with a "not permitted" badge — discoverability beats a shorter list, and
 * the badge tells the user what exists and why it is unavailable.
 */

/**
 * Functional groups, curated order. Each group answers "what job does the
 * widget do" (system state, instance fleet, P&L, wallet, trade tracking,
 * performance analysis, market watching) — NEVER a presentation trait
 * (relative-vs-absolute, sensitive-vs-not): the % and shareable variants
 * sit right next to the base widget they derive from. The array order IS
 * the display order (the list below sorts by group index, so the menu
 * reads like a workflow instead of an alphabet).
 */
const WIDGET_GROUPS: ReadonlyArray<{
  title: string;
  types: ReadonlyArray<string>;
}> = [
  {
    title: "Status & System",
    types: ["bot-status", "connection", "session-clock", "bot-config"],
  },
  {
    title: "Instances & Fleet",
    types: ["instances", "instances-table", "fleet-overview"],
  },
  {
    title: "Profit & Equity",
    types: [
      "profit",
      "profit-relative",
      "cumulative-profit",
      "daily-profit",
      "pnl-chart",
      "equity",
      "equity-relative",
    ],
  },
  {
    title: "Balance & Wallet",
    types: ["balance", "balance-relative", "wallet-history"],
  },
  {
    title: "Trades & Positions",
    types: [
      "open-trades",
      "positions-open-relative",
      "open-positions",
      "closed-positions",
      "closed-positions-relative",
      "trade-tape",
      "market-movers",
    ],
  },
  {
    title: "Performance & Risk",
    types: [
      "performance-stats",
      "strategy-breakdown",
      "tag-performance",
      "tag-performance-relative",
      "pair-summary",
      "exposure",
      "risk-monitor",
      "drawdown",
    ],
  },
  {
    title: "Markets & Charts",
    types: [
      "candle-chart",
      "fed-rate",
      "ticker-tape",
      "watchlist",
      "pair-universe",
      "pair-locks",
    ],
  },
  // Development fixtures trail every production group (see `groupRank`).
  {
    title: "Development",
    types: [
      "development.welcome",
      "development.inspector",
      "development.log",
    ],
  },
];

/** Rank a widget type renders at: curated group index (Development last). */
function groupRank(type: string): number {
  if (type.startsWith("development.")) return WIDGET_GROUPS.length - 1;

  const index = WIDGET_GROUPS.findIndex((group) => group.types.includes(type));

  // Unknown types (uninstalled plugins) trail every curated group.
  return index === -1 ? WIDGET_GROUPS.length : index;
}

/** Display title of the group a widget type belongs to. */
function groupOf(type: string): string {
  if (type.startsWith("development.")) return "Development";

  return (
    WIDGET_GROUPS.find((group) => group.types.includes(type))?.title ??
    "More widgets"
  );
}

export function WidgetPicker({
  registry,
  openWidgetTypes,
  anchor,
  onPick,
  onClose,
}: {
  registry: WidgetRegistry;
  /** Widget types already open in the target grid (marked, focus on click). */
  openWidgetTypes: ReadonlySet<string>;
  /** Screen rect of the "+" button; the popover anchors below it. */
  anchor: DOMRect | null;
  onPick: (widgetType: string) => void;
  onClose: () => void;
}) {
  // Picker state in one component store: search text, keyboard highlight,
  // and the result count the highlight was last reset against.
  const uiStore = useLocalStore({
    query: "",
    highlight: 0,
    listed: -1,
  });

  const ui = useStore(uiStore, (s) => s);

  const { store: inputEl, setElement: setInputEl } =
    useElementStore<HTMLInputElement>();

  const { store: panelEl, setElement: setPanelEl } =
    useElementStore<HTMLDivElement>();

  // View-as preview: badges follow the mocked grant.
  const granted = useEffectiveGranted();
  // Live sensitivity criteria (root-configurable): drives the
  // "non-sensitive" safe-to-share badge per widget.
  const { sensitiveKinds } = useSensitivity();

  const flat = useDerived(
    [registry, ui.query] as const,
    ([source, search]) => {
      const needle = search.trim().toLowerCase();

      const defs = source
        .listWidgets()
        .filter(
          (definition) =>
            needle.length === 0 ||
            definition.title.toLowerCase().includes(needle) ||
            definition.description.toLowerCase().includes(needle) ||
            definition.type.toLowerCase().includes(needle),
        );

      const order = new Map<string, number>();
      WIDGET_GROUPS.forEach((group, groupIndex) => {
        group.types.forEach((type, typeIndex) => {
          order.set(type, groupIndex * 100 + typeIndex);
        });
      });

      // Curated order: group index first (the array order above IS the
      // display order — sorting by title alphabetically scrambled the
      // groups into a random-looking menu), then in-group order.
      return [...defs].sort(
        (a, b) =>
          groupRank(a.type) - groupRank(b.type) ||
          (order.get(a.type) ?? 1000) - (order.get(b.type) ?? 1000) ||
          a.title.localeCompare(b.title),
      );
    },
    { inputs: shallow },
  );

  const grouped = useDerived(
    [flat] as const,
    ([items]) => {
      const out: Array<{ title: string; items: AnyWidgetDefinition[] }> = [];

      for (const definition of items) {
        const title = groupOf(definition.type);
        const group = out.find((entry) => entry.title === title);

        if (group) group.items.push(definition);
        else out.push({ title, items: [definition] });
      }

      return out;
    },
    { inputs: shallow },
  );

  // Reset the keyboard highlight whenever the result count changes — the
  // render-phase store write replacing the old length-keyed effect.
  if (ui.listed !== flat.length) {
    uiStore.setState((p) => ({ ...p, listed: flat.length, highlight: 0 }));
  }

  useStoreEffect(() => {
    inputEl.state?.focus();
  }, []);

  useStoreEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    const onPointer = (event: PointerEvent) => {
      const panel = panelEl.state;

      if (
        panel &&
        !panel.contains(event.target instanceof Node ? event.target : null)
      )
        onClose();
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  const choose = (definition: AnyWidgetDefinition | undefined) => {
    // Not-permitted entries render dimmed; picking one is a no-op (the
    // shell re-checks the same grant before opening).
    if (!definition || !canEnableWidget(definition, granted)) return;
    onPick(definition.type);
    onClose();
  };

  // Anchor below the "+" button, clamped into the viewport.
  // Wide enough (32rem) that widget titles + descriptions fit on one line
  // without wrapping — see `.nfi-palette-item` nowrap rules in styles.css.
  const style: CSSProperties = (() => {
    const width = 32 * 16;

    if (!anchor)
      return { top: "20vh", left: "50%", transform: "translateX(-50%)", width };

    const left = Math.max(
      8,
      Math.min(window.innerWidth - width - 8, anchor.left),
    );

    return {
      top: Math.min(window.innerHeight - 320, anchor.bottom + 4),
      left,
      width,
    };
  })();

  let cursor = -1;

  return (
    <div
      className="nfi-picker-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={setPanelEl}
        role="dialog"
        aria-modal="true"
        aria-label="Add widget"
        className="nfi-picker"
        style={style}
      >
        <TextInput
          ref={setInputEl}
          id="nfi-widget-search"
          labelText="Search widgets"
          hideLabel
          placeholder="Search widgets…"
          value={ui.query}
          onChange={(event) =>
            uiStore.setState((p) => ({ ...p, query: event.target.value }))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              choose(flat[ui.highlight]);
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              uiStore.setState((p) => ({
                ...p,
                highlight: Math.min(flat.length - 1, p.highlight + 1),
              }));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              uiStore.setState((p) => ({
                ...p,
                highlight: Math.max(0, p.highlight - 1),
              }));
            }
          }}
          size="sm"
        />
        <div role="listbox" aria-label="Widgets" className="nfi-picker-list">
          {flat.length === 0 ? (
            <div className="nfi-palette-empty">No matching widgets.</div>
          ) : (
            grouped.map((group) => (
              <div key={group.title}>
                <div className="nfi-picker-group">{group.title}</div>
                {group.items.map((definition) => {
                  cursor += 1;
                  const index = cursor;
                  const open = openWidgetTypes.has(definition.type);
                  const permitted = canEnableWidget(definition, granted);

                  const nonSensitive = isNonSensitiveCapabilities(
                    definition.capabilities,
                    sensitiveKinds,
                  );

                  const className = [
                    "nfi-palette-item",
                    index === ui.highlight ? "nfi-palette-item-active" : "",
                    permitted ? "" : "nfi-palette-item-disabled",
                  ]
                    .filter(Boolean)
                    .join(" ");

                  return (
                    <div
                      key={definition.type}
                      role="option"
                      aria-selected={index === ui.highlight}
                      aria-disabled={!permitted}
                      className={className}
                      title={
                        permitted
                          ? definition.description
                          : `${definition.description} — your user is missing this widget's capabilities`
                      }
                      onMouseEnter={() =>
                        uiStore.setState((p) => ({ ...p, highlight: index }))
                      }
                      onMouseDown={(event) => {
                        event.preventDefault();
                        choose(definition);
                      }}
                    >
                      <span className="nfi-palette-title">
                        {definition.title}
                      </span>
                      {permitted && nonSensitive ? (
                        <span
                          className="nfi-picker-badge nfi-picker-badge-safe"
                          title="Non-sensitive — exposes only kinds the root marked non-sensitive, safe to share"
                        >
                          non-sensitive
                        </span>
                      ) : null}
                      {!permitted ? (
                        <span className="nfi-picker-badge">not permitted</span>
                      ) : open ? (
                        <span
                          className="nfi-picker-open"
                          title="Already open in this grid — focuses it"
                        >
                          <Checkmark size={14} /> open
                        </span>
                      ) : (
                        <span className="nfi-palette-category">
                          {definition.description}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="nfi-picker-hint">
          <Search size={12} /> Already-open widgets in this cell focus instead
          of duplicating — open them from another cell for a second instance.
          Dimmed entries need capabilities your user does not hold. Green
          “non-sensitive” marks are safe to share.
        </div>
      </div>
    </div>
  );
}
