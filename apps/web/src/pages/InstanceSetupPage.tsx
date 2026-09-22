// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button, InlineNotification, PasswordInput, TextInput, Tile } from "@carbon/react"
import { createInstance, formatQueryError, queryClient } from "../api"
import { hydrateCapabilities, useCapabilities } from "../auth/capabilities"
import { dismissInstanceSetup } from "../auth/firstRun"

/**
 * First freqtrade connection (`/setup/instances`). Shown by the first-run
 * gate when a signed-in instance manager has no freqtrade to talk to yet:
 * no stored instance AND the env `default` has no credentials. Adding the
 * first connection lands the caller straight in the terminal; "skip for
 * now" stays anonymous to the gate for this browser session (widgets will
 * render the freqtrade-unreachable state until a connection exists).
 */
export function InstanceSetupPage() {
  const navigate = useNavigate()
  const capabilities = useCapabilities()
  const [name, setName] = useState("")
  // No hardcoded localhost prefill — the deployment's freqtrade is usually
  // elsewhere; the placeholder shows the expected shape instead.
  const [baseUrl, setBaseUrl] = useState("")
  const [username, setUsername] = useState("freqtrader")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void hydrateCapabilities()
  }, [])

  const skip = () => {
    dismissInstanceSetup()
    void navigate({ to: "/" })
  }

  // Not an instance manager? This screen has nothing to offer.
  const permitted =
    capabilities.status === "ready" &&
    capabilities.granted.includes("instances.list") &&
    capabilities.granted.includes("instances.create")
  useEffect(() => {
    if (capabilities.status === "ready" && !permitted) void navigate({ to: "/", replace: true })
  }, [capabilities.status, permitted, navigate])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    setError(null)
    if (name.trim().length === 0) {
      setError("Give the connection a name.")
      return
    }
    try {
      const url = new URL(baseUrl.trim())
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("protocol")
    } catch {
      setError("Base URL must be an http(s)://host:port URL.")
      return
    }
    setBusy(true)
    try {
      await createInstance({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        username,
        password,
      })
      // Drop the gate's cached "no instances" answer, otherwise the fresh
      // entry can still look stale for a moment and bounce straight back.
      queryClient.removeQueries({ queryKey: ["first-run"] })
      void navigate({ to: "/" })
    } catch (cause) {
      setError(formatQueryError(cause) ?? "Failed to add the freqtrade connection.")
      setBusy(false)
    }
  }

  return (
    <div className="nfi-login-host">
      <Tile className="nfi-login-tile">
        <h1 className="nfi-login-title">Connect freqtrade</h1>
        <p className="nfi-login-subtitle">
          No freqtrade instance is configured yet. Add your bot's REST API
          connection to bring the terminal alive — credentials stay in the
          backend process and are never exposed back to the browser.
        </p>
        <form className="nfi-login-form" onSubmit={submit}>
          <TextInput
            id="instance-name"
            labelText="Name"
            placeholder="e.g. binance-main"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextInput
            id="instance-url"
            labelText="Base URL"
            placeholder="http://freqtrade-host:8080"
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
          <TextInput
            id="instance-username"
            labelText="API username"
            placeholder="freqtrade api_server username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <PasswordInput
            id="instance-password"
            labelText="API password"
            placeholder="freqtrade api_server password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <InlineNotification
              kind="error"
              title="Could not add the connection"
              subtitle={error}
              hideCloseButton
              lowContrast
            />
          ) : null}
          <div className="nfi-login-actions">
            <Button type="submit" disabled={busy || name.trim().length === 0}>
              {busy ? "Connecting…" : "Connect freqtrade"}
            </Button>
            <Button kind="secondary" type="button" onClick={skip}>
              Skip for now
            </Button>
          </div>
        </form>
        <p className="nfi-login-subtitle" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
          Tip: enable freqtrade's <code>api_server</code> in your bot config
          (<code>listen_ip</code>, <code>listen_port</code>, <code>username</code>,{" "}
          <code>password</code>). You can add more connections later from the
          Freqtrade Instances widget.
        </p>
      </Tile>
    </div>
  )
}
