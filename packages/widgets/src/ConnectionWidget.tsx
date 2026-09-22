// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Tag } from "@carbon/react";
import { defineWidget } from "@nfi/widget-sdk";
import { Stat, WidgetFrame } from "@nfi/ui";
import { useCapability } from "./live/live";
import { EmptyConfigSchema } from "./shared/config";

export function ConnectionWidget() {
  const health = useCapability("system.health", {});
  const backend = useCapability("system.backend-config", {});
  const isLoading = health.isLoading || backend.isLoading;
  const error = health.error ?? backend.error;
  const up = !health.error && health.data?.status === "ok";
  const reachable = health.data?.freqtrade === "reachable";
  const checkedAt = health.data?.timestamp
    ? new Date(health.data.timestamp)
    : undefined;
  return (
    <WidgetFrame title="Connection" isLoading={isLoading} error={error}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
          flex: "1 1 auto",
          minHeight: 0,
        }}
      >
        <div style={{ display: "flex", gap: "0.375rem", flexWrap: "wrap" }}>
          <Tag type={up ? "green" : "red"} size="sm">
            backend {up ? "up" : "down"}
          </Tag>
          <Tag type={reachable ? "green" : "red"} size="sm">
            freqtrade {health.data?.freqtrade ?? "unknown"}
          </Tag>
          {backend.data ? (
            <Tag
              type={backend.data.freqtradeConfigured ? "blue" : "gray"}
              size="sm"
            >
              {backend.data.freqtradeConfigured
                ? "configured"
                : "not configured"}
            </Tag>
          ) : null}
        </div>
        <div className="nfi-stat-grid nfi-stat-grid--fill">
          <Stat
            label="Freqtrade host"
            value={backend.data?.freqtradeHost ?? "—"}
            sub="masked · credentials stay server-side"
          />
          <Stat
            label="Last check"
            value={
              checkedAt
                ? checkedAt.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                    hour12: false,
                  })
                : "—"
            }
            sub="health poll every 10s"
          />
        </div>
      </div>
    </WidgetFrame>
  );
}

export const ConnectionWidgetDef = defineWidget({
  type: "connection",
  title: "Connection",
  description: "Backend health, freqtrade reachability and masked host.",
  configSchema: EmptyConfigSchema,
  defaultConfig: {},
  component: ConnectionWidget,
  capabilities: ["system.health", "system.backend-config"],
  minWidth: 260,
  minHeight: 100,
});
