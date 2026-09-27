// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Trade sorting + filtering shared by the open/closed trade widgets.
 *
 * Default is newest-first (openDate / closeDate descending) — the tape-style
 * order busy terminals expect. Sorting is a pure, memoized step over the
 * live source so backend order (freqtrade oldest-first windows, fleet merges)
 * never leaks into the UI.
 */

export type SortDir = "asc" | "desc";

export type OpenSortKey =
  "openDate" | "pair" | "stake" | "profitPct" | "profitAbs";

export type ClosedSortKey =
  "closeDate" | "openDate" | "pair" | "stake" | "profit" | "profitPct";

/** Parse freqtrade `"YYYY-MM-DD HH:mm:ss"` (space-separated) to epoch ms. */
export const parseTradeTime = (value: string | undefined): number => {
  if (!value) return 0;

  const t = new Date(
    value.includes("T") ? value : value.replace(" ", "T"),
  ).getTime();

  return Number.isNaN(t) ? 0 : t;
};

const cmpStr = (a: string | undefined, b: string | undefined): number =>
  (a ?? "").localeCompare(b ?? "");

const cmpNum = (a: number | undefined, b: number | undefined): number =>
  (a ?? 0) - (b ?? 0);

const applyDir = (cmp: number, dir: SortDir): number =>
  dir === "asc" ? cmp : -cmp;

export interface OpenSortable {
  readonly openDate: string;
  readonly pair: string;
  readonly stakeAmount: number;
  readonly profitPct?: number | null;
  readonly profitAbs?: number | null;
}

export function sortOpenPositions<T extends OpenSortable>(
  rows: ReadonlyArray<T>,
  sortBy: OpenSortKey,
  dir: SortDir,
): T[] {
  const out = [...rows];

  out.sort((a, b) => {
    switch (sortBy) {
      case "pair":
        return applyDir(cmpStr(a.pair, b.pair), dir);
      case "stake":
        return applyDir(cmpNum(a.stakeAmount, b.stakeAmount), dir);
      case "profitPct":
        return applyDir(cmpNum(a.profitPct ?? 0, b.profitPct ?? 0), dir);
      case "profitAbs":
        return applyDir(cmpNum(a.profitAbs ?? 0, b.profitAbs ?? 0), dir);
      case "openDate":
      default:
        return applyDir(
          parseTradeTime(a.openDate) - parseTradeTime(b.openDate),
          dir,
        );
    }
  });

  return out;
}

export interface ClosedSortable extends OpenSortable {
  readonly closeDate?: string | null;
  readonly closeProfitAbs?: number | null;
  readonly closeProfitPct?: number | null;
  readonly profitAbs?: number | null;
  readonly profitPct?: number | null;
}

const closedProfit = (p: ClosedSortable): number =>
  p.closeProfitAbs ?? p.profitAbs ?? 0;

const closedProfitPct = (p: ClosedSortable): number =>
  p.closeProfitPct ?? p.profitPct ?? 0;

export function sortClosedPositions<T extends ClosedSortable>(
  rows: ReadonlyArray<T>,
  sortBy: ClosedSortKey,
  dir: SortDir,
): T[] {
  const out = [...rows];

  out.sort((a, b) => {
    switch (sortBy) {
      case "openDate":
        return applyDir(
          parseTradeTime(a.openDate) - parseTradeTime(b.openDate),
          dir,
        );
      case "pair":
        return applyDir(cmpStr(a.pair, b.pair), dir);
      case "stake":
        return applyDir(cmpNum(a.stakeAmount, b.stakeAmount), dir);
      case "profit":
        return applyDir(cmpNum(closedProfit(a), closedProfit(b)), dir);
      case "profitPct":
        return applyDir(cmpNum(closedProfitPct(a), closedProfitPct(b)), dir);
      case "closeDate":
      default:
        return applyDir(
          parseTradeTime(a.closeDate ?? a.openDate) -
            parseTradeTime(b.closeDate ?? b.openDate),
          dir,
        );
    }
  });

  return out;
}

// --- Relative (percent-only) rows --------------------------------------------

/**
 * Sort keys for the percent-only widgets: the relative rows carry weights
 * and percentages but never stake amounts or absolute profits.
 */
export type RelOpenSortKey = "openDate" | "pair" | "profitPct" | "weight";

export type RelClosedSortKey = "closeDate" | "openDate" | "pair" | "profitPct";

export interface RelOpenSortable {
  readonly openDate: string;
  readonly pair: string;
  readonly profitPct?: number | null;
  readonly allocationWeight?: number | null;
}

export interface RelClosedSortable {
  readonly openDate: string;
  readonly closeDate?: string | null;
  readonly pair: string;
  readonly profitPct?: number | null;
  readonly closeProfitPct?: number | null;
}

export function sortRelativeOpen<T extends RelOpenSortable>(
  rows: ReadonlyArray<T>,
  sortBy: RelOpenSortKey,
  dir: SortDir,
): T[] {
  const out = [...rows];

  out.sort((a, b) => {
    switch (sortBy) {
      case "pair":
        return applyDir(cmpStr(a.pair, b.pair), dir);
      case "profitPct":
        return applyDir(cmpNum(a.profitPct ?? 0, b.profitPct ?? 0), dir);
      case "weight":
        return applyDir(
          cmpNum(a.allocationWeight ?? 0, b.allocationWeight ?? 0),
          dir,
        );
      case "openDate":
      default:
        return applyDir(
          parseTradeTime(a.openDate) - parseTradeTime(b.openDate),
          dir,
        );
    }
  });

  return out;
}

export function sortRelativeClosed<T extends RelClosedSortable>(
  rows: ReadonlyArray<T>,
  sortBy: RelClosedSortKey,
  dir: SortDir,
): T[] {
  const out = [...rows];

  out.sort((a, b) => {
    switch (sortBy) {
      case "openDate":
        return applyDir(
          parseTradeTime(a.openDate) - parseTradeTime(b.openDate),
          dir,
        );
      case "pair":
        return applyDir(cmpStr(a.pair, b.pair), dir);
      case "profitPct":
        return applyDir(
          cmpNum(
            a.closeProfitPct ?? a.profitPct ?? 0,
            b.closeProfitPct ?? b.profitPct ?? 0,
          ),
          dir,
        );
      case "closeDate":
      default:
        return applyDir(
          parseTradeTime(a.closeDate ?? a.openDate) -
            parseTradeTime(b.closeDate ?? b.openDate),
          dir,
        );
    }
  });

  return out;
}
