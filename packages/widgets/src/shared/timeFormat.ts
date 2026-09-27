// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Global time format — the one setting every timestamp in the desk follows.
 *
 * The preference lives here (not in the web app's prefs store) so the whole
 * widgets package can read it reactively: the shared `fmtDate`/`orderDate`
 * helpers, chart time axes (`timeIntervalFormats` are date-fns tokens, the
 * same vocabulary as the presets) and the settings page dropdown all pull
 * from one TanStack Store persisted in localStorage.
 */

import { useStore } from "@tanstack/react-store";
import { Store } from "@tanstack/store";
import { Schema } from "effect";
import { format, parseISO } from "date-fns";
import type { TimeIntervalFormats } from "@carbon/charts";

/** date-fns tokens for one preset (lowercase date, uppercase time). */
export interface TimeFormatPreset {
  readonly id: TimeFormatId;
  readonly label: string;
  /** Fixed sample shown in the settings dropdown (stable across renders). */
  readonly sample: string;
  /** Date + time — the default for timestamps in tables and tape rows. */
  readonly full: string;
  /** Date only. */
  readonly date: string;
  /** Time only, no seconds. */
  readonly time: string;
  /** Time only, with seconds (clocks, "last checked" stats). */
  readonly timePrecise: string;
}

export const TIME_FORMAT_IDS = [
  "iso-8601",
  "iso-8601-seconds",
  "eu-24h",
  "eu-24h-seconds",
  "eu-12h",
  "us-12h",
  "us-24h",
  "readable-24h",
  "readable-12h",
  "locale",
] as const;

export type TimeFormatId = (typeof TIME_FORMAT_IDS)[number];

/** Fixed reference date used for the stable dropdown samples. */
const SAMPLE_DATE = new Date(2026, 8, 26, 14, 5, 9);

/** Sample rendered for the "locale" preset (no tokens to format). */
const LOCALE_SAMPLE = SAMPLE_DATE.toLocaleString(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const PRESETS: Readonly<Record<Exclude<TimeFormatId, "locale">, TimeFormatPreset>> = {
  "iso-8601": {
    id: "iso-8601",
    label: "ISO 8601 (24h)",
    sample: "2026-09-26 14:05",
    full: "yyyy-MM-dd HH:mm",
    date: "yyyy-MM-dd",
    time: "HH:mm",
    timePrecise: "HH:mm:ss",
  },
  "iso-8601-seconds": {
    id: "iso-8601-seconds",
    label: "ISO 8601 (24h, seconds)",
    sample: "2026-09-26 14:05:09",
    full: "yyyy-MM-dd HH:mm:ss",
    date: "yyyy-MM-dd",
    time: "HH:mm",
    timePrecise: "HH:mm:ss",
  },
  "eu-24h": {
    id: "eu-24h",
    label: "European (24h)",
    sample: "26/09/2026 14:05",
    full: "dd/MM/yyyy HH:mm",
    date: "dd/MM/yyyy",
    time: "HH:mm",
    timePrecise: "HH:mm:ss",
  },
  "eu-24h-seconds": {
    id: "eu-24h-seconds",
    label: "European (24h, seconds)",
    sample: "26/09/2026 14:05:09",
    full: "dd/MM/yyyy HH:mm:ss",
    date: "dd/MM/yyyy",
    time: "HH:mm",
    timePrecise: "HH:mm:ss",
  },
  "eu-12h": {
    id: "eu-12h",
    label: "European (12h)",
    sample: "26/09/2026 2:05 PM",
    full: "dd/MM/yyyy h:mm a",
    date: "dd/MM/yyyy",
    time: "h:mm a",
    timePrecise: "h:mm:ss a",
  },
  "us-12h": {
    id: "us-12h",
    label: "US (12h)",
    sample: "09/26/2026 2:05 PM",
    full: "MM/dd/yyyy h:mm a",
    date: "MM/dd/yyyy",
    time: "h:mm a",
    timePrecise: "h:mm:ss a",
  },
  "us-24h": {
    id: "us-24h",
    label: "US (24h)",
    sample: "09/26/2026 14:05",
    full: "MM/dd/yyyy HH:mm",
    date: "MM/dd/yyyy",
    time: "HH:mm",
    timePrecise: "HH:mm:ss",
  },
  "readable-24h": {
    id: "readable-24h",
    label: "Readable (24h)",
    sample: "26 Sep 2026 14:05",
    full: "d MMM yyyy HH:mm",
    date: "d MMM yyyy",
    time: "HH:mm",
    timePrecise: "HH:mm:ss",
  },
  "readable-12h": {
    id: "readable-12h",
    label: "Readable (12h)",
    sample: "26 Sep 2026 2:05 PM",
    full: "d MMM yyyy h:mm a",
    date: "d MMM yyyy",
    time: "h:mm a",
    timePrecise: "h:mm:ss a",
  },
};

/** Dropdown entries: label + stable live-format sample per preset. */
export const TIME_FORMAT_ITEMS: ReadonlyArray<{
  readonly id: TimeFormatId;
  readonly label: string;
  readonly sample: string;
}> = TIME_FORMAT_IDS.map((id) =>
  id === "locale"
    ? { id, label: "Browser locale", sample: LOCALE_SAMPLE }
    : { id, label: PRESETS[id].label, sample: PRESETS[id].sample },
);

/** The default preset when nothing (valid) is persisted. */
export const DEFAULT_TIME_FORMAT: TimeFormatId = "iso-8601";

const TIME_FORMAT_STORAGE_KEY = "nfi-desk.time-format.v1";

/** Schema-decoded guard for a stored time-format id (see `isConfigNumber`). */
const isTimeFormatId = Schema.is(Schema.Literal(...TIME_FORMAT_IDS));

/** Schema-decoded guard for a raw millisecond timestamp. */
const isMsTimestamp = Schema.is(Schema.Number);

function readStoredTimeFormat(): TimeFormatId {
  if (typeof localStorage === "undefined") return DEFAULT_TIME_FORMAT;

  try {
    const raw = localStorage.getItem(TIME_FORMAT_STORAGE_KEY);

    if (raw && isTimeFormatId(raw)) return raw;
  } catch {
    // Storage unavailable — default format.
  }

  return DEFAULT_TIME_FORMAT;
}

/** The selected time format id (persisted, default ISO 8601). */
export const timeFormatStore = new Store<TimeFormatId>(
  readStoredTimeFormat(),
);

export function setTimeFormat(id: TimeFormatId): void {
  timeFormatStore.setState(() => id);

  try {
    localStorage.setItem(TIME_FORMAT_STORAGE_KEY, id);
  } catch {
    // Persistence is best-effort (private mode, quota).
  }
}

/** The preset for an id — "locale" is handled by the formatter, not tokens. */
export const timeFormatPreset = (id: TimeFormatId): TimeFormatPreset =>
  id === "locale"
    ? {
        id,
        label: "Browser locale",
        sample: LOCALE_SAMPLE,
        full: "",
        date: "",
        time: "",
        timePrecise: "",
      }
    : PRESETS[id];

/** Reactive read for components (re-renders when the setting changes). */
export function useTimeFormat(): TimeFormatId {
  return useStore(timeFormatStore, (id) => id);
}

// --- Formatting --------------------------------------------------------------
//
// "locale" delegates to Intl; every other preset renders date-fns tokens.

/** Anything a caller might hand a timestamp formatter (missing allowed). */
type TimeInput = string | number | Date | undefined | null;

/** Accepts ms numbers, Dates, and freqtrade's space-separated timestamps. */
const toDate = (value: TimeInput): Date | null => {
  if (value === undefined || value === null) return null;

  if (value instanceof Date) return value;

  if (isMsTimestamp(value)) {
    const d = new Date(value);

    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (!value) return null;

  try {
    const iso = value.includes("T") ? parseISO(value) : parseISO(value.replace(" ", "T"));

    return Number.isNaN(iso.getTime()) ? null : iso;
  } catch {
    return null;
  }
};

const localeString = (d: Date, options: Intl.DateTimeFormatOptions): string =>
  d.toLocaleString(undefined, options);

const formatWith = (
  value: TimeInput,
  pick: (preset: TimeFormatPreset) => string,
  localeFallback: (d: Date) => string,
  fallback = "—",
): string => {
  const d = toDate(value);

  if (!d) return fallback;

  const preset = timeFormatPreset(timeFormatStore.state);

  return preset.id === "locale" ? localeFallback(d) : format(d, pick(preset));
};

/** Timestamp as date + time in the configured format. */
export const formatDateTime = (value: TimeInput): string =>
  formatWith(
    value,
    (p) => p.full,
    (d) => localeString(d, { dateStyle: "medium", timeStyle: "short" }),
  );

/** Date only, in the configured format. */
export const formatDateOnly = (value: TimeInput): string =>
  formatWith(
    value,
    (p) => p.date,
    (d) => d.toLocaleDateString(),
  );

/** Time only (no seconds), in the configured format. */
export const formatTimeOnly = (value: TimeInput): string =>
  formatWith(
    value,
    (p) => p.time,
    (d) =>
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  );

/** Time only with seconds, in the configured format (clocks, live stats). */
export const formatTimePrecise = (value: TimeInput): string =>
  formatWith(
    value,
    (p) => p.timePrecise,
    (d) =>
      d.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
  );

// --- Chart time axes ---------------------------------------------------------

/**
 * `timeIntervalFormats` for a Carbon Charts time axis, derived from the
 * configured preset: sub-daily ticks carry the time pattern, day-and-up
 * ticks carry the date pattern (monthly/yearly compact to month-year so
 * long windows stay readable). Same tokens as the presets — the axis and
 * the tables can never disagree.
 */
export const chartTimeFormats = (id: TimeFormatId): TimeIntervalFormats => {
  const preset = timeFormatPreset(id);
  const day = preset.id === "locale" ? "dd MMM" : preset.date;
  const time = preset.id === "locale" ? "HH:mm" : preset.time;
  const month = preset.id === "locale" ? "MMM yyyy" : "MMM yyyy";

  return {
    "15seconds": { primary: time, secondary: time },
    minute: { primary: time, secondary: time },
    "30minutes": { primary: time, secondary: time },
    hourly: { primary: time, secondary: time },
    daily: { primary: day, secondary: day },
    weekly: { primary: day, secondary: day },
    monthly: { primary: month, secondary: month },
    quarterly: { primary: month, secondary: month },
    yearly: { primary: "yyyy", secondary: "yyyy" },
  };
};
