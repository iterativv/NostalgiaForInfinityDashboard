// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Button, Tag } from "@carbon/react";
import { useCapability } from "./live/live";
import { InstanceDot, useInstanceColors } from "./shared/instanceColors";

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
  const { colorOf } = useInstanceColors();
  const color = colorOf(instanceId) ?? undefined;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        justifyContent: "space-between",
        minWidth: 0,
        width: "100%",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "0.125rem",
          minWidth: 0,
          flex: "1 1 auto",
        }}
      >
        <span
          style={{
            fontSize: "0.875rem",
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
          }}
        >
          {color ? <InstanceDot color={color} title={name} /> : null}
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {name}{" "}
            {isDefault ? (
              <span style={{ opacity: 0.55, fontWeight: 400 }}>(env)</span>
            ) : null}
          </span>
        </span>
        <span
          style={{
            fontSize: "0.75rem",
            opacity: 0.65,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            minWidth: 0,
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
