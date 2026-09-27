// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  Activity,
  Bookmark,
  Calendar,
  ChartBar,
  ChartCandlestick,
  ChartDonut,
  ChartLine,
  ChartPie,
  Compass,
  CurrencyDollar,
  Dashboard,
  DataTable,
  Finance,
  Fire,
  Flag,
  Globe,
  Growth,
  Idea,
  Layers,
  Lightning,
  Meter,
  Money,
  Notebook,
  Portfolio,
  Report,
  Rocket,
  Scales,
  Screen,
  ShieldAlert,
  Star,
  Tag,
  Target,
  Time,
  Tools,
  Trophy,
  Wallet,
  Warning,
  type CarbonIconType,
} from "@carbon/icons-react";
import type { PageIconKey } from "./pages";

/**
 * Carbon icon per pages-bar icon key (see `pages.ts`). Preset pages derive
 * theirs from code (`candlestick`, `wallet`, `chart-line`, `shield`,
 * `globe`); custom pages persist their chosen key on the workspace
 * document.
 */

export const PAGE_ICONS: Record<PageIconKey, CarbonIconType> = {
  dashboard: Dashboard,
  candlestick: ChartCandlestick,
  globe: Globe,
  activity: Activity,
  warning: Warning,
  tools: Tools,
  screen: Screen,
  star: Star,
  "chart-line": ChartLine,
  money: Money,
  tag: Tag,
  time: Time,
  fire: Fire,
  rocket: Rocket,
  layers: Layers,
  "chart-bar": ChartBar,
  "chart-pie": ChartPie,
  "chart-donut": ChartDonut,
  wallet: Wallet,
  currency: CurrencyDollar,
  table: DataTable,
  notebook: Notebook,
  shield: ShieldAlert,
  trophy: Trophy,
  growth: Growth,
  finance: Finance,
  meter: Meter,
  report: Report,
  idea: Idea,
  bolt: Lightning,
  compass: Compass,
  flag: Flag,
  bookmark: Bookmark,
  calendar: Calendar,
  portfolio: Portfolio,
  target: Target,
  scales: Scales,
};

/** Render one icon key at `size`; unknown/absent keys render nothing. */
export function PageIconView({
  iconKey,
  size = 14,
}: {
  iconKey: PageIconKey | undefined;
  size?: number;
}) {
  const Icon = iconKey !== undefined ? PAGE_ICONS[iconKey] : undefined;

  return Icon ? <Icon size={size} /> : null;
}
