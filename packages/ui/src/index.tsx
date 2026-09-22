// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { createContext, useContext, type ReactNode } from "react";
import { Button, InlineLoading, Tile } from "@carbon/react";
import {
  ErrorOutline,
  IncompleteError,
  InformationSquare,
  Locked,
  WarningAlt,
} from "@carbon/icons-react";

/**
 * @nfi/ui — shared React + IBM Carbon building blocks.
 * Used by `apps/web` today and the future desktop shell as-is.
 */

/** Every standardized widget state the shell knows how to draw. */
export type WidgetStateTone =
  "loading" | "error" | "forbidden" | "empty" | "warning" | "info";

const STATE_ICONS: Record<
  Exclude<WidgetStateTone, "loading">,
  typeof Locked
> = {
  error: ErrorOutline,
  forbidden: Locked,
  empty: IncompleteError,
  warning: WarningAlt,
  info: InformationSquare,
};

const STATE_CLASS: Record<Exclude<WidgetStateTone, "loading">, string> = {
  error: "nfi-widget-state-error",
  forbidden: "nfi-widget-state-forbidden",
  empty: "nfi-widget-state-empty",
  warning: "nfi-widget-state-warning",
  info: "nfi-widget-state-info",
};

/**
 * The single standardized widget-state surface. The widget manager (`Panel`)
 * renders it for every non-data state (forbidden, invalid config, unknown
 * type, render crash, too-small cell) and `WidgetFrame` renders it for data
 * states (loading / error) — widgets never hand-roll state markup again.
 */
export function WidgetStateView({
  tone,
  title,
  hint,
  detail,
  loadingDescription,
  children,
}: {
  tone: WidgetStateTone;
  title: string;
  /** Secondary explanation line — say what the user can do about it. */
  hint?: string;
  /** Tertiary line (e.g. the missing capability ids, required size). */
  detail?: string;
  loadingDescription?: string;
  /** Optional action row (e.g. a retry button) under the copy. */
  children?: ReactNode;
}) {
  if (tone === "loading") {
    return (
      <div className="nfi-widget-state nfi-widget-state-loading" role="status">
        <InlineLoading
          description={loadingDescription ?? "Loading live data…"}
        />
        {hint ? <p className="nfi-widget-state-hint">{hint}</p> : null}
      </div>
    );
  }
  const Icon = STATE_ICONS[tone];
  return (
    <div
      className={`nfi-widget-state ${STATE_CLASS[tone]}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <span className="nfi-widget-state-icon">
        <Icon size={20} />
      </span>
      <div className="nfi-widget-state-copy">
        <p className="nfi-widget-state-title">{title}</p>
        {hint ? <p className="nfi-widget-state-hint">{hint}</p> : null}
        {detail ? <p className="nfi-widget-state-detail">{detail}</p> : null}
        {children ? (
          <div className="nfi-widget-state-actions">{children}</div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Whether a formatted capability error is freqtrade answering 401 to the
 * saved credentials (`freqtrade login returned 401`, embedded JSON detail
 * included) — the one failure the user can fix themselves by editing the
 * instance, so it earns a dedicated CTA state instead of the generic
 * "live data unavailable" copy.
 */
export function isFreqtradeAuthError(
  error: string | null | undefined,
): boolean {
  if (!error) return false;
  return (
    error.includes("freqtrade login returned 401") ||
    /"status":\s*401/.test(error)
  );
}

/**
 * Shell-provided CTA handlers for widget error states. `fixCredentials`
 * takes the user to the freqtrade instance editor (System page); absent
 * (shell didn't provide it) the 401 state degrades to copy-only guidance.
 */
export const WidgetCtaContext = createContext<{
  fixCredentials?: () => void;
}>({});

/**
 * Widget chrome context, provided by the hosting panel. `hideTitle` hides
 * the frame's title text (the tab strip / panel header already shows it)
 * while keeping the actions row — one title per widget, never two.
 *
 * `contentSize` is the measured panel body (border box, 0×0 while hidden or
 * before the first measure). Widgets use it to switch between dense and full
 * presentations so every pixel of the cell carries information — e.g. a
 * donut widget renders its compact list below the donut's height budget
 * instead of clipping. 0×0 must be treated as "unknown": keep the full
 * presentation until a real measurement arrives.
 */
export const WidgetChromeContext = createContext<{
  hideTitle: boolean;
  contentSize: { width: number; height: number };
}>({
  hideTitle: false,
  contentSize: { width: 0, height: 0 },
});

export function WidgetFrame({
  title,
  actions,
  children,
  isLoading,
  error,
  hideTitle,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  isLoading?: boolean;
  error?: string | null;
  /** Explicit override; defaults to the hosting panel's chrome context. */
  hideTitle?: boolean;
}) {
  const chrome = useContext(WidgetChromeContext);
  const cta = useContext(WidgetCtaContext);
  const titleHidden = hideTitle ?? chrome.hideTitle;
  return (
    <Tile
      className="nfi-widget"
      style={{
        padding: 0,
        overflow: "hidden",
        // Flex column that fills the panel body: auto-height charts
        // (ChartBox, CandleChart) stretch to leftover space while taller
        // content (tables) still grows the tile and scrolls the panel.
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
      }}
    >
      {!titleHidden || actions ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: titleHidden ? "flex-end" : "space-between",
            gap: "0.5rem",
            padding: "0.25rem 0.5rem",
            borderBottom: "1px solid var(--cds-border-subtle)",
          }}
        >
          {!titleHidden ? (
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.375rem",
                minWidth: 0,
              }}
            >
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {title}
              </span>
            </span>
          ) : null}
          {actions ? (
            <div
              style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}
            >
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        style={{
          padding: "0.5rem",
          display: "flex",
          flexDirection: "column",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        {isLoading ? (
          <WidgetStateView
            tone="loading"
            title="Loading"
            loadingDescription="Loading live data…"
          />
        ) : null}
        {!isLoading && error ? (
          isFreqtradeAuthError(error) ? (
            <WidgetStateView
              tone="error"
              title="Freqtrade rejected the credentials"
              hint="The bot answered 401 Unauthorized to the saved username/password. Update the instance's credentials in the Freqtrade Instances widget (System page)."
              detail={error}
            >
              {cta.fixCredentials ? (
                <Button size="sm" onClick={cta.fixCredentials}>
                  Fix credentials
                </Button>
              ) : null}
            </WidgetStateView>
          ) : (
            <WidgetStateView
              tone="error"
              title="Live data unavailable"
              hint={error}
              detail="The live stream reconnects automatically — data resumes when the source recovers."
            />
          )
        ) : null}
        {!isLoading && !error ? children : null}
      </div>
    </Tile>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  /** Profit/loss coloring: green for gains, red for losses. */
  tone?: "positive" | "negative" | "neutral";
}) {
  const className =
    tone === "positive"
      ? "nfi-pnl-positive"
      : tone === "negative"
        ? "nfi-pnl-negative"
        : undefined;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "0.125rem",
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: "0.6875rem",
          opacity: 0.65,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </span>
      <span
        className={className}
        style={{
          fontSize: "1.0625rem",
          fontWeight: 600,
          fontFamily: "'IBM Plex Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          // Long values (strategy names) must never bleed into the neighbor
          // tile — truncation beats collision in a stretched KPI grid.
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      {sub ? (
        <span
          style={{
            fontSize: "0.6875rem",
            opacity: 0.65,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {sub}
        </span>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <WidgetStateView
      tone="empty"
      title={title}
      hint={hint ?? "Nothing to show yet."}
    />
  );
}

/**
 * Freqtrade-style boxed P&L value: colored border + tinted background with a
 * direction triangle, e.g. `▲ 31.66% (30.805)`. Tone comes from `value`,
 * falling back to `percent` then `absolute` — pass whichever numbers are
 * known; only the parts provided are rendered.
 */
export function PnlPill({
  value,
  percent,
  absolute,
  digits = 2,
  absoluteDigits = 3,
}: {
  /** Primary tone source (usually the percent being displayed). */
  value?: number | null;
  percent?: number | null;
  absolute?: number | null;
  digits?: number;
  absoluteDigits?: number;
}) {
  const toneSource =
    value !== undefined && value !== null
      ? value
      : percent !== undefined && percent !== null
        ? percent
        : (absolute ?? 0);
  const tone =
    toneSource > 0 ? "positive" : toneSource < 0 ? "negative" : "neutral";
  return (
    <span className={`nfi-pill nfi-pill-${tone}`}>
      {tone === "positive" ? "▲" : tone === "negative" ? "▼" : "•"}
      {percent !== undefined && percent !== null
        ? ` ${percent > 0 ? "+" : ""}${percent.toFixed(digits)}%`
        : ""}
      {absolute !== undefined && absolute !== null
        ? `${percent !== undefined && percent !== null ? " " : " "}(${absolute.toFixed(absoluteDigits)})`
        : ""}
    </span>
  );
}

/**
 * Freqtrade-style trade-mode badge: filled `Live` (amber) or `Dry` (teal)
 * chip shown next to a bot's name. Unknown mode renders nothing.
 */
export function ModeBadge({ dryRun }: { dryRun?: boolean }) {
  if (dryRun === undefined) return null;
  return (
    <span
      className={`nfi-mode-badge ${dryRun ? "nfi-mode-badge-dry" : "nfi-mode-badge-live"}`}
    >
      {dryRun ? "Dry" : "Live"}
    </span>
  );
}
