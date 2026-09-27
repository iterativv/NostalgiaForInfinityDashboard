// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import "@ibm/plex-sans/css/ibm-plex-sans-default.css";
import "@ibm/plex-mono/css/ibm-plex-mono-default.css";
import "@carbon/styles/css/styles.css";
import "@carbon/charts/styles.css";
import "../src/styles.css";
import { createRoot } from "react-dom/client";
import { Theme } from "@carbon/react";
import { useLocalStore, useStore, useStoreEffect } from "@nfi/ui";
import { setCapabilityTransport } from "@nfi/widgets/live";
import {
  LiveOwnerContext,
  PanelVisibleContext,
} from "@nfi/widgets/live";
import { Panel } from "../src/workspace/Panel";
import { widgetRegistry } from "../src/workspace/registry";
import { fixtureTransport } from "./fixtures";

// The stream pool must never open a real SSE connection in the harness:
// with `EventSource` undefined the pool skips scheduling entirely, so the
// seeded unary fixture data is the only data widgets ever see.
/** Harness-only `window` members (SSE kill switch, measure report hand-off). */
interface HarnessGlobals {
  EventSource: typeof EventSource | undefined;
  __MEASURE?: Record<string, FloorRecord>;
}

// SAFETY: the DOM lib types `window.EventSource` as always-present, but the
// harness must remove it; `window` is assignable to `HarnessGlobals`, so the
// single assertion only re-opens that one member for writing `undefined`.
(window as HarnessGlobals).EventSource = undefined;

// SAFETY: the fixture transport answers every capability name with
// shape-correct data (the fixtures mirror each capability's result), so the
// loose harness signature satisfies the per-name generic contract.
setCapabilityTransport(fixtureTransport as never);

const params = new URLSearchParams(window.location.search);

const only = params.get("type");

const measure = params.get("measure") === "1";

const definitions = widgetRegistry
  .listWidgets()
  .filter((d) => (only ? d.type === only : true));

/** Harness mount of one widget inside a resizable probe box. */
function Probe(props: {
  type: string;
  config: unknown;
  width: number;
  height: number;
}) {
  return (
    <div
      data-probe={props.type}
      style={{
        width: props.width,
        height: props.height,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        outline: "1px dashed rgba(255,255,255,0.4)",
        boxSizing: "border-box",
      }}
    >
      <PanelVisibleContext.Provider value={true}>
        <LiveOwnerContext.Provider value={`harness-${props.type}`}>
          <Panel
            panelId={`harness-${props.type}`}
            widgetType={props.type}
            widgetConfig={props.config}
            title={undefined}
            focused={false}
            registry={widgetRegistry}
            onActivate={() => {}}
            onClose={() => {}}
            showHeader={false}
          />
        </LiveOwnerContext.Provider>
      </PanelVisibleContext.Provider>
    </div>
  );
}

interface MeasureTarget {
  readonly type: string;
  readonly label: string;
  readonly config: unknown;
}

/**
 * Real horizontal overflow: the probe itself plus genuine scroll containers
 * (`.nfi-table-scroll` and any element whose computed overflow-x scrolls).
 * Ellipsis/hidden elements intentionally report scrollWidth > clientWidth —
 * counting them would poison every reading.
 */
function countRealOverflow(probe: HTMLElement): number {
  const candidates = [
    probe,
    ...Array.from(probe.querySelectorAll<HTMLElement>(".nfi-table-scroll")),
  ];

  return candidates.filter(
    (el) => el.scrollWidth - el.clientWidth > 1,
  ).length;
}

// `?measure=1` targets: the six widgets the min-size audit cares about,
// each mounted with the config a real dashboard pins (the default
// workspace's panel configs, which enable more columns than the schema
// defaults — that honesty drives the width floors).
const MEASURE_TARGETS: ReadonlyArray<MeasureTarget> = [
  {
    type: "open-positions",
    label: "open-positions (full columns)",
    config: {
      instanceId: "all",
      showBot: true,
      showDirection: true,
      showAmount: true,
      showStake: true,
      showOpenRate: true,
      showCurrentRate: true,
      showProfitAbs: false,
      showProfitPct: true,
    },
  },
  {
    type: "closed-positions",
    label: "closed-positions (full columns)",
    config: {
      instanceId: "all",
      showBot: true,
      showDirection: true,
      showStake: true,
      showOpenRate: true,
      showCloseRate: true,
      showCloseProfit: false,
      showProfitPct: true,
      showExitReason: true,
      showCloseDate: true,
    },
  },
  {
    type: "fleet-overview",
    label: "fleet-overview (bot comparison)",
    config: { instanceId: "all", showBalance: true },
  },
  {
    type: "daily-profit",
    label: "daily-profit (profit over time)",
    config: { instanceId: "all", bucket: "monthly", days: 12 },
  },
  {
    type: "cumulative-profit",
    label: "cumulative-profit",
    config: { instanceId: "all" },
  },
  {
    type: "wallet-history",
    label: "wallet-history",
    config: { instanceId: "all" },
  },
];

/** One bisection overflow reading. */
interface OverflowSample {
  width: number;
  overflowing: number;
}

/** Everything the measure mode reports for one target widget. */
interface FloorRecord {
  label?: string;
  overflowSamples?: OverflowSample[];
  floorWidth?: number;
  intrinsicTableWidth?: number | null;
  probeH?: number;
  scrollerH?: number | null;
  theadH?: number | null;
  rowH?: number | null;
  chromeH?: number | null;
  chartH?: number | null;
  chartTop?: number | null;
  scrollerTop?: number | null;
}

/**
 * Automated floor finder. Width: binary search the smallest probe width
 * whose panel body and table scrollers report zero horizontal overflow.
 * Height: the fixed chrome above the scroller/chart plus thead + two body
 * rows (tables scroll vertically), or chrome + chart floor for charts.
 */
function MeasureApp() {
  const stepStore = useLocalStore(0);
  const step = useStore(stepStore, (s) => s);
  // Ref-replacement accumulators: the probe effects below write them, the
  // run's end result reads them back — never subscribed, so in-place edits
  // stay invisible to renders, exactly like the old refs.
  const resultsStore = useLocalStore<Record<string, FloorRecord>>({});
  // Binary search state per target: lo = widest known-fitting width, hi =
  // narrowest known-overflowing width. Phases: 0 = wide mount, 1..9 = nine
  // bisections (enough for ±5px), 10 = structural measure at the floor.
  const searchStore = useLocalStore({ lo: 100, hi: 1500 });
  const targetIndex = Math.floor(step / 12);
  const phase = step % 12;
  const target = MEASURE_TARGETS[targetIndex];
  const WIDE = 2000;
  const TALL = 900;

  // Probe width by phase: wide seed mount, narrow final measure (chrome is
  // tallest there), bisection midpoint between the two otherwise.
  let width: number;

  if (phase === 0) {
    width = WIDE;
  } else if (phase === 10) {
    width = 520;
  } else {
    const { lo, hi } = searchStore.state;

    width = Math.round((lo + hi) / 2);
  }

  useStoreEffect(() => {
    if (!target || phase !== 0) return;

    const probe = document.querySelector<HTMLElement>(
      `[data-probe="${target.type}"]`,
    );

    if (!probe) return;

    const overflowing = countRealOverflow(probe);
    // Seed the search: a wide mount that already overflows means the floor
    // is beyond the sweep range — record it so the bisection still converges.
    searchStore.setState(() =>
      overflowing === 0 ? { lo: 100, hi: WIDE } : { lo: WIDE, hi: WIDE + 600 },
    );
  }, [phase, target]);

  useStoreEffect(() => {
    if (!target || phase === 0 || phase >= 10) return;

    const probe = document.querySelector<HTMLElement>(
      `[data-probe="${target.type}"]`,
    );

    if (!probe) return;

    const overflowing = countRealOverflow(probe);

    const record = (resultsStore.state[target.type] ??= {
      label: target.label,
      overflowSamples: [],
    });

    record.overflowSamples!.push({ width, overflowing });

    if (overflowing === 0) {
      // Fits at this width — the floor is at or below it.
      searchStore.setState((p) => ({ ...p, hi: Math.min(p.hi, width) }));
    } else {
      searchStore.setState((p) => ({ ...p, lo: Math.max(p.lo, width) }));
    }
  }, [phase, target, width]);

  useStoreEffect(() => {
    if (!target) {
      // SAFETY: the harness owns `window.__MEASURE` — it seeds it once, after
      // the run completes, and nothing else writes that key.
      (window as HarnessGlobals).__MEASURE = resultsStore.state;

      return;
    }

    if (phase !== 10) return;

    // Final measure at a narrow mount: the worst-case chrome a small card sees.
    const probe = document.querySelector<HTMLElement>(
      `[data-probe="${target.type}"]`,
    );

    if (!probe) return;

    const table = probe.querySelector("table");
    const scroller = probe.querySelector<HTMLElement>(".nfi-table-scroll");
    const head = table?.querySelector("thead");
    const row = table?.querySelector("tbody tr");
    const chart = probe.querySelector<HTMLElement>(".cds--chart-holder, [class*=chart]");
    // Intrinsic table width: unclamp width:100% briefly so the browser lays
    // the columns out at their content widths (nowrap cells), then restore.
    let intrinsic: number | null = null;

    if (table) {
      const prev = table.style.width;
      table.style.width = "max-content";
      intrinsic = Math.round(table.getBoundingClientRect().width);
      table.style.width = prev;
    }

    const record = (resultsStore.state[target.type] ??= {});

    record.floorWidth = searchStore.state.hi;
    record.intrinsicTableWidth = intrinsic;
    record.probeH = Math.round(probe.getBoundingClientRect().height);
    record.scrollerH = scroller ? Math.round(scroller.getBoundingClientRect().height) : null;
    record.theadH = head ? Math.round(head.getBoundingClientRect().height) : null;
    record.rowH = row ? Math.round(row.getBoundingClientRect().height) : null;
    record.chromeH = scroller
      ? Math.round(probe.getBoundingClientRect().height - scroller.getBoundingClientRect().height)
      : null;
    record.chartH = chart ? Math.round(chart.getBoundingClientRect().height) : null;
    record.chartTop = chart ? Math.round(chart.getBoundingClientRect().top - probe.getBoundingClientRect().top) : null;
    record.scrollerTop = scroller ? Math.round(scroller.getBoundingClientRect().top - probe.getBoundingClientRect().top) : null;
  }, [phase, target]);

  useStoreEffect(() => {
    const t = setTimeout(() => stepStore.setState((s) => s + 1), 40);

    return () => clearTimeout(t);
  }, [step]);

  if (!target || !measure) {
    return (
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "2rem",
          padding: "1.5rem",
          alignItems: "flex-start",
        }}
      >
        {definitions.map((definition) => (
          <div
            key={definition.type}
            style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
          >
            <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#f4f4f4" }}>
              {definition.title} — min {definition.minWidth}×
              {definition.minHeight}
            </span>
            <Probe
              type={definition.type}
              config={definition.defaultConfig}
              width={definition.minWidth}
              height={definition.minHeight}
            />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: "1rem" }}>
      <div style={{ color: "#f4f4f4", fontFamily: "monospace" }}>
        measuring {target.label} — step {phase}/33, width {width || TALL}px
      </div>
      <Probe
        type={target.type}
        config={target.config}
        width={width || WIDE}
        height={TALL}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <Theme theme="g100">
    <MeasureApp />
  </Theme>,
);
