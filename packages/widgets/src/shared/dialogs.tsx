// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Store } from "@tanstack/store";
import { useStore } from "@tanstack/react-store";
import { Modal, TextInput } from "@carbon/react";
import { useLocalStore } from "@nfi/ui";

/**
 * Promise-based dialog bus — the single replacement for `window.confirm`,
 * `window.prompt` and `window.alert` (never use those; they break the
 * terminal aesthetic and block the event loop).
 *
 * Any code (React handlers, palette commands, widgets) awaits
 * `requestConfirm` / `requestPrompt`; the `<DialogHost/>` rendered once per
 * shell shows the Carbon `Modal` and resolves the promise.
 */

interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly danger?: boolean;
}

interface PromptOptions {
  readonly title: string;
  readonly label: string;
  readonly initialValue?: string;
  readonly placeholder?: string;
  readonly confirmLabel: string;
}

type DialogRequest =
  | ({ readonly id: number; readonly kind: "confirm" } & ConfirmOptions & {
        readonly resolve: (confirmed: boolean) => void;
      })
  | ({ readonly id: number; readonly kind: "prompt" } & PromptOptions & {
        readonly resolve: (value: string | null) => void;
      });

const dialogStore = new Store<{ readonly current: DialogRequest | null }>({
  current: null,
});

let dialogSeq = 0;

export function requestConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dialogSeq += 1;
    dialogStore.setState(() => ({
      current: { id: dialogSeq, kind: "confirm", ...options, resolve },
    }));
  });
}

export function requestPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    dialogSeq += 1;
    dialogStore.setState(() => ({
      current: {
        id: dialogSeq,
        kind: "prompt",
        initialValue: "",
        ...options,
        resolve,
      },
    }));
  });
}

function dismiss(): void {
  dialogStore.setState(() => ({ current: null }));
}

export function DialogHost() {
  const current = useStore(dialogStore, (s) => s.current);
  // Prompt input draft, re-seeded per request id (identity-compare store:
  // the write only fires when a new dialog actually opened).
  const draftStore = useLocalStore({ id: 0, value: "" });

  if (current !== null && draftStore.state.id !== current.id) {
    draftStore.setState(() => ({
      id: current.id,
      value: current.kind === "prompt" ? (current.initialValue ?? "") : "",
    }));
  }

  const value = useStore(draftStore, (s) => s.value);

  if (!current) return null;

  if (current.kind === "confirm") {
    return (
      <Modal
        open
        size="sm"
        modalHeading={current.title}
        primaryButtonText={current.confirmLabel}
        secondaryButtonText="Cancel"
        danger={current.danger ?? false}
        onRequestSubmit={() => {
          current.resolve(true);
          dismiss();
        }}
        onRequestClose={() => {
          current.resolve(false);
          dismiss();
        }}
      >
        <p style={{ fontSize: "0.875rem" }}>{current.message}</p>
      </Modal>
    );
  }

  const trimmed = value.trim();

  const submit = () => {
    current.resolve(trimmed.length > 0 ? value : null);
    dismiss();
  };

  return (
    <Modal
      open
      size="sm"
      modalHeading={current.title}
      primaryButtonText={current.confirmLabel}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={trimmed.length === 0}
      onRequestSubmit={submit}
      onRequestClose={() => {
        current.resolve(null);
        dismiss();
      }}
    >
      <TextInput
        id={`nfi-dialog-input-${current.id}`}
        labelText={current.label}
        placeholder={current.placeholder}
        value={value}
        onChange={(event) =>
          draftStore.setState((p) => ({ ...p, value: event.target.value }))
        }
        onKeyDown={(event) => {
          if (event.key === "Enter" && trimmed.length > 0) {
            event.preventDefault();
            submit();
          }
        }}
        autoFocus
      />
    </Modal>
  );
}
