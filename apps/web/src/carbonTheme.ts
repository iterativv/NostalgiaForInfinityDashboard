// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties } from "react";

/**
 * Carbon color theming.
 *
 * The app themes through two Carbon knobs:
 *
 * - Base theme — the four official Carbon themes (`white`, `g10`, `g90`,
 *   `g100`), the only scopes `@carbon/react`'s Theme component and the
 *   compiled `@carbon/styles` stylesheet ship. Applied via `<Theme>`.
 * - Accent color — one of Carbon's chromatic color families (blue, cyan,
 *   teal, green, purple, magenta, red, orange). Carbon bakes its default
 *   (blue) swatches into the compiled theme scopes, so an accent layers
 *   `--cds-*` overrides for the interactive/brand token set on the Theme
 *   wrapper element, following Carbon's own light/dark swatch mapping:
 *   light bases use family-60 (70 hover, 80 active, 20 highlight), dark
 *   bases use family-50 (40 links, 30 link hover, 90 highlight).
 *
 * Swatch values are Carbon v11 (`@carbon/colors`) — stable, documented
 * constants, inlined here so no transitive dependency is imported.
 */

/** The four official Carbon themes (the compiled stylesheet's scopes). */
export const CARBON_THEMES = ["white", "g10", "g90", "g100"] as const;

export type CarbonTheme = (typeof CARBON_THEMES)[number];

export const THEME_LABELS: Record<CarbonTheme, string> = {
  white: "White",
  g10: "Gray 10",
  g90: "Gray 90",
  g100: "Gray 100",
};

export const CARBON_THEMES_DARK: ReadonlySet<CarbonTheme> = new Set([
  "g90",
  "g100",
]);

/** Carbon's chromatic color families usable as the accent. */
export const ACCENT_COLORS = [
  "blue",
  "cyan",
  "teal",
  "green",
  "purple",
  "magenta",
  "red",
  "orange",
] as const;

export type AccentColor = (typeof ACCENT_COLORS)[number];

export const ACCENT_LABELS: Record<AccentColor, string> = {
  blue: "Blue (Carbon default)",
  cyan: "Cyan",
  teal: "Teal",
  green: "Green",
  purple: "Purple",
  magenta: "Magenta",
  red: "Red",
  orange: "Orange",
};

/** Swatch dot color shown next to each option in the picker. */
export const ACCENT_SWATCHES: Record<AccentColor, string> = {
  blue: "#0f62fe",
  cyan: "#0072c3",
  teal: "#007d79",
  green: "#198038",
  purple: "#8a3ffc",
  magenta: "#d02670",
  red: "#da1e28",
  orange: "#ba4e00",
};

type Family = Record<20 | 30 | 40 | 50 | 60 | 70 | 80 | 90, string>;

const FAMILIES: Record<AccentColor, Family> = {
  blue: {
    20: "#d0e2ff",
    30: "#a6c8ff",
    40: "#78a9ff",
    50: "#4589ff",
    60: "#0f62fe",
    70: "#0043ce",
    80: "#002d9c",
    90: "#001d6c",
  },
  cyan: {
    20: "#bae6ff",
    30: "#82cfff",
    40: "#33b1ff",
    50: "#1192e8",
    60: "#0072c3",
    70: "#00539a",
    80: "#003a6d",
    90: "#012749",
  },
  teal: {
    20: "#9ef0f0",
    30: "#3ddbd9",
    40: "#08bdba",
    50: "#009d9a",
    60: "#007d79",
    70: "#005d5d",
    80: "#004144",
    90: "#022b30",
  },
  green: {
    20: "#a7f0ba",
    30: "#6fdc8c",
    40: "#42be65",
    50: "#24a148",
    60: "#198038",
    70: "#0e6027",
    80: "#044317",
    90: "#022d0d",
  },
  purple: {
    20: "#e8daff",
    30: "#d4bbff",
    40: "#be95ff",
    50: "#a56eff",
    60: "#8a3ffc",
    70: "#6929c4",
    80: "#491d8b",
    90: "#31135e",
  },
  magenta: {
    20: "#ffd6e8",
    30: "#ffafd2",
    40: "#ff7eb6",
    50: "#ee5396",
    60: "#d02670",
    70: "#9f1853",
    80: "#740937",
    90: "#510224",
  },
  red: {
    20: "#ffd7d9",
    30: "#ffb3b8",
    40: "#ff8389",
    50: "#fa4d56",
    60: "#da1e28",
    70: "#a2191f",
    80: "#750e13",
    90: "#520408",
  },
  orange: {
    20: "#ffd9be",
    30: "#ffb784",
    40: "#ff832b",
    50: "#eb6200",
    60: "#ba4e00",
    70: "#8a3800",
    80: "#5e2900",
    90: "#3e1a00",
  },
};

/**
 * Inline custom properties for the accent, layered on the Theme wrapper
 * (`<Theme style={…}>`). Blue is Carbon's compiled default — no overrides.
 * Danger/support tokens stay Carbon red on purpose: they are semantic,
 * not decorative.
 */
export function accentStyleFor(
  accent: AccentColor,
  theme: CarbonTheme,
): CSSProperties {
  if (accent === "blue") return {};

  const f = FAMILIES[accent];
  const dark = CARBON_THEMES_DARK.has(theme);

  const vars: CSSProperties & Record<`--cds-${string}`, string> = dark
    ? {
        "--cds-interactive": f[50],
        "--cds-border-interactive": f[50],
        "--cds-background-brand": f[60],
        "--cds-highlight": f[90],
        "--cds-link-primary": f[40],
        "--cds-link-primary-hover": f[30],
        "--cds-link-secondary": f[30],
        "--cds-button-primary": f[60],
        "--cds-button-primary-hover": f[70],
        "--cds-button-primary-active": f[80],
        "--cds-button-tertiary": f[50],
        "--cds-button-tertiary-hover": f[40],
        "--cds-button-tertiary-active": f[30],
        "--cds-support-info": f[50],
      }
    : {
        "--cds-interactive": f[60],
        "--cds-border-interactive": f[60],
        "--cds-icon-interactive": f[60],
        "--cds-background-brand": f[60],
        "--cds-focus": f[60],
        "--cds-highlight": f[20],
        "--cds-link-primary": f[60],
        "--cds-link-primary-hover": f[70],
        "--cds-link-secondary": f[70],
        "--cds-button-primary": f[60],
        "--cds-button-primary-hover": f[70],
        "--cds-button-primary-active": f[80],
        "--cds-button-tertiary": f[60],
        "--cds-button-tertiary-hover": f[70],
        "--cds-button-tertiary-active": f[80],
        "--cds-support-info": f[70],
      };

  return vars;
}
