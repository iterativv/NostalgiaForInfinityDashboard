// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import {
  Button,
  InlineNotification,
  PasswordInput,
  TextInput,
  Tile,
} from "@carbon/react";
import { useLocalStore } from "@nfi/ui";
import { formatQueryError } from "../api";
import { login } from "../auth/session";
import { useFirstRunGate } from "../auth/firstRun";
import { useDocumentTitle } from "../workspace/useDocumentTitle";

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
  const navigate = useNavigate();

  // One form store: credentials + submit status share a single state object.
  interface LoginFormState {
    username: string;
    password: string;
    error: string | null;
    busy: boolean;
  }

  const formStore = useLocalStore<LoginFormState>({
    username: "",
    password: "",
    error: null,
    busy: false,
  });

  const { username, password, error, busy } = useStore(formStore, (s) => s);

  // Fresh deployment: /login has nothing to authenticate against yet.
  useFirstRunGate();

  useDocumentTitle("Sign in — nfi-desk");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();

    // Latest values from the store, not the render-time closure.
    const current = formStore.state;

    if (current.busy) return;
    formStore.setState((p) => ({ ...p, error: null, busy: true }));

    try {
      await login(current.username.trim(), current.password);
      void navigate({ to: "/" });
    } catch (cause) {
      formStore.setState((p) => ({
        ...p,
        error: formatQueryError(cause) ?? "Sign-in failed",
        busy: false,
      }));
    }
  };

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
            onChange={(event) =>
              formStore.setState((p) => ({
                ...p,
                username: event.target.value,
              }))
            }
          />
          <PasswordInput
            id="login-password"
            labelText="Password"
            autoComplete="current-password"
            value={password}
            onChange={(event) =>
              formStore.setState((p) => ({
                ...p,
                password: event.target.value,
              }))
            }
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
            <Button
              type="submit"
              disabled={
                busy || username.trim().length === 0 || password.length === 0
              }
            >
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            <Button
              kind="secondary"
              type="button"
              onClick={() => void navigate({ to: "/" })}
            >
              Continue without signing in
            </Button>
          </div>
        </form>
      </Tile>
    </div>
  );
}
