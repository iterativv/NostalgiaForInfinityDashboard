// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { TextInput } from "@carbon/react";
import {
  shallow,
  useDerived,
  useElementStore,
  useLocalStore,
  useStore,
  useStoreEffect,
} from "@nfi/ui";

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
  // One store for the popup's UI state: open flag, search text, and the
  // trigger rect the popup anchors to.
  interface ComboState {
    open: boolean;
    query: string;
    anchor: DOMRect | null;
  }

  const comboStore = useLocalStore<ComboState>({
    open: false,
    query: "",
    anchor: null,
  });

  const open = useStore(comboStore, (s) => s.open);
  const query = useStore(comboStore, (s) => s.query);
  const anchor = useStore(comboStore, (s) => s.anchor);

  const { store: triggerStore, setElement: setTriggerElement } =
    useElementStore<HTMLButtonElement>();

  const { store: popupStore, setElement: setPopupElement } =
    useElementStore<HTMLDivElement>();

  const { store: searchStore, setElement: setSearchElement } =
    useElementStore<HTMLInputElement>();

  const options = useDerived(
    [pairs, value] as const,
    ([pairs, value]) => (pairs.includes(value) ? pairs : [value, ...pairs]),
    { inputs: shallow },
  );

  const filtered = useDerived(
    [options, query] as const,
    ([options, query]) => {
      const q = query.trim().toLowerCase();

      return q.length === 0
        ? options
        : options.filter((p) => p.toLowerCase().includes(q));
    },
    { inputs: shallow },
  );

  const shown = filtered.slice(0, MAX_SHOWN);

  // Popup-open wiring is an external system (window listeners + focus); the
  // element stores are read at event time, exactly like the old refs.
  useStoreEffect(() => {
    if (!open) return;
    searchStore.state?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        comboStore.setState((p) => ({ ...p, open: false }));
        triggerStore.state?.focus();
      }
    };

    const onPointer = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;

      if (
        target &&
        !popupStore.state?.contains(target) &&
        !triggerStore.state?.contains(target)
      ) {
        comboStore.setState((p) => ({ ...p, open: false }));
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
    const rect = triggerStore.state?.getBoundingClientRect() ?? null;

    comboStore.setState((p) => ({ ...p, query: "", anchor: rect, open: !p.open }));
  };

  const pick = (pair: string) => {
    comboStore.setState((p) => ({ ...p, open: false }));
    triggerStore.state?.focus();

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
      ref={setTriggerElement}
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
              ref={setPopupElement}
              role="listbox"
              aria-label="Pairs"
              className="nfi-pair-combo-popup"
              style={style}
            >
              <input
                ref={setSearchElement}
                type="text"
                className="nfi-pair-combo-search"
                placeholder="Search pair…"
                value={query}
                onChange={(event) =>
                  comboStore.setState((p) => ({ ...p, query: event.target.value }))
                }
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
