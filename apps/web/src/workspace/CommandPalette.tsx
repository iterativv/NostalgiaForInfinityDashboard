// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { shallow, useStore } from "@tanstack/react-store";
import { TextInput } from "@carbon/react";
import {
  useDerived,
  useElementStore,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";
import type { Command } from "@nfi/widget-sdk";

/**
 * Command/Search launcher — App Shell infrastructure.
 *
 * Exposes the shell `Command`s (open widgets, splits, tabs, layouts,
 * reset). Deliberately simple substring filtering: its purpose is proving
 * the command architecture, not building search infrastructure.
 *
 * An optional `isDisabled` predicate lets the shell keep widget commands the
 * caller cannot use VISIBLE but inert (dimmed + "not permitted") — same
 * discoverability rule as the widget picker.
 */

export function CommandPalette({
  commands,
  initialQuery = "",
  isDisabled,
  onRun,
  onClose,
}: {
  commands: ReadonlyArray<Command>;
  initialQuery?: string;
  /** Marks commands that stay visible but must not run (e.g. ungranted widgets). */
  isDisabled?: (command: Command) => boolean;
  onRun: (commandId: string) => void;
  onClose: () => void;
}) {
  // Palette state in one component store: search text, keyboard highlight,
  // and the result count the highlight was last reset against.
  const uiStore = useLocalStore({
    query: initialQuery,
    highlight: 0,
    listed: -1,
  });

  const ui = useStore(uiStore, (s) => s);

  const { store: inputEl, setElement: setInputEl } =
    useElementStore<HTMLInputElement>();

  const { setElement: setListEl } = useElementStore<HTMLDivElement>();

  const filtered = useDerived(
    [commands, ui.query] as const,
    ([source, search]) => {
      const needle = search.trim().toLowerCase();

      if (!needle) return source;

      return source.filter(
        (command) =>
          command.title.toLowerCase().includes(needle) ||
          (command.category ?? "").toLowerCase().includes(needle) ||
          command.id.toLowerCase().includes(needle),
      );
    },
    { inputs: shallow },
  );

  const disabledFor = (command: Command): boolean =>
    isDisabled?.(command) ?? false;

  // Reset the keyboard highlight whenever the result count changes — the
  // render-phase store write replacing the old length-keyed effect.
  if (ui.listed !== filtered.length) {
    uiStore.setState((p) => ({ ...p, listed: filtered.length, highlight: 0 }));
  }

  useStoreEffect(() => {
    inputEl.state?.focus();
  }, []);

  const choose = (index: number) => {
    const command = filtered[index];

    if (command && !disabledFor(command)) {
      onRun(command.id);
      onClose();
    }
  };

  return (
    <div
      className="nfi-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="nfi-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command launcher"
      >
        <TextInput
          ref={setInputEl}
          id="nfi-command-search"
          labelText="Type a command"
          hideLabel
          placeholder="Type a command — Open Inspector, Split, Reset…"
          value={ui.query}
          onChange={(event) =>
            uiStore.setState((p) => ({ ...p, query: event.target.value }))
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown") {
              event.preventDefault();
              uiStore.setState((p) => ({
                ...p,
                highlight: Math.min(filtered.length - 1, p.highlight + 1),
              }));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              uiStore.setState((p) => ({
                ...p,
                highlight: Math.max(0, p.highlight - 1),
              }));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(ui.highlight);
            }
          }}
          size="sm"
        />
        <div
          ref={setListEl}
          role="listbox"
          aria-label="Commands"
          className="nfi-palette-list"
        >
          {filtered.length === 0 ? (
            <div className="nfi-palette-empty">No matching commands.</div>
          ) : (
            filtered.map((command, index) => {
              const disabled = disabledFor(command);

              const className = [
                "nfi-palette-item",
                index === ui.highlight ? "nfi-palette-item-active" : "",
                disabled ? "nfi-palette-item-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ");

              return (
                <div
                  key={command.id}
                  role="option"
                  aria-selected={index === ui.highlight}
                  aria-disabled={disabled}
                  className={className}
                  onMouseEnter={() =>
                    uiStore.setState((p) => ({ ...p, highlight: index }))
                  }
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(index);
                  }}
                >
                  <span className="nfi-palette-title">{command.title}</span>
                  {disabled ? (
                    <span className="nfi-picker-badge">not permitted</span>
                  ) : command.category ? (
                    <span className="nfi-palette-category">
                      {command.category}
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
