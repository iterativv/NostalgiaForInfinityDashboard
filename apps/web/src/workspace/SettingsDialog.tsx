// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useForm } from "@tanstack/react-form"
import { Modal, TextInput, Toggle } from "@carbon/react"
import { queryClient, resolveApiBaseUrl } from "../api"
import { prefsStore, setApiBaseUrl, setLivePaused } from "../store"
import { rehydrateWorkspace } from "./store"

/**
 * Settings dialog — the web-shell preferences (backend base URL, live
 * pause) as a modal over the current page, replacing the former `/settings`
 * route: preferences are app-level, not a workspace destination. Defaults
 * re-read the live prefs on every mount (the shell renders this dialog
 * conditionally), and saving invalidates queries so widgets converge
 * immediately. Freqtrade credentials live in the backend process and are
 * never sent here.
 */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const form = useForm({
    defaultValues: {
      apiBaseUrl: resolveApiBaseUrl(),
      livePaused: prefsStore.state.livePaused,
    },
    validators: {
      onChange: ({ value }) => {
        if (value.apiBaseUrl.trim().length > 0) {
          try {
            const url = new URL(value.apiBaseUrl.trim())
            if (url.protocol !== "http:" && url.protocol !== "https:") {
              return {
                fields: {
                  apiBaseUrl: "Use an http(s) URL, or leave empty for same-origin.",
                },
              }
            }
          } catch {
            return {
              fields: {
                apiBaseUrl: "Use an http(s) URL, or leave empty for same-origin.",
              },
            }
          }
        }
        return undefined
      },
    },
    onSubmit: async ({ value }) => {
      setApiBaseUrl(value.apiBaseUrl.trim())
      setLivePaused(value.livePaused)
      await queryClient.invalidateQueries()
      await rehydrateWorkspace()
      onClose()
    },
  })

  return (
    <Modal
      open
      modalHeading="Settings"
      modalLabel="Connection"
      primaryButtonText="Save"
      secondaryButtonText="Cancel"
      onRequestClose={onClose}
      onRequestSubmit={() => {
        void form.handleSubmit()
      }}
    >
      <p style={{ fontSize: "0.875rem", opacity: 0.7, marginBottom: "1rem" }}>
        The browser only talks to the nfi-desk backend through the shared Effect HttpApi contract. Leave empty to
        use same-origin (`/api` proxy in dev). Freqtrade credentials live in the backend process and are never sent
        here.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void form.handleSubmit()
        }}
        style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
      >
        <form.Field
          name="apiBaseUrl"
          children={(field) => (
            <TextInput
              id="api-base-url"
              labelText="Backend base URL (optional)"
              placeholder="e.g. http://localhost:4000 — empty = same origin"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={field.handleBlur}
              invalid={field.state.meta.isTouched && field.state.meta.errors.length > 0}
              invalidText={field.state.meta.errors.join(", ")}
            />
          )}
        />
        <form.Field
          name="livePaused"
          children={(field) => (
            <Toggle
              id="live-paused"
              labelText="Pause live updates"
              toggled={field.state.value}
              onToggle={(checked) => field.handleChange(checked)}
            />
          )}
        />
      </form>
    </Modal>
  )
}
