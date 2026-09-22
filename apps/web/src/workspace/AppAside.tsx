// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Button } from "@carbon/react";
import {
  Logout,
  Plug,
  Settings,
  UserAvatar,
  UserMultiple,
} from "@carbon/icons-react";
import { capabilitiesStore } from "../auth/capabilities";
import { logout } from "../auth/session";

/**
 * AppAside — the right-hand drawer behind the header's side-panel toggle.
 *
 * Search and grid layout stay on the header; this drawer carries the rest:
 * manage users (top, when the caller holds users.list), settings and
 * freqtrade instance connections under "System", and the account block
 * (identity, sign out) pinned to the bottom. Anonymous visitors get
 * "Sign in" instead. Hiding actions here is cosmetic — the backend
 * enforces every capability either way.
 *
 * The drawer hangs below the topbar so the toggle stays visible (flipping
 * to its close glyph); Escape and the overlay behind it also close it.
 */

export function AppAside({
  open,
  onClose,
  onSettings,
  onConnections,
}: {
  open: boolean;
  onClose: () => void;
  /** Open the settings dialog. */
  onSettings: () => void;
  /** Land on the freqtrade instance connections editor. */
  onConnections: () => void;
}) {
  const account = useStore(capabilitiesStore, (s) => s);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const canManage = account.granted.includes("users.list");
  const username = account.username ?? "user";
  const role = account.role ?? "user";

  // Every action closes the drawer first — the shell then opens the
  // requested surface above what is left of the page.
  const act = (action: () => void) => () => {
    onClose();
    action();
  };

  return (
    <div
      className="nfi-aside-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        id="nfi-aside"
        ref={panelRef}
        tabIndex={-1}
        role="complementary"
        aria-label="Menu"
        className="nfi-aside"
      >
        {canManage ? (
          <section aria-label="General">
            <h3 className="nfi-aside-title">General</h3>
            <Link to="/users" className="nfi-aside-item" onClick={onClose}>
              <UserMultiple size={16} />
              <span>Manage users</span>
            </Link>
          </section>
        ) : null}
        <section aria-label="System">
          <h3 className="nfi-aside-title">System</h3>
          <button
            type="button"
            className="nfi-aside-item"
            onClick={act(onSettings)}
          >
            <Settings size={16} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="nfi-aside-item"
            onClick={act(onConnections)}
          >
            <Plug size={16} />
            <span>Freqtrade connections</span>
          </button>
        </section>
        <section aria-label="Account" className="nfi-aside-account">
          <h3 className="nfi-aside-title">Account</h3>
          {account.authenticated ? (
            <>
              <div className="nfi-aside-identity">
                <span className="nfi-mono">{username}</span>
                <span
                  className="nfi-topbar-user-role"
                  data-role={role}
                  title={
                    role === "root"
                      ? "Root user — always holds every capability"
                      : undefined
                  }
                >
                  {role}
                </span>
              </div>
              <Button
                kind="danger"
                size="sm"
                className="nfi-aside-signout"
                renderIcon={Logout}
                onClick={act(() => void logout())}
              >
                Sign out
              </Button>
            </>
          ) : (
            <Link to="/login" className="nfi-aside-item" onClick={onClose}>
              <UserAvatar size={16} />
              <span>Sign in</span>
            </Link>
          )}
        </section>
      </aside>
    </div>
  );
}
