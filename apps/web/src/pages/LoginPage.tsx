// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button, InlineNotification, PasswordInput, TextInput, Tile } from "@carbon/react"
import { formatQueryError } from "../api"
import { login } from "../auth/session"
import { useFirstRunGate } from "../auth/firstRun"

/**
 * Sign-in page (`/login`). Thin by design: credentials go straight to the
 * backend (`Auth.login`), which sets the HttpOnly session cookie — no token
 * ever touches JavaScript. On success the whole shell re-derives its state
 * (capabilities + workspace) and returns to the terminal.
 *
 * Anonymous visitors are legitimate (public grant): the header's "Sign in"
 * action is the only path here; nothing auto-redirects — except the first
 * run on a deployment without a root account, where the only useful action
 * is claiming root (`/setup`).
 */
export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Fresh deployment: /login has nothing to authenticate against yet.
  useFirstRunGate()

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      void navigate({ to: "/" })
    } catch (cause) {
      setError(formatQueryError(cause) ?? "Sign-in failed")
      setBusy(false)
    }
  }

  return (
    <div className="nfi-login-host">
      <Tile className="nfi-login-tile">
        <h1 className="nfi-login-title">NFI Desk</h1>
        <p className="nfi-login-subtitle">
          Sign in to manage the terminal. Not signed in? The shared public
          dashboard stays available — sign-in only unlocks what your user is
          granted.
        </p>
        <form className="nfi-login-form" onSubmit={submit}>
          <TextInput
            id="login-username"
            labelText="Username"
            placeholder="root"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <PasswordInput
            id="login-password"
            labelText="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <InlineNotification
              kind="error"
              title="Sign-in failed"
              subtitle={error}
              hideCloseButton
              lowContrast
            />
          ) : null}
          <div className="nfi-login-actions">
            <Button type="submit" disabled={busy || username.trim().length === 0 || password.length === 0}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Button kind="secondary" type="button" onClick={() => void navigate({ to: "/" })}>
              Continue without signing in
            </Button>
          </div>
        </form>
      </Tile>
    </div>
  )
}
