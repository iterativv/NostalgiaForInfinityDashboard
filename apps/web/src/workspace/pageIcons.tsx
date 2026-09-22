// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  Activity,
  ChartCandlestick,
  ChartLine,
  Dashboard,
  Fire,
  Globe,
  Layers,
  Money,
  Rocket,
  Screen,
  Star,
  Tag,
  Time,
  Tools,
  Warning,
  type CarbonIconType,
} from "@carbon/icons-react";
import type { PageIconKey } from "./pages";

/**
 * Carbon icon per pages-bar icon key (see `pages.ts`). The first seven
 * belong to preset pages; the rest exist for custom pages, whose chosen
 * key persists on the workspace document.
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
