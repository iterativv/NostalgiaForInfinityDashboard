// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useStore } from "@tanstack/react-store";
import { Toggle } from "@carbon/react";
import type { CSSProperties } from "react";
import {
  ACCENT_COLORS,
  ACCENT_LABELS,
  ACCENT_SWATCHES,
  CARBON_THEMES,
  THEME_LABELS,
  type AccentColor,
  type CarbonTheme,
} from "../../carbonTheme";
import {
  prefsStore,
  setAccentColor,
  setColorTheme,
  setDisableWidgetMinSize,
} from "../../store";
import {
  TIME_FORMAT_ITEMS,
  setTimeFormat,
  timeFormatStore,
  type TimeFormatId,
} from "@nfi/widgets";
import { Dropdown } from "@carbon/react";

/**
 * Appearance & layout settings — theme, accent color, time format and
 * layout-behavior preferences as the "Appearance & layout" tab of the
 * `/settings` page (formerly the aside's appearance dialog). Every change
 * applies and persists immediately (the Carbon theme scope and the accent's
 * `--cds-*` overrides follow the store live — see `main.tsx` /
 * `carbonTheme.ts`; the time format store drives every timestamp, table
 * date and chart axis in the widgets package).
 */
export function AppearanceSettings() {
  const colorTheme = useStore(prefsStore, (state) => state.colorTheme);
  const accentColor = useStore(prefsStore, (state) => state.accentColor);
  const timeFormat = useStore(timeFormatStore, (id) => id);

  const disableWidgetMinSize = useStore(
    prefsStore,
    (state) => state.disableWidgetMinSize,
  );

  const swatchStyle = (color: string): CSSProperties => ({
    display: "inline-block",
    width: "0.75rem",
    height: "0.75rem",
    borderRadius: "50%",
    background: color,
    border: "1px solid var(--cds-border-strong, #8d8d8d)",
    marginRight: "0.5rem",
    verticalAlign: "-2px",
  });

  const sampleStyle = (selected: boolean): CSSProperties => ({
    marginLeft: "0.5rem",
    float: "right",
    fontFamily: "'IBM Plex Mono', ui-monospace, monospace",
    fontSize: "0.6875rem",
    color: selected
      ? "var(--cds-text-primary, #f4f4f4)"
      : "var(--cds-text-secondary, #a8a8a8)",
  });

  return (
    <div className="nfi-settings-inner">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <Dropdown<CarbonTheme>
          id="pref-color-theme"
          titleText="Theme"
          label="Theme"
          items={[...CARBON_THEMES]}
          itemToString={(theme) => (theme ? THEME_LABELS[theme] : "")}
          selectedItem={colorTheme}
          onChange={({ selectedItem }) => {
            if (selectedItem) setColorTheme(selectedItem);
          }}
        />
        <Dropdown<AccentColor>
          id="pref-accent-color"
          titleText="Color"
          label="Color"
          items={[...ACCENT_COLORS]}
          itemToString={(accent) => (accent ? ACCENT_LABELS[accent] : "")}
          itemToElement={(accent) => (
            <>
              <span style={swatchStyle(ACCENT_SWATCHES[accent])} />
              {ACCENT_LABELS[accent]}
            </>
          )}
          selectedItem={accentColor}
          onChange={({ selectedItem }) => {
            if (selectedItem) setAccentColor(selectedItem);
          }}
        />
        <Dropdown<TimeFormatId>
          id="pref-time-format"
          titleText="Time format"
          label="Time format"
          items={TIME_FORMAT_ITEMS.map((item) => item.id)}
          itemToString={(id) =>
            TIME_FORMAT_ITEMS.find((item) => item.id === id)?.label ?? ""
          }
          itemToElement={(id) => {
            const item = TIME_FORMAT_ITEMS.find((entry) => entry.id === id);
            const selected = id === timeFormat;

            return (
              <>
                {item?.label ?? ""}
                <span style={sampleStyle(selected)}>{item?.sample ?? ""}</span>
              </>
            );
          }}
          selectedItem={timeFormat}
          onChange={({ selectedItem }) => {
            if (selectedItem) setTimeFormat(selectedItem);
          }}
        />
        <Toggle
          id="pref-disable-min-size"
          labelText="Disable widget minimum dimensions"
          labelA="Widgets enforce their minimum readable size"
          labelB="Widgets render at any size"
          toggled={disableWidgetMinSize}
          onToggle={(checked) => setDisableWidgetMinSize(checked)}
        />
      </div>
      <p style={{ fontSize: "0.875rem", opacity: 0.7 }}>
        Themes and colors follow the IBM Carbon Design System. The time format
        applies to every timestamp, table date and chart axis across the desk —
        trades, locks, tape, chart legends and clocks all re-render the moment
        it changes. Disabling minimum dimensions lets cards and windows shrink
        below a widget&apos;s readable size — content is never clamped or
        scaled, so very small cells may clip.
      </p>
    </div>
  );
}
