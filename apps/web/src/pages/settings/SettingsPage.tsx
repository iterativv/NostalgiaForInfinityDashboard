// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useNavigate, useSearch } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import { Tab, TabList, Tabs } from "@carbon/react";
import { capabilitiesStore } from "../../auth/capabilities";
import { AppShell } from "../../workspace/AppShell";
import type { RawSearch } from "../../workspace/urlState";
import { AppearanceSettings } from "./AppearanceSettings";
import { ConnectionSettings } from "./ConnectionSettings";
import { InstancesManager } from "../InstancesPage";
import { ManageUsersContent } from "../ManageUsersPage";

/**
 * Settings (`/settings`) — ONE page for every configuration surface,
 * separated by tabs: appearance & layout, backend connection, freqtrade
 * instances and users & permissions (the users tab renders for callers
 * holding `users.list`; hiding it is cosmetic — the backend enforces every
 * capability either way). The active tab is the `?tab=` search param, so
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

  const tabs = TAB_LABELS.filter(
    (entry) => entry.id !== "users" || canManageUsers,
  );

  const index = Math.max(
    0,
    tabs.findIndex((entry) => entry.id === tab),
  );

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
              Appearance, the backend connection, freqtrade instances and user
              access — every configuration surface in one place.
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
            {tab === "connection" ? <ConnectionSettings /> : null}
            {tab === "instances" ? <InstancesManager /> : null}
            {tab === "users" && canManageUsers ? <ManageUsersContent /> : null}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
