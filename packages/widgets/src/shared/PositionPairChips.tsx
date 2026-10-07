// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Position pair quick selector — one-tap switching between open positions.
 *
 * The position-candle widgets follow open positions instead of a fixed
 * pair: this chip row lists every open pair (pair + signed PnL%, the bot
 * name on fleet views) so the chart jumps between positions without
 * opening settings. The `Auto` chip returns to following the newest open
 * position; a pinned pair that has since closed stays selectable via the
 * pair combobox in the toolbar.
 */

import { pnlClass } from "./format";

export interface PositionChipOption {
  /** Stable key (the pair on single-instance views, `bot · pair` on fleet). */
  readonly key: string;
  /** Pair label shown on the chip. */
  readonly label: string;
  /** Current profit % (colors the chip's PnL readout). */
  readonly pnl?: number;
  /** Trade count behind the chip (fleet views merge bots per pair). */
  readonly count?: number;
  /** Extra context (bot names on fleet views, `closed` for pinned pairs). */
  readonly detail?: string;
  /** True when the pair holds no open position anymore (pinned history). */
  readonly closed?: boolean;
}

export function PositionPairChips({
  options,
  activeKey,
  autoActive,
  onAuto,
  onPick,
}: {
  readonly options: ReadonlyArray<PositionChipOption>;
  /** Selected option key (null = auto). */
  readonly activeKey: string | null;
  readonly autoActive: boolean;
  readonly onAuto: () => void;
  readonly onPick: (key: string) => void;
}) {
  if (options.length === 0) return null;

  const fmtPnl = (pnl: number | undefined): string =>
    pnl === undefined || !Number.isFinite(pnl)
      ? ""
      : ` ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}%`;

  return (
    <div
      className="nfi-tf-group"
      role="group"
      aria-label="Open positions"
      title="Jump to an open position's chart"
      style={{ flexWrap: "wrap", rowGap: "0.25rem" }}
    >
      <button
        type="button"
        className={autoActive ? "nfi-tf-btn nfi-tf-active" : "nfi-tf-btn"}
        onClick={onAuto}
        aria-pressed={autoActive}
        title="Follow the newest position automatically (open, else the latest exit)"
      >
        Auto
      </button>
      {options.map((option) => {
        const active = !autoActive && activeKey === option.key;

        const title =
          option.detail !== undefined
            ? `${option.label} · ${option.detail}`
            : option.label;

        return (
          <button
            key={option.key}
            type="button"
            className={active ? "nfi-tf-btn nfi-tf-active" : "nfi-tf-btn"}
            onClick={() => onPick(option.key)}
            aria-pressed={active}
            title={title}
            style={option.closed ? { opacity: 0.55 } : undefined}
          >
            {option.label}
            {option.count !== undefined && option.count > 1 ? (
              <span style={{ opacity: 0.65 }}> ×{option.count}</span>
            ) : null}
            {option.pnl !== undefined && Number.isFinite(option.pnl) ? (
              <span className={pnlClass(option.pnl)}>{fmtPnl(option.pnl)}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
