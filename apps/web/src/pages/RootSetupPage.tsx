// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button, InlineNotification, PasswordInput, TextInput, Tile } from "@carbon/react"
import { MIN_ROOT_PASSWORD_LENGTH } from "@nfi/api-contract"
import { formatQueryError, runApi } from "../api"
import { hydrateCapabilities, useCapabilities } from "../auth/capabilities"
import { refreshSessionState } from "../auth/session"
import { dismissRootSetup } from "../auth/firstRun"

/**
 * First-run root setup (`/setup`). Shown while the deployment has no root
 * account: neither `ROOT_USERNAME`/`ROOT_PASSWORD` env nor a previously
 * provisioned one. The first visitor chooses the root username and password
 * — root always holds every capability and is otherwise immutable, exactly
 * like the env-configured variant. Submitting signs the caller in as root.
 *
 * Escape hatches: when root already exists the page says so (no second
 * claim), and "continue without setting up" skips this session (the public
 * anonymous surface keeps working; the gate re-prompts next session).
 */
export function RootSetupPage() {
  const navigate = useNavigate()
  const capabilities = useCapabilities()
  const [username, setUsername] = useState("root")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [setupToken, setSetupToken] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void hydrateCapabilities()
  }, [])

  // Provisioned meanwhile (or visited late)? Never offer a second claim.
  if (capabilities.status === "ready" && capabilities.rootProvisioned !== false) {
    return (
      <div className="nfi-login-host">
        <Tile className="nfi-login-tile">
          <h1 className="nfi-login-title">NFI Desk</h1>
          <p className="nfi-login-subtitle">
            This deployment already has a root account — nothing to set up.
            Sign in from the terminal to manage it.
          </p>
          <div className="nfi-login-actions">
            <Button kind="secondary" onClick={() => void navigate({ to: "/" })}>
              Go to the terminal
            </Button>
          </div>
        </Tile>
      </div>
    )
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (username.trim().length === 0) {
      setError("Choose a username for the root account.")
      return
    }
    if (password.length === 0) {
      setError("Choose a password for the root account.")
      return
    }
    if (password.length < MIN_ROOT_PASSWORD_LENGTH) {
      setError(`Use at least ${MIN_ROOT_PASSWORD_LENGTH} characters for the root password.`)
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match.")
      return
    }
    if (setupToken.trim().length === 0) {
      setError("Enter the one-time setup token from the server log.")
      return
    }
    setBusy(true)
    try {
      await runApi((client) =>
        client.Auth.setupRoot({
          payload: { username: username.trim(), password, setupToken: setupToken.trim() },
        }),
      )
      // The backend set the session cookie — re-derive the whole shell as root.
      await refreshSessionState()
      void navigate({ to: "/" })
    } catch (cause) {
      setError(formatQueryError(cause) ?? "Root setup failed")
      setBusy(false)
    }
  }

  return (
    <div className="nfi-login-host">
      <Tile className="nfi-login-tile">
        <h1 className="nfi-login-title">NFI Desk</h1>
        <p className="nfi-login-subtitle">
          This deployment has no admin account yet. Create the <strong>root</strong>{" "}
          user now — it always holds every capability and manages users,
          grants and instances. Claiming it needs the one-time setup token
          from the server log, so only someone with server access can take
          ownership.
        </p>
        {capabilities.status === "offline" ? (
          <InlineNotification
            kind="error"
            title="Backend unreachable"
            subtitle={capabilities.detail ?? "Cannot reach the backend right now."}
            hideCloseButton
            lowContrast
          />
        ) : null}
        <form className="nfi-login-form" onSubmit={submit}>
          <TextInput
            id="setup-username"
            labelText="Root username"
            placeholder="root"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <PasswordInput
            id="setup-password"
            labelText={`Password (at least ${MIN_ROOT_PASSWORD_LENGTH} characters)`}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <PasswordInput
            id="setup-confirm"
            labelText="Confirm password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
          />
          <TextInput
            id="setup-token"
            labelText="One-time setup token"
            helperText="Printed in the server log on first boot (docker compose logs -f nfi-desk). Anyone opening this screen first would become root, so the token proves you own the deployment."
            autoComplete="off"
            value={setupToken}
            onChange={(event) => setSetupToken(event.target.value)}
          />
          {error ? (
            <InlineNotification
              kind="error"
              title="Root setup failed"
              subtitle={error}
              hideCloseButton
              lowContrast
            />
          ) : null}
          <div className="nfi-login-actions">
            <Button
              type="submit"
              disabled={
                busy ||
                username.trim().length === 0 ||
                password.length < MIN_ROOT_PASSWORD_LENGTH ||
                confirm.length === 0 ||
                setupToken.trim().length === 0
              }
            >
              {busy ? "Creating root…" : "Create root account"}
            </Button>
            <Button
              kind="secondary"
              type="button"
              onClick={() => {
                dismissRootSetup()
                void navigate({ to: "/" })
              }}
            >
              Continue without setting up
            </Button>
          </div>
        </form>
      </Tile>
    </div>
  )
}
