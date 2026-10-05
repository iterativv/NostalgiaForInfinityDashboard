// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Per-instance color identity.
 *
 * Every surface that shows data from more than one freqtrade instance
 * (fleet charts, attributed rows, pickers, the manage page) needs a stable
 * way to answer "which bot does this line belong to". Known instances get
 * palette slots by their position in the configured list — guaranteed
 * distinct for up to `INSTANCE_COLOR_PALETTE.length` bots (the realistic
 * fleet; a hash would collide within small fleets). Keys the list cannot
 * resolve (offline, not granted, deleted mid-flight) fall back to a
 * deterministic hash so every surface still renders with SOME color.
 */

import type { CSSProperties } from "react";
import { useStore } from "@tanstack/react-store";
import { useCapability } from "../live/live";
import { shallow, useDerived } from "@nfi/ui";
import { ALL_INSTANCES } from "./InstanceSelect";
import { INSTANCE_COLOR_PALETTE_CB, colorBlindStore } from "./colorBlind";

/** Distinct hues that read on Carbon white/g10/g90/g100 alike. */
export const INSTANCE_COLOR_PALETTE: ReadonlyArray<string> = [
  "#4589ff", // blue
  "#42be65", // green
  "#ff832b", // orange
  "#d12771", // magenta
  "#8a3ffc", // purple
  "#08bdba", // teal
  "#fa4d56", // red
  "#f1c21b", // yellow
  "#3ddbd9", // cyan
  "#ee538b", // pink
  "#bae6ff", // light blue
  "#6fdc8c", // light green
];

/** Palette slot by list position (wraps past the palette size). */
export const instanceColorByIndex = (
  index: number,
  palette: ReadonlyArray<string> = INSTANCE_COLOR_PALETTE,
): string =>
  palette[((index % palette.length) + palette.length) % palette.length] ??
  palette[0]!;

/** FNV-1a — small, stable, no dependencies. */
const hashToIndex = (key: string, slots: number): number => {
  let hash = 0x811c9dc5;

  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return Math.abs(hash) % slots;
};

/** Deterministic fallback color for keys the instance list cannot resolve. */
export const instanceColorOf = (
  idOrName: string,
  palette: ReadonlyArray<string> = INSTANCE_COLOR_PALETTE,
): string => palette[hashToIndex(idOrName, palette.length)] ?? palette[0]!;

/**
 * Alpha-dimmed variant of a `#rrggbb` color — for secondary series of the
 * same instance (reference lines, closed-profit index vs all-profit index).
 */
export const dimColor = (hex: string, alpha = 0.55): string =>
  `${hex}${Math.round(Math.min(Math.max(alpha, 0), 1) * 255)
    .toString(16)
    .padStart(2, "0")}`;

/** CSS gradient covering the palette — the "all instances" marker. */
const ALL_INSTANCES_GRADIENT = `conic-gradient(${INSTANCE_COLOR_PALETTE.slice(
  0,
  8,
)
  .map(
    (color, index, all) =>
      `${color} ${(index / all.length) * 100}% ${((index + 1) / all.length) * 100}%`,
  )
  .join(", ")})`;

const DOT_STYLE = {
  display: "inline-block",
  width: "0.5rem",
  height: "0.5rem",
  borderRadius: "50%",
  flexShrink: 0,
} as const;

/** Colored dot marking one instance's data. */
export function InstanceDot({
  color,
  title,
}: {
  color: string;
  title?: string;
}) {
  return (
    <span
      role="img"
      aria-label={title ? `Instance color: ${title}` : "Instance color"}
      title={title}
      style={{ ...DOT_STYLE, backgroundColor: color }}
    />
  );
}

/** Multi-hue dot marking a fleet ("all instances") view. */
export function AllInstancesDot({
  title = "All instances",
}: {
  title?: string;
}) {
  return (
    <span
      role="img"
      aria-label="All instances"
      title={title}
      style={{ ...DOT_STYLE, background: ALL_INSTANCES_GRADIENT }}
    />
  );
}

/**
 * Fleet-view attribution marker: colored dot + instance name, for the bot
 * column of merged tables (open/closed positions, trade tape).
 */
export function InstanceTag({
  color,
  name,
}: {
  color: string | null;
  name: string | undefined;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.375rem",
        minWidth: 0,
      }}
    >
      {color ? <InstanceDot color={color} title={name} /> : null}
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {name ?? "—"}
      </span>
    </span>
  );
}

/**
 * Resolver for the caller's configured instances: a custom stored color
 * wins, otherwise ids and display names map to the owning palette slot by
 * list position; `"all"` maps to null (fleet marker); unknown keys fall
 * back to the hash so the hook works offline / ungranted.
 */
export interface InstanceColors {
  /** Effective color for an instance id or display name; fleet id yields null. */
  colorOf: (idOrName: string | undefined) => string | null;
  /** Position-based color ignoring any custom override (what "Automatic" shows). */
  autoColorOf: (idOrName: string | undefined) => string | null;
  /** The instance list backing the resolver (empty while loading/offline). */
  instances: ReadonlyArray<{ id: string; name: string; color?: string }>;
}

/**
 * Instance colors for the current deployment. Subscribes `instances.list`
 * (already cached by the live store for pickers) so ids AND display names
 * resolve to the same slot — `colorOf` prefers the instance's custom
 * stored color (`#rrggbb`), `autoColorOf` always reports the automatic
 * assignment (the editor previews that on its "Automatic" swatch).
 */
export function useInstanceColors(): InstanceColors {
  const { data } = useCapability("instances.list", {});
  const colorBlind = useStore(colorBlindStore, (enabled) => enabled);

  // Derived through a store: the resolver (and its Maps) is rebuilt only
  // when the instance list snapshot or the palette setting actually changes.
  return useDerived(
    [data, colorBlind] as const,
    ([data, colorBlind]) => {
      const palette = colorBlind
        ? INSTANCE_COLOR_PALETTE_CB
        : INSTANCE_COLOR_PALETTE;

      const instances = data?.instances ?? [];
      const indexOf = new Map<string, number>();
      const idOf = new Map<string, string>();

      instances.forEach((instance, index) => {
        indexOf.set(instance.id, index);
        indexOf.set(instance.name, index);
        idOf.set(instance.name, instance.id);
      });

      const autoColorOf = (idOrName: string | undefined): string | null => {
        if (idOrName === undefined || idOrName === "") return null;

        if (idOrName === ALL_INSTANCES) return null;

        const index = indexOf.get(idOrName);

        return index !== undefined
          ? instanceColorByIndex(index, palette)
          : instanceColorOf(idOrName, palette);
      };

      const colorOf = (idOrName: string | undefined): string | null => {
        if (idOrName === undefined || idOrName === "") return null;

        if (idOrName === ALL_INSTANCES) return null;

        // Resolve display names to their owning id first so a custom color
        // set on the instance applies to name-keyed lookups (chart series).
        const id = idOf.get(idOrName) ?? idOrName;
        const stored = instances.find((instance) => instance.id === id);

        return stored?.color ?? autoColorOf(idOrName);
      };

      return { colorOf, autoColorOf, instances };
    },
    { inputs: shallow },
  );
}

/**
 * Fleet-color editor for the instance add/edit forms: an "Automatic"
 * swatch (previewing the position-based assignment), the palette, and a
 * native color input for arbitrary hex. `value` is `""` for automatic or
 * a `#rrggbb` string.
 */
export function InstanceColorPicker({
  id,
  value,
  autoPreview,
  onChange,
}: {
  id: string;
  value: string;
  /** Position-based color the Automatic swatch previews; null = not yet known. */
  autoPreview: string | null;
  onChange: (color: string) => void;
}) {
  const ring = (selected: boolean): CSSProperties =>
    selected
      ? { outline: "2px solid var(--cds-icon-primary)", outlineOffset: "2px" }
      : {};

  // Swatches follow the active palette (standard or color-blind safe).
  const swatches = useStore(colorBlindStore, (enabled) =>
    enabled ? INSTANCE_COLOR_PALETTE_CB : INSTANCE_COLOR_PALETTE,
  );

  return (
    <div className="nfi-settings-select">
      <label htmlFor={id}>Fleet color</label>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          aria-label="Automatic color"
          aria-pressed={value === ""}
          title="Automatic — follows the instance list"
          onClick={() => onChange("")}
          style={{
            ...DOT_STYLE,
            width: "1.25rem",
            height: "1.25rem",
            border: "none",
            cursor: "pointer",
            background: "transparent",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            ...ring(value === ""),
          }}
        >
          {autoPreview ? (
            <InstanceDot color={autoPreview} />
          ) : (
            <AllInstancesDot />
          )}
        </button>
        {swatches.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={value === color}
            title={color}
            onClick={() => onChange(color)}
            style={{
              width: "1.25rem",
              height: "1.25rem",
              borderRadius: "50%",
              border: "none",
              cursor: "pointer",
              backgroundColor: color,
              ...ring(value === color),
            }}
          />
        ))}
        <input
          id={id}
          type="color"
          aria-label="Custom color"
          title="Custom color (any hex)"
          value={/^#[0-9a-f]{6}$/.test(value) ? value : "#ffffff"}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          style={{
            width: "1.75rem",
            height: "1.25rem",
            padding: 0,
            border: "none",
            background: "transparent",
            cursor: "pointer",
          }}
        />
      </div>
      <span className="nfi-settings-hint">
        Distinguishes this bot&apos;s lines and rows in fleet views.
        Automatic follows the instance list.
      </span>
    </div>
  );
}
