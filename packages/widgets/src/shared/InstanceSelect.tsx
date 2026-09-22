// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useCapability } from "../live/live";
import { SettingsSelect } from "./SettingsSelect";

/** Reserved `instanceId` meaning "every configured instance at once". */
export const ALL_INSTANCES = "all";

/**
 * Instance picker backed by the backend instance list.
 *
 * Robust by design (multi-instance support must never blank a settings
 * form): a stored id missing from the list renders as an explicit
 * "(unavailable)" entry instead of silently showing a different bot; while
 * the list is loading a disabled input keeps the control stable; and when
 * the list cannot be read at all (no `instances.list` grant, empty backend,
 * offline) the picker degrades to a manual id input rather than
 * disappearing.
 */
export function InstanceSelect({
  id,
  value,
  onChange,
  allowAll = false,
}: {
  id: string;
  value: string;
  onChange: (instanceId: string) => void;
  /** Prepend an "All instances" entry (fleet aggregate capabilities). */
  allowAll?: boolean;
}) {
  const { data, isLoading } = useCapability("instances.list", {});
  const instances = data?.instances ?? [];

  if (instances.length === 0) {
    return (
      <div className="nfi-settings-select">
        <label htmlFor={id}>
          {isLoading ? "Freqtrade instance" : "Freqtrade instance id"}
        </label>
        <input
          id={id}
          type="text"
          value={value}
          placeholder={isLoading ? "Loading instances…" : "default, or all"}
          disabled={isLoading}
          onChange={(event) => onChange(event.target.value)}
        />
        {!isLoading ? (
          <span className="nfi-settings-hint">
            Instance list unavailable (offline or not granted) — enter the id
            manually.
          </span>
        ) : null}
      </div>
    );
  }

  const items = instances.map((i) => ({
    id: i.id,
    text:
      i.id === "default"
        ? `default · ${i.baseUrl} (env)`
        : `${i.name} · ${i.baseUrl}`,
  }));
  if (allowAll) {
    items.unshift({ id: ALL_INSTANCES, text: "All instances (fleet)" });
  }
  // Honesty first: a stored id that no longer exists stays selected and is
  // labeled as unavailable — never silently swap in a different bot.
  if (!items.some((i) => i.id === value)) {
    items.push({ id: value, text: `${value} (unavailable)` });
  }
  return (
    <SettingsSelect
      id={id}
      label="Freqtrade instance"
      items={items}
      value={value}
      onChange={onChange}
    />
  );
}
