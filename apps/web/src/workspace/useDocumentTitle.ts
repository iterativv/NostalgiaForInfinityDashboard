// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect } from "react";

/**
 * Sync `document.title` with the visible page.
 *
 * Pass the full title (`"Home — nfi-desk"`); pass `null` to leave the
 * current title untouched (lets a child route own the title while the
 * shared shell stays mounted). Restores the previous title on unmount so
 * route transitions never leave a stale label behind.
 */
export function useDocumentTitle(title: string | null): void {
  useEffect(() => {
    if (title === null) return;

    const previous = document.title;

    document.title = title;

    return () => {
      document.title = previous;
    };
  }, [title]);
}
