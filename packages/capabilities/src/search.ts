// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

/**
 * Server-side table search shared by the list capabilities.
 *
 * Widget filters must run BEFORE the backend applies `limit`/`offset`:
 * filtering the fetched window client-side silently drops matches that live
 * outside the window (the pagination case). Every free-text filter in the UI
 * therefore travels as a `search` capability option and is applied here, on
 * the full server-side result set, before slicing.
 */

/** Normalized needle, or `null` when there is effectively no search. */
export const normalizeSearch = (raw: string | undefined): string | null => {
  if (raw === undefined) return null;

  const needle = raw.trim().toLowerCase();

  return needle.length === 0 ? null : needle;
};

/**
 * Case-insensitive substring match across a row's searchable fields
 * (pair, bot name, strategy, tags — whichever the caller passes).
 */
export const matchesSearch = (
  fields: ReadonlyArray<string | undefined | null>,
  needle: string,
): boolean =>
  fields.some((field) => (field ?? "").toLowerCase().includes(needle));

/**
 * Filter rows server-side, preserving order. Always returns a fresh array —
 * snapshots are re-decoded per poll frame anyway, so reference stability
 * buys nothing here and the mutable result satisfies the response schemas.
 */
export const applySearch = <T>(
  rows: ReadonlyArray<T>,
  fieldsOf: (row: T) => ReadonlyArray<string | undefined | null>,
  search: string | undefined,
): T[] => {
  const needle = normalizeSearch(search);

  if (needle === null) return [...rows];

  return rows.filter((row) => matchesSearch(fieldsOf(row), needle));
};
