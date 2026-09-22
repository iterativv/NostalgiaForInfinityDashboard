// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Button, Tag } from "@carbon/react";
import { useCapability } from "./live/live";

/** One row in the instance manager: live reachability plus edit/delete. */
export function InstanceHealthRow({
  instanceId,
  name,
  baseUrl,
  isDefault,
  onDelete,
  deleting,
  onEdit,
  editing,
}: {
  instanceId: string;
  name: string;
  baseUrl: string;
  isDefault: boolean;
  onDelete: (id: string) => void;
  deleting: boolean;
  /** Absent = editing not offered (e.g. the read-only env default). */
  onEdit?: (id: string) => void;
  editing?: boolean;
}) {
  const { data, error } = useCapability("instances.health", { id: instanceId });
  const reachable = !error && data?.reachable === true;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        justifyContent: "space-between",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
          minWidth: 0,
        }}
      >
        <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>
          {name}{" "}
          {isDefault ? (
            <span style={{ opacity: 0.55, fontWeight: 400 }}>(env)</span>
          ) : null}
        </span>
        <span
          style={{
            fontSize: "0.75rem",
            opacity: 0.65,
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {baseUrl}
          {data?.version ? ` · v${data.version}` : ""}
          {data?.state ? ` · ${data.state}` : ""}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: "0.5rem",
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <Tag type={reachable ? "green" : "red"}>
          {reachable ? "up" : "down"}
        </Tag>
        {!isDefault && onEdit ? (
          <Button kind="ghost" size="sm" onClick={() => onEdit(instanceId)}>
            {editing ? "Close" : "Edit"}
          </Button>
        ) : null}
        {!isDefault ? (
          <Button
            kind="danger--ghost"
            size="sm"
            onClick={() => onDelete(instanceId)}
            disabled={deleting}
          >
            {deleting ? "…" : "Delete"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
