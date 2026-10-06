// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Tab, TabList, Tabs } from "@carbon/react";
import { capabilitiesStore } from "../../auth/capabilities";
import { SignInCta } from "../../auth/SignInCta";
import { AppShell } from "../../workspace/AppShell";
import type { RawSearch } from "../../workspace/urlState";
import { useDocumentTitle } from "../../workspace/useDocumentTitle";
import { AppearanceSettings } from "./AppearanceSettings";
import { ConnectionSettings } from "./ConnectionSettings";
import { InstancesManager } from "../InstancesPage";
import { ManageUsersContent } from "../ManageUsersPage";

/**
 * Settings (`/settings`) — ONE page for every configuration surface,
 * separated by tabs: appearance & layout, backend connection, freqtrade
 * instances and users & permissions (the users tab renders for callers
 * holding `users.list`; hiding it is cosmetic — the backend enforces every
 * capability either way). Signed-out visitors get the appearance tab alone
 * (their own per-browser preferences — no session needed); every other tab
 * asks them to sign in. The active tab is the `?tab=` search param, so
 * sections deep-link and the aside's single "Settings" entry lands on a
 * sensible default.
 *
 * Tab CONTENT mounts on selection only: heavy panels (instance health
 * checks, the users table) stay unmounted until visited, keeping the
 * first paint of the page as light as the terminal's.
 */

export const SETTINGS_TABS = [
  "appearance",
  "connection",
  "instances",
  "users",
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** Validate a `?tab=` value; unknown/absent falls back to appearance. */
export function parseSettingsTab(search: RawSearch): SettingsTab {
  // Repeated keys arrive as arrays; the tab link only ever carries one value.
  const requested = Array.isArray(search["tab"]) ? search["tab"][0] : search["tab"];

  const match = SETTINGS_TABS.find((entry) => entry === requested);

  return match ?? "appearance";
}

const TAB_LABELS: ReadonlyArray<{ id: SettingsTab; label: string }> = [
  { id: "appearance", label: "Appearance & layout" },
  { id: "connection", label: "Backend connection" },
  { id: "instances", label: "Freqtrade instances" },
  { id: "users", label: "Users & permissions" },
];

export function SettingsPage() {
  const navigate = useNavigate();
  // SAFETY: the `/settings` route owns this search schema (validateSearch in
  // router.tsx) — the loose view only reads the optional `tab` key.
  const search = useSearch({ strict: false }) as RawSearch;
  const tab = parseSettingsTab(search);

  const canManageUsers = useStore(capabilitiesStore, (s) =>
    s.granted.includes("users.list"),
  );

  // Signed-out visitors get their own appearance only: every other tab
  // needs a session (connection/instances manage deployment state, users
  // needs the grant). Appearance writes stay per-browser localStorage, so
  // it is safe without signing in.
  const authenticated = useStore(capabilitiesStore, (s) => s.authenticated);

  const tabs = TAB_LABELS.filter(
    (entry) =>
      (entry.id !== "users" || canManageUsers) &&
      (authenticated || entry.id === "appearance"),
  );

  const index = Math.max(
    0,
    tabs.findIndex((entry) => entry.id === tab),
  );

  const tabLabel = tabs[index]?.label ?? "Settings";

  useDocumentTitle(`Settings · ${tabLabel} — nfi-desk`);

  return (
    <AppShell>
      <main
        className="nfi-workspace-host nfi-settings-host"
        aria-label="Settings"
      >
        <div className="nfi-settings-page">
          <div>
            <h2 className="nfi-users-title">Settings</h2>
            <p className="nfi-users-subtitle">
              {authenticated
                ? "Appearance, the backend connection, freqtrade instances and user access — every configuration surface in one place."
                : "Appearance — your own display preferences for this browser. Sign in for the remaining sections."}
            </p>
          </div>
          <Tabs
            selectedIndex={index}
            onChange={({ selectedIndex }: { selectedIndex: number }) => {
              const entry = tabs[selectedIndex];

              if (!entry || entry.id === tab) return;
              void navigate({
                to: "/settings",
                search: { tab: entry.id },
                replace: true,
              });
            }}
          >
            <TabList contained aria-label="Settings sections">
              {tabs.map((entry) => (
                <Tab key={entry.id}>{entry.label}</Tab>
              ))}
            </TabList>
          </Tabs>
          {/* Tab content mounts on selection only — see module doc. */}
          <div className="nfi-settings-panel">
            {tab === "appearance" ? <AppearanceSettings /> : null}
            {authenticated ? (
              <>
                {tab === "connection" ? <ConnectionSettings /> : null}
                {tab === "instances" ? <InstancesManager /> : null}
                {tab === "users" && canManageUsers ? <ManageUsersContent /> : null}
              </>
            ) : tab === "appearance" ? null : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem",
                  alignItems: "flex-start",
                  padding: "1rem 0",
                }}
              >
                <p style={{ fontSize: "0.875rem", opacity: 0.7, margin: 0 }}>
                  This section needs a signed-in session.
                </p>
                <SignInCta />
              </div>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
