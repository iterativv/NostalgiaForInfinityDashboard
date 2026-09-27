// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useStore } from "@tanstack/react-store";
import { Button, InlineNotification, Modal, Tag, Tile } from "@carbon/react";
import type { FreqtradeInstance } from "@nfi/api-contract";
import { NfiDataTable, useLocalStore, useStoreEffect, WidgetStateView, type NfiColumnDef } from "@nfi/ui";
import {
  InstanceDot,
  InstanceForm,
  formatDateTime,
  requestConfirm,
  useInstanceColors,
  type InstanceFormValues,
} from "@nfi/widgets";
import { credentialsFixStore } from "@nfi/widgets/live";
import { formatQueryError } from "../api";
import { useCapabilities } from "../auth/capabilities";
import { SignInCta } from "../auth/SignInCta";
import { callCapability } from "../capabilities/client";
import {
  refreshAllCapabilities,
  refreshCapability,
  useCapability,
} from "../capabilities/live";

/**
 * Freqtrade instance manager — the "Freqtrade instances" tab of the
 * `/settings` page (the `/instances` route redirects there).
 *
 * The dashboard's Freqtrade Instances widget covers quick in-view edits;
 * this panel is the full manager: every configured connection with its
 * per-instance color (the same color its series and rows carry across the
 * dashboard), live reachability, and add/edit/delete gated per action on
 * the `instances.*` capabilities. Passwords stay in the backend process —
 * the browser sends them once over these forms and never reads them back.
 */

/** Live reachability for one row (version/state from the bot itself). */
function InstanceHealthCell({ id }: { id: string }) {
  const { data, error, isLoading } = useCapability("instances.health", {
    id,
  });

  const reachable = !error && data?.reachable === true;

  const detail = [data?.version ? `v${data.version}` : undefined, data?.state]
    .filter(Boolean)
    .join(" · ");

  if (isLoading) return <Tag type="gray">checking…</Tag>;

  return (
    <Tag type={reachable ? "green" : "red"} title={error ?? undefined}>
      {reachable ? `up${detail ? ` · ${detail}` : ""}` : "down"}
    </Tag>
  );
}

export function InstancesManager() {
  const capabilities = useCapabilities();
  const granted = capabilities.granted;
  const list = useCapability("instances.list", {});
  const { colorOf } = useInstanceColors();

  const canList = granted.includes("instances.list");
  const canCreate = granted.includes("instances.create");
  const canUpdate = granted.includes("instances.update");
  const canRemove = granted.includes("instances.remove");

  // Editor state in one component store: add/edit dialog, in-flight delete,
  // and the last action error.
  interface InstancesUiState {
    addOpen: boolean;
    editing: FreqtradeInstance | null;
    deletingId: string | null;
    actionError: string | null;
  }

  const uiStore = useLocalStore<InstancesUiState>({
    addOpen: false,
    editing: null,
    deletingId: null,
    actionError: null,
  });

  const { addOpen, editing, deletingId, actionError } = useStore(uiStore, (s) => s);

  const setAddOpen = (open: boolean): void =>
    uiStore.setState((p) => ({ ...p, addOpen: open }));

  const setEditing = (instance: FreqtradeInstance | null): void =>
    uiStore.setState((p) => ({ ...p, editing: instance }));

  const setDeletingId = (id: string | null): void =>
    uiStore.setState((p) => ({ ...p, deletingId: id }));

  const setActionError = (error: string | null): void =>
    uiStore.setState((p) => ({ ...p, actionError: error }));

  // "Fix credentials" hand-off (same contract as the dashboard widget): a
  // 401 elsewhere records the failing instance id; pre-open that row's
  // editor once the list has loaded. Consumed exactly once.
  const fixRequest = useStore(credentialsFixStore, (s) => s);
  const instances = list.data?.instances;
  useStoreEffect(() => {
    const id = fixRequest.instanceId;

    if (id === null || instances === undefined) return;
    credentialsFixStore.setState(() => ({
      instanceId: null,
      seq: fixRequest.seq,
    }));
    const instance = instances.find((i) => i.id === id);

    if (instance && instance.id !== "default") setEditing(instance);
  }, [fixRequest.seq, fixRequest.instanceId, instances]);

  const create = async (values: InstanceFormValues) => {
    await callCapability("instances.create", {
      name: values.name,
      baseUrl: values.baseUrl,
      username: values.username,
      password: values.password,
      color: values.color === "" ? undefined : values.color,
    });
    await refreshCapability("instances.list", {});
  };

  /**
   * `instances.update` payload: empty password keeps the stored secret;
   * color is tri-state ("" sends null = back to automatic, otherwise hex).
   */
  interface InstanceUpdateInput {
    id: string;
    name: string;
    baseUrl: string;
    username: string;
    password?: string;
    color?: string | null;
  }

  const update = async (id: string, values: InstanceFormValues) => {
    const input: InstanceUpdateInput = {
      id,
      name: values.name,
      baseUrl: values.baseUrl,
      username: values.username,
      color: values.color === "" ? null : values.color,
    };

    if (values.password.length > 0) input.password = values.password;

    await callCapability("instances.update", input);
    setEditing(null);
    setActionError(null);

    await refreshCapability("instances.list", {});

    // Re-check reachability with the new credentials now, not on the next
    // stream tick; a failed re-check must not fail the save itself.
    refreshCapability("instances.health", { id }).catch(() => undefined);
  };

  const remove = async (instance: FreqtradeInstance) => {
    const confirmed = await requestConfirm({
      title: `Delete "${instance.name}"?`,
      message:
        "Widgets using it will show an error until reconfigured. This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    });

    if (!confirmed) return;
    setDeletingId(instance.id);

    try {
      await callCapability("instances.remove", { id: instance.id });

      if (editing?.id === instance.id) setEditing(null);
      // Deleting reshapes every fleet/per-instance widget — refresh the
      // whole live surface, not just this list.
      await refreshAllCapabilities();
    } catch (cause) {
      setActionError(formatQueryError(cause) ?? "Failed to delete instance.");
    } finally {
      setDeletingId(null);
    }
  };

  // --- Forbidden gate --------------------------------------------------------

  if (!canList) {
    return (
      <div className="nfi-settings-inner">
        <WidgetStateView
          tone="forbidden"
          title="Not authorized"
          hint="Managing freqtrade instances requires the instances.list capability. Ask an admin (the root user) to grant it."
          detail={`Missing capability: instances.list — signed in as ${
            capabilities.authenticated
              ? (capabilities.username ?? "unknown")
              : "anonymous"
          }`}
        >
          {capabilities.authenticated ? null : <SignInCta size="md" />}
        </WidgetStateView>
      </div>
    );
  }

  const rows = instances ?? [];

  const columns: NfiColumnDef<FreqtradeInstance>[] = [
    {
      id: "instance",
      header: "Instance",
      cell: ({ row }) => {
        const instance = row.original;
        const isDefault = instance.id === "default";
        const color = colorOf(instance.id) ?? undefined;

        return (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.375rem",
              minWidth: 0,
            }}
          >
            {color ? (
              <InstanceDot color={color} title={instance.name} />
            ) : null}
            <span>{instance.name}</span>
            {isDefault ? <span style={{ opacity: 0.55 }}>(env)</span> : null}
          </span>
        );
      },
      meta: { className: "nfi-mono" },
      enableSorting: false,
    },
    {
      id: "baseUrl",
      header: "Base URL",
      cell: ({ row }) => row.original.baseUrl,
      meta: { className: "nfi-mono", style: { opacity: 0.8 } },
      enableSorting: false,
    },
    {
      id: "username",
      header: "Username",
      cell: ({ row }) => row.original.username || "—",
      meta: { className: "nfi-mono", style: { opacity: 0.8 } },
      enableSorting: false,
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => <InstanceHealthCell id={row.original.id} />,
      enableSorting: false,
    },
    {
      id: "updated",
      header: "Updated",
      cell: ({ row }) =>
        formatDateTime(new Date(row.original.updatedAt)),
      meta: { className: "nfi-mono", style: { opacity: 0.7 } },
      enableSorting: false,
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const instance = row.original;
        const isDefault = instance.id === "default";

        return (
          <>
            {!isDefault && canUpdate ? (
              <Button
                kind="ghost"
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setEditing(instance);
                }}
              >
                Edit
              </Button>
            ) : null}
            {!isDefault && canRemove ? (
              <Button
                kind="danger--ghost"
                size="sm"
                disabled={deletingId !== null}
                onClick={() => void remove(instance)}
              >
                {deletingId === instance.id ? "…" : "Delete"}
              </Button>
            ) : null}
            {isDefault ? (
              <span style={{ opacity: 0.5 }}>env-configured</span>
            ) : null}
          </>
        );
      },
      meta: { style: { textAlign: "right" } },
      enableSorting: false,
    },
  ];

  return (
    <>
      <div className="nfi-settings-inner nfi-users-inner">
        <Tile>
          <div className="nfi-users-heading">
            <div>
              <h2 className="nfi-users-title">Freqtrade instances</h2>
              <p className="nfi-users-subtitle">
                Every configured freqtrade bot this desk reads. Each instance
                owns the color shown here — the same color its lines, bars and
                rows carry across every fleet widget, so multi-bot data stays
                attributable at a glance. Colors are assigned automatically and
                can be customized per instance (edit → fleet color). Credentials
                stay in the backend process: the browser sends them once over
                these forms and never reads them back (the list shows host +
                username only).
              </p>
            </div>
            {canCreate ? (
              <Button
                size="sm"
                onClick={() => {
                  setActionError(null);
                  setAddOpen(true);
                }}
              >
                Add instance
              </Button>
            ) : null}
          </div>
          {actionError ? (
            <InlineNotification
              kind="error"
              title="Action failed"
              subtitle={actionError}
              lowContrast
              onCloseButtonClick={() => setActionError(null)}
            />
          ) : null}
          {list.isLoading ? (
            <p style={{ fontSize: "0.875rem", opacity: 0.7 }}>
              Loading instances…
            </p>
          ) : null}
          {list.error ? (
            <InlineNotification
              kind="error"
              title="Could not load instances"
              subtitle={list.error}
              lowContrast
              hideCloseButton
            />
          ) : null}
          {rows.length === 0 && !list.isLoading && !list.error ? (
            <p style={{ fontSize: "0.875rem", opacity: 0.7 }}>
              No instances yet — add your first freqtrade bot to start the
              fleet.
            </p>
          ) : null}
          <div
            className="nfi-table-scroll"
            style={{ width: "100%", fontSize: "0.8125rem" }}
          >
            <NfiDataTable
              className="nfi-users-table"
              columns={columns}
              data={rows}
              getRowId={(instance) => instance.id}
              size="md"
            />
          </div>
        </Tile>
      </div>

      <Modal
        open={addOpen}
        modalHeading="Add freqtrade instance"
        passiveModal
        onRequestClose={() => setAddOpen(false)}
        preventCloseOnClickOutside={false}
      >
        <InstanceForm
          idPrefix="ft-page-add"
          heading="New instance"
          submitLabel="Add instance"
          busyLabel="Adding…"
          initial={{
            name: "",
            baseUrl: "",
            username: "",
            password: "",
            color: "",
          }}
          passwordRequired
          passwordLabel="Password"
          onSubmit={async (values) => {
            await create(values);
            setAddOpen(false);
          }}
        />
      </Modal>

      <Modal
        open={editing !== null}
        modalHeading={editing ? `Edit "${editing.name}"` : "Edit instance"}
        passiveModal
        onRequestClose={() => setEditing(null)}
        preventCloseOnClickOutside={false}
      >
        {editing ? (
          <InstanceForm
            idPrefix={`ft-page-edit-${editing.id}`}
            heading={`Edit ${editing.name}`}
            submitLabel="Save changes"
            busyLabel="Saving…"
            instanceId={editing.id}
            initial={{
              name: editing.name,
              baseUrl: editing.baseUrl,
              username: editing.username,
              password: "",
              color: editing.color ?? "",
            }}
            passwordRequired={false}
            passwordLabel="Password"
            onSubmit={(values) => update(editing.id, values)}
          />
        ) : null}
      </Modal>
    </>
  );
}
