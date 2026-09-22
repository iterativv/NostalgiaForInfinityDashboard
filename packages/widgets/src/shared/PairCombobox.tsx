// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { TextInput } from "@carbon/react";

/**
 * PairCombobox — searchable pair picker for whitelists of any size.
 *
 * A compact trigger shows the current pair; opening it portals a popup to
 * `#root` (escaping grid/panel overflow clipping, under the app theme)
 * with a search box and a scrollable, filtered list — type a fragment
 * ("USDT", "sol") to narrow hundreds of pairs instantly. Selecting writes
 * through `onChange`; Escape or an outside pointer closes.
 *
 * When the whitelist is unavailable (capability not granted, offline, or
 * not yet loaded), the combobox degrades to a manual-entry text input so
 * a known pair can still be typed.
 */

const POPUP_WIDTH_PX = 16 * 16;
const POPUP_MAX_HEIGHT_PX = 18 * 16;
/** Long whitelists render capped; the note tells the user to keep typing. */
const MAX_SHOWN = 300;

export function PairCombobox({
  id,
  value,
  pairs,
  onChange,
  label,
}: {
  /** Used by the manual-entry fallback input. */
  id: string;
  value: string;
  /** The bot's pair whitelist; the current pair is kept listed even when absent. */
  pairs: ReadonlyArray<string>;
  onChange: (pair: string) => void;
  /** Optional field label (settings-form usage; the toolbar omits it). */
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const options = useMemo(
    () => (pairs.includes(value) ? pairs : [value, ...pairs]),
    [pairs, value],
  );
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q.length === 0
      ? options
      : options.filter((p) => p.toLowerCase().includes(q));
  }, [options, query]);
  const shown = filtered.slice(0, MAX_SHOWN);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        !popupRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  // Manual-entry fallback: no readable whitelist to search.
  if (pairs.length === 0) {
    return (
      <TextInput
        id={id}
        labelText={label ?? "Pair (e.g. BTC/USDT)"}
        placeholder="e.g. BTC/USDT"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        size="sm"
      />
    );
  }

  const toggle = () => {
    setQuery("");
    setAnchor(triggerRef.current?.getBoundingClientRect() ?? null);
    setOpen((v) => !v);
  };

  const pick = (pair: string) => {
    setOpen(false);
    triggerRef.current?.focus();
    if (pair !== value) onChange(pair);
  };

  // Below the trigger (flipped above near the viewport bottom), clamped.
  const style: CSSProperties = (() => {
    if (!anchor) return { top: 0, left: 0, visibility: "hidden" };
    const height = Math.min(
      POPUP_MAX_HEIGHT_PX,
      Math.max(160, window.innerHeight - anchor.bottom - 16),
    );
    const below = anchor.bottom + 4;
    const flip = below + height > window.innerHeight;
    const top = flip ? Math.max(8, anchor.top - height - 4) : below;
    const left = Math.max(
      8,
      Math.min(window.innerWidth - POPUP_WIDTH_PX - 8, anchor.left),
    );
    return { top, left, height };
  })();

  const trigger = (
    <button
      ref={triggerRef}
      type="button"
      id={id}
      className="nfi-pair-combo-trigger"
      aria-haspopup="listbox"
      aria-expanded={open}
      title="Switch pair"
      onClick={toggle}
    >
      {value}
    </button>
  );

  return (
    <>
      {label ? (
        <div className="nfi-pair-combo-field">
          <label htmlFor={id}>{label}</label>
          {trigger}
        </div>
      ) : (
        trigger
      )}
      {open
        ? createPortal(
            <div
              ref={popupRef}
              role="listbox"
              aria-label="Pairs"
              className="nfi-pair-combo-popup"
              style={style}
            >
              <input
                ref={searchRef}
                type="text"
                className="nfi-pair-combo-search"
                placeholder="Search pair…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label="Search pair"
              />
              <div className="nfi-pair-combo-list">
                {shown.map((pair) => (
                  <button
                    key={pair}
                    type="button"
                    role="option"
                    aria-selected={pair === value}
                    className="nfi-pair-combo-option"
                    data-current={pair === value}
                    onClick={() => pick(pair)}
                  >
                    <span>{pair}</span>
                    {pair === value ? <span aria-hidden="true">✓</span> : null}
                  </button>
                ))}
                {filtered.length > MAX_SHOWN ? (
                  <span className="nfi-pair-combo-more">
                    +{filtered.length - MAX_SHOWN} more — keep typing to narrow
                  </span>
                ) : null}
              </div>
            </div>,
            document.getElementById("root") ?? document.body,
          )
        : null}
    </>
  );
}
