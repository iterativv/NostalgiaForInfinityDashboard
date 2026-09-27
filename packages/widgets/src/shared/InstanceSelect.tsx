// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useCapability } from "../live/live";
import {
  AllInstancesDot,
  InstanceDot,
  instanceColorByIndex,
} from "./instanceColors";
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
    <div>
      <SettingsSelect
        id={id}
        label="Freqtrade instance"
        items={items}
        value={value}
        onChange={onChange}
      />
      <ColorHint value={value} instances={instances} />
    </div>
  );
}

/**
 * The selected instance's color — the same hue its series and rows carry
 * across fleet widgets (a custom stored color when set, otherwise the
 * automatic assignment). Native `<option>`s cannot be colored, so the dot
 * rides as a hint line under the select.
 */
function ColorHint({
  value,
  instances,
}: {
  value: string;
  instances: ReadonlyArray<{ id: string; name: string; color?: string }>;
}) {
  const instance = instances.find((i) => i.id === value);

  if (value === ALL_INSTANCES) {
    return (
      <span
        className="nfi-settings-hint"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "0.375rem",
        }}
      >
        <AllInstancesDot /> All instances — fleet views color one hue per bot.
      </span>
    );
  }

  if (!instance) return null;

  const color =
    instance.color ?? instanceColorByIndex(instances.indexOf(instance));

  return (
    <span
      className="nfi-settings-hint"
      style={{ display: "inline-flex", alignItems: "center", gap: "0.375rem" }}
    >
      <InstanceDot color={color} /> This bot&apos;s color in fleet charts and
      tables.
    </span>
  );
}
