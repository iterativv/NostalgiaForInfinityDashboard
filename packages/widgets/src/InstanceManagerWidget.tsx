// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { Button, TextInput } from "@carbon/react";
import { defineWidget } from "@nfi/widget-sdk";
import { EmptyState, WidgetFrame } from "@nfi/ui";
import { formatQueryError } from "@nfi/api-contract";
import {
  refreshAllCapabilities,
  refreshCapability,
  useCapability,
} from "./live/live";
import { callCapability } from "./live/transport";
import { credentialsFixStore } from "./live/credentialsFix";
import { requestConfirm } from "./shared/dialogs";
import { EmptyConfigSchema } from "./shared/config";
import { queryState } from "./shared/query";
import { InstanceHealthRow } from "./InstanceHealthRow";

interface InstanceFormValues {
  readonly name: string;
  readonly baseUrl: string;
  readonly username: string;
  readonly password: string;
}

// No hardcoded localhost prefill — a deployment's freqtrade is rarely the
// machine the browser runs on; the placeholder shows the shape instead.
const EMPTY_FORM: InstanceFormValues = {
  name: "",
  baseUrl: "",
  username: "",
  password: "",
};

/**
 * Shared fields for adding and editing an instance. The form owns its state
 * and validation; the parent's submit handler may throw — a failure keeps
 * the values on screen with the backend's message, a success clears them
 * (the edit form is unmounted by the parent instead).
 */
function InstanceForm({
  idPrefix,
  heading,
  submitLabel,
  busyLabel,
  initial,
  passwordRequired,
  passwordLabel,
  onSubmit,
}: {
  idPrefix: string;
  heading: string;
  submitLabel: string;
  busyLabel: string;
  initial: InstanceFormValues;
  /** Add requires a password; edit keeps the stored one when left empty. */
  passwordRequired: boolean;
  passwordLabel: string;
  onSubmit: (values: InstanceFormValues) => Promise<void>;
}) {
  const [values, setValues] = useState<InstanceFormValues>(initial);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set =
    (field: keyof InstanceFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [field]: event.target.value }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    if (values.name.trim().length === 0) {
      setFormError("Name is required.");
      return;
    }
    try {
      const url = new URL(values.baseUrl.trim());
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        setFormError("Base URL must be http(s)://host:port.");
        return;
      }
    } catch {
      setFormError("Base URL must be http(s)://host:port.");
      return;
    }
    if (passwordRequired && values.password.length === 0) {
      setFormError("Password is required.");
      return;
    }
    if (!passwordRequired && values.password.length === 0) {
      // Mirror of the backend repoint guard (`instances.update`): leaving
      // the password empty keeps the stored secret, so a changed URL or
      // username would forward the REAL credentials to the new host.
      const normalize = (url: string) => url.trim().replace(/\/$/, "");
      if (
        normalize(values.baseUrl) !== normalize(initial.baseUrl) ||
        values.username !== initial.username
      ) {
        setFormError("Password is required when changing the URL or username.");
        return;
      }
    }
    setSaving(true);
    try {
      await onSubmit({
        name: values.name.trim(),
        baseUrl: values.baseUrl.trim(),
        username: values.username,
        password: values.password,
      });
      setValues(EMPTY_FORM);
    } catch (cause) {
      setFormError(formatQueryError(cause) ?? "Failed to save the instance.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        borderTop: "1px solid var(--cds-border-subtle)",
        paddingTop: "0.75rem",
      }}
    >
      <span
        style={{
          fontSize: "0.75rem",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        {heading}
      </span>
      <TextInput
        id={`${idPrefix}-name`}
        labelText="Name"
        placeholder="e.g. binance-lamualfa"
        value={values.name}
        onChange={set("name")}
        size="sm"
      />
      <TextInput
        id={`${idPrefix}-url`}
        labelText="Base URL (server-side only)"
        placeholder="http://freqtrade-host:8080"
        value={values.baseUrl}
        onChange={set("baseUrl")}
        size="sm"
      />
      <TextInput
        id={`${idPrefix}-user`}
        labelText="Username"
        placeholder="freqtrade api_server username"
        value={values.username}
        onChange={set("username")}
        size="sm"
        autoComplete="username"
      />
      <TextInput
        id={`${idPrefix}-pass`}
        labelText={passwordLabel}
        type="password"
        placeholder={
          passwordRequired
            ? "freqtrade api_server password"
            : "leave empty to keep the stored password"
        }
        value={values.password}
        onChange={set("password")}
        size="sm"
        autoComplete="current-password"
      />
      {!passwordRequired ? (
        <p style={{ fontSize: "0.75rem", opacity: 0.65 }}>
          Required if the URL or username changes — otherwise the stored
          password is kept.
        </p>
      ) : null}
      {formError ? (
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--cds-support-error)",
          }}
        >
          {formError}
        </p>
      ) : null}
      <div>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? busyLabel : submitLabel}
        </Button>
      </div>
      <p style={{ fontSize: "0.75rem", opacity: 0.65 }}>
        Credentials stay in the backend process — the browser only sends them
        once over this form, they are never exposed back (list shows host +
        username only).
      </p>
    </form>
  );
}

export function InstanceManagerWidget() {
  const { data, error, isLoading } = useCapability("instances.list", {});
  const state = queryState(error, isLoading);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // "Fix credentials" hand-off: a 401 elsewhere records the failing
  // instance id; pre-open that row's editor once the list has loaded. The
  // request is consumed once — a later data update must not re-open it.
  const fixRequest = useStore(credentialsFixStore, (s) => s);
  useEffect(() => {
    const id = fixRequest.instanceId;
    if (id === null) return;
    const instances = data?.instances;
    if (instances === undefined) return;
    credentialsFixStore.setState(() => ({
      instanceId: null,
      seq: fixRequest.seq,
    }));
    const instance = instances.find((i) => i.id === id);
    if (instance && instance.id !== "default") setEditingId(instance.id);
  }, [fixRequest.seq, fixRequest.instanceId, data]);

  const create = async (values: InstanceFormValues) => {
    await callCapability("instances.create", {
      name: values.name,
      baseUrl: values.baseUrl,
      username: values.username,
      password: values.password,
    });
    await refreshCapability("instances.list", {});
  };

  const update = async (id: string, values: InstanceFormValues) => {
    // Empty password keeps the stored secret (backend contract).
    await callCapability("instances.update", {
      id,
      name: values.name,
      baseUrl: values.baseUrl,
      username: values.username,
      ...(values.password.length > 0 ? { password: values.password } : {}),
    });
    setEditingId(null);
    setActionError(null);
    await refreshCapability("instances.list", {});
    // Re-check reachability with the new credentials now, not on the next
    // health poll; a failed re-check must not fail the save itself.
    refreshCapability("instances.health", { id }).catch(() => undefined);
  };

  const remove = async (id: string) => {
    if (id === "default") return;
    const confirmed = await requestConfirm({
      title: "Delete this freqtrade instance?",
      message: "Widgets using it will show an error until reconfigured.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    setDeletingId(id);
    try {
      await callCapability("instances.remove", { id });
      if (editingId === id) setEditingId(null);
      // Deleting an instance reshapes every widget: aggregates keyed on
      // "all" lose a bot, per-instance keys lose their source. Refresh the
      // whole live surface (this list included) instead of just instances.list.
      await refreshAllCapabilities();
    } catch (cause) {
      setActionError(formatQueryError(cause) ?? "Failed to delete instance.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <WidgetFrame
      title="Freqtrade Instances"
      isLoading={state.isLoading}
      error={state.error}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
        {(data?.instances ?? []).map((instance) => (
          <div
            key={instance.id}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
          >
            <InstanceHealthRow
              instanceId={instance.id}
              name={instance.name}
              baseUrl={instance.baseUrl}
              isDefault={instance.id === "default"}
              onDelete={remove}
              deleting={deletingId === instance.id}
              editing={editingId === instance.id}
              onEdit={(id) => {
                setActionError(null);
                setEditingId(editingId === id ? null : id);
              }}
            />
            {editingId === instance.id ? (
              <InstanceForm
                idPrefix={`ft-edit-${instance.id}`}
                heading={`Edit ${instance.name}`}
                submitLabel="Save changes"
                busyLabel="Saving…"
                initial={{
                  name: instance.name,
                  baseUrl: instance.baseUrl,
                  username: instance.username,
                  password: "",
                }}
                passwordRequired={false}
                passwordLabel="Password"
                onSubmit={(values) => update(instance.id, values)}
              />
            ) : null}
          </div>
        ))}
        {(data?.instances ?? []).length === 0 && !state.isLoading ? (
          <EmptyState
            title="No instances"
            hint="Add your first freqtrade below."
          />
        ) : null}
        {actionError ? (
          <p
            style={{
              fontSize: "0.875rem",
              color: "var(--cds-support-error)",
            }}
          >
            {actionError}
          </p>
        ) : null}
        <InstanceForm
          idPrefix="ft-add"
          heading="Add new instance"
          submitLabel="Add instance"
          busyLabel="Adding…"
          initial={EMPTY_FORM}
          passwordRequired
          passwordLabel="Password"
          onSubmit={create}
        />
      </div>
    </WidgetFrame>
  );
}

export const InstanceManagerWidgetDef = defineWidget({
  type: "instances",
  title: "Freqtrade Instances",
  description: "Add, edit, list and remove freqtrade connections (multi-bot).",
  configSchema: EmptyConfigSchema,
  defaultConfig: {},
  component: InstanceManagerWidget,
  capabilities: [
    "instances.list",
    "instances.create",
    "instances.update",
    "instances.remove",
  ],
  minWidth: 360,
  minHeight: 160,
});
