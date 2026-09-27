// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { isJsonObject, type JsonValue } from "@nfi/capabilities";

/**
 * URL state for the terminal (`/`) — TanStack Router search params as state.
 *
 * Single source of truth for the terminal's shareable position (see
 * https://tanstack.com/blog/search-params-are-state): the route owns the
 * schema (`validateSearch` in `router.tsx` delegates here), components read
 * via the router and write via `navigate({ search })`.
 *
 * - `page` / `panel` — position. Always synced (store <-> URL) so copying
 *   the URL or hitting the header "Copy link" reproduces the same page and
 *   focused tab for another user on the same backend.
 * - `widget` / `config` — one-shot shared widget state. Set only by a tab's
 *   "Copy share link" (non-sensitive widgets only); applied once on load,
 *   then dropped from the URL by the sync hook so links never go stale.
 */

export interface TerminalSearch {
  readonly page?: string;
  readonly panel?: string;
  readonly widget?: string;
  readonly config?: string;
}

const MAX_ID_LENGTH = 128;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Largest widget-config JSON (bytes) we will put in a URL. */
export const MAX_CONFIG_JSON_BYTES = 3500;

/** Largest accepted `config` search param (base64url chars). */
export const MAX_CONFIG_PARAM_LENGTH = 5000;

const CONFIG_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Raw search-param value as the URL boundary produces it: a plain string, or
 * an array when the same key repeats (`?page=a&page=b`).
 */
export type RawSearchValue = string | ReadonlyArray<string>;

/** The unvalidated search bag TanStack Router hands to `validateSearch`. */
export type RawSearch = Readonly<Record<string, RawSearchValue | undefined>>;

/** Validated shareable id (page, panel, widget type) or undefined. */
export function sanitizeId(
  value: RawSearchValue | undefined,
): string | undefined {
  // Repeated keys arrive as arrays; share links only ever carry one value.
  const single = Array.isArray(value) ? value[0] : value;

  if (
    single === undefined ||
    single.length === 0 ||
    single.length > MAX_ID_LENGTH
  ) {
    return undefined;
  }

  return ID_PATTERN.test(single) ? single : undefined;
}

function sanitizeConfigParam(
  value: RawSearchValue | undefined,
): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;

  if (single === undefined) return undefined;

  if (single.length === 0 || single.length > MAX_CONFIG_PARAM_LENGTH) {
    return undefined;
  }

  return CONFIG_PATTERN.test(single) ? single : undefined;
}

/**
 * Route-owned search schema. Fast and total — validation runs on every
 * navigation, so this only checks shapes; `config` is decoded lazily by
 * the sync hook.
 */
export function parseTerminalSearch(search: RawSearch): TerminalSearch {
  return {
    page: sanitizeId(search["page"]),
    panel: sanitizeId(search["panel"]),
    widget: sanitizeId(search["widget"]),
    config: sanitizeConfigParam(search["config"]),
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";

  for (const byte of bytes) binary += String.fromCharCode(byte);

  const base64 =
    typeof Buffer !== "undefined"
      ? Buffer.from(binary, "binary").toString("base64")
      : btoa(binary);

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(encoded: string): Uint8Array | null {
  try {
    let base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const pad = base64.length % 4;

    if (pad !== 0) base64 += "=".repeat(4 - pad);

    const binary =
      typeof Buffer !== "undefined"
        ? Buffer.from(base64, "base64").toString("binary")
        : atob(base64);

    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index) ?? 0;
    }

    return bytes;
  } catch {
    return null;
  }
}

/** Encode a widget config as a URL-safe string, or undefined when too large. */
export function encodeWidgetConfig(
  config: Record<string, JsonValue>,
): string | undefined {
  let json: string;

  try {
    json = JSON.stringify(config);
  } catch {
    return undefined;
  }

  if (new TextEncoder().encode(json).length > MAX_CONFIG_JSON_BYTES) {
    return undefined;
  }

  try {
    return bytesToBase64Url(new TextEncoder().encode(json));
  } catch {
    return undefined;
  }
}

/** Decode a `config` param back to a widget config object, or null. */
export function decodeWidgetConfig(
  encoded: string,
): Record<string, JsonValue> | null {
  const bytes = base64UrlToBytes(encoded);

  if (!bytes) return null;

  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));

    // Arrays are JSON objects structurally — exclude them before the record
    // guard accepts their numeric keys as a config surface.
    if (Array.isArray(parsed) || !isJsonObject(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

/** Canonical position search for a store state (drops one-shot widget keys). */
export function buildPositionSearch(
  pageId: string,
  panelId: string | null,
): TerminalSearch {
  return {
    page: sanitizeId(pageId),
    panel: panelId === null ? undefined : sanitizeId(panelId),
    widget: undefined,
    config: undefined,
  };
}

/**
 * One-shot share search for a tab: position plus full widget state.
 * Null when any id is invalid or the config does not fit in a URL.
 */
export function buildWidgetShareSearch(
  pageId: string,
  panelId: string,
  widgetType: string,
  config: Record<string, JsonValue>,
): TerminalSearch | null {
  const page = sanitizeId(pageId);
  const panel = sanitizeId(panelId);
  const widget = sanitizeId(widgetType);

  if (!page || !panel || !widget) return null;

  const encoded = encodeWidgetConfig(config);

  if (!encoded) return null;

  return { page, panel, widget, config: encoded };
}

/** Pure URL builder (origin + path + search) for copying and tests. */
export function buildShareUrl(
  origin: string,
  path: string,
  search: TerminalSearch,
): string {
  const params = new URLSearchParams();

  if (search.page) params.set("page", search.page);

  if (search.panel) params.set("panel", search.panel);

  if (search.widget) params.set("widget", search.widget);

  if (search.config) params.set("config", search.config);

  const query = params.toString();

  return query.length > 0 ? `${origin}${path}?${query}` : `${origin}${path}`;
}
