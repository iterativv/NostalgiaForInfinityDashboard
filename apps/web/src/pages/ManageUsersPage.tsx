// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useMemo, useState } from "react"
import {
  Button,
  InlineNotification,
  Modal,
  PasswordInput,
  Tag,
  TextInput,
  Tile,
} from "@carbon/react"
import {
  ANONYMOUS_USER_ID,
  DEFAULT_SENSITIVE_INFO_KINDS,
  ROOT_USER_ID,
  type Capability,
  type InfoKind,
  type ManagedUser,
} from "@nfi/api-contract"
import { CAPABILITY_REGISTRY, isCapabilitySensitive } from "@nfi/capabilities"
import { WidgetStateView } from "@nfi/ui"
import { formatQueryError } from "../api"
import { useCapabilities } from "../auth/capabilities"
import { refreshSessionState } from "../auth/session"
import { SignInCta } from "../auth/SignInCta"
import { callCapability } from "../capabilities/client"
import { refreshCapability, useCapability } from "../capabilities/live"
import {
  ALL_INFO_KINDS,
  INFO_KIND_META,
  saveSensitivity,
  useSensitivity,
} from "../capabilities/sensitivity"
import { AppShell } from "../workspace/AppShell"
import { requestConfirm } from "@nfi/widgets"

/**
 * Manage users (`/users`) — the capability-gated admin page.
 *
 * Every action here checks its OWN capability before it is offered, mirroring
 * the server-side enforcement (`users.list` to see the page at all,
 * `users.create` / `users.update` / `users.remove` per action):
 *
 * - root — read-only row: env-configured, always holds every capability.
 * - anonymous — the public grant for everyone not signed in; capabilities
 *   only (it can never have a password).
 * - users — full edit: granted capabilities (limited to what the CALLER
 *   holds — the server rejects escalation) and password reset.
 *
 * Root additionally sees the "Sensitivity criteria" editor: capabilities
 * declare the kinds of information they expose, and the root checks off
 * which kinds count as sensitive (labels/marks only — grants still gate
 * every call).
 */

/** `auth.capabilities` is implicitly callable by everyone — never shown. */
const EDITABLE_EXCLUDE: ReadonlySet<string> = new Set(["auth.capabilities"])

interface EditorState {
  readonly user: ManagedUser
  readonly selected: ReadonlySet<string>
  readonly password: string
}

const groupOf = (capability: string): string => capability.split(".")[0] ?? "other"

function CapabilityEditor({
  available,
  selected,
  onToggle,
}: {
  available: ReadonlyArray<Capability>
  selected: ReadonlySet<string>
  onToggle: (capability: Capability, checked: boolean) => void
}) {
  // Live criteria: chips color per the root's current sensitive kinds.
  const { sensitiveKinds } = useSensitivity()
  const groups = useMemo(() => {
    const map = new Map<string, Capability[]>()
    for (const capability of available) {
      if (EDITABLE_EXCLUDE.has(capability)) continue
      const group = groupOf(capability)
      const list = map.get(group) ?? []
      list.push(capability)
      map.set(group, list)
    }
    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
  }, [available])

  if (available.length === 0) {
    return (
      <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>
        No capabilities available to grant (you hold none beyond the bootstrap).
      </p>
    )
  }

  return (
    <div className="nfi-capability-editor">
      {groups.map(([group, capabilities]) => (
        <div key={group} className="nfi-capability-group">
          <p className="nfi-capability-group-title">{group}</p>
          {capabilities.map((capability) => {
            const def = CAPABILITY_REGISTRY[capability]
            const sensitive = isCapabilitySensitive(capability, sensitiveKinds)
            return (
              <label key={capability} className="nfi-capability-row">
                <input
                  type="checkbox"
                  checked={selected.has(capability)}
                  onChange={(event) => onToggle(capability, event.target.checked)}
                />
                <span className="nfi-mono nfi-capability-id">{capability}</span>
                {def.exposes.map((kind) => (
                  <Tag
                    key={kind}
                    size="sm"
                    type={sensitiveKinds.includes(kind) ? "red" : "gray"}
                    title={INFO_KIND_META[kind]?.hint ?? kind}
                  >
                    {INFO_KIND_META[kind]?.label ?? kind}
                  </Tag>
                ))}
                <span className="nfi-capability-description">
                  {def.description}
                  {sensitive ? "" : " — non-sensitive under the current criteria"}
                </span>
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/**
 * Root-only editor for the sensitivity criteria: which information kinds
 * count as sensitive. Everything else (capability chips, widget marks)
 * derives from this live — the server persists the choice.
 */
function SensitivityCriteriaTile() {
  const { sensitiveKinds, status, detail } = useSensitivity()
  const [draft, setDraft] = useState<ReadonlySet<InfoKind> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const current = draft ?? new Set(sensitiveKinds)
  const dirty = draft !== null && (
    draft.size !== sensitiveKinds.length ||
    [...draft].some((kind) => !sensitiveKinds.includes(kind))
  )

  const toggle = (kind: InfoKind, checked: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev ?? sensitiveKinds)
      if (checked) next.add(kind)
      else next.delete(kind)
      return next
    })

  const save = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await saveSensitivity([...current])
      setDraft(null)
    } catch (cause) {
      setError(formatQueryError(cause) ?? "Saving the criteria failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tile className="nfi-users-tile">
      <div className="nfi-users-heading">
        <div>
          <h2 className="nfi-users-title">Sensitivity criteria</h2>
          <p className="nfi-users-subtitle">
            What counts as sensitive is your call. Check the kinds of
            information that must never show up on a shared screen — every
            capability declares what it exposes, and capability chips /
            widget marks across the app follow this list live. This only
            changes labels and marks; access is still governed by the grants
            above.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            size="sm"
            kind="secondary"
            disabled={busy}
            onClick={() => setDraft(new Set(DEFAULT_SENSITIVE_INFO_KINDS))}
          >
            Reset to defaults
          </Button>
          <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save criteria"}
          </Button>
        </div>
      </div>
      {status === "offline" ? (
        <InlineNotification
          kind="warning"
          title="Using built-in defaults"
          subtitle={detail ?? "The saved criteria could not be loaded."}
          lowContrast
          hideCloseButton
        />
      ) : null}
      {error ? (
        <InlineNotification
          kind="error"
          title="Could not save criteria"
          subtitle={error}
          lowContrast
          onCloseButtonClick={() => setError(null)}
        />
      ) : null}
      <div className="nfi-sensitivity-kinds">
        {ALL_INFO_KINDS.map((kind) => {
          const meta = INFO_KIND_META[kind]
          return (
            <label key={kind} className="nfi-capability-row">
              <input
                type="checkbox"
                checked={current.has(kind)}
                onChange={(event) => toggle(kind, event.target.checked)}
              />
              <Tag size="sm" type={current.has(kind) ? "red" : "gray"}>
                {meta.label}
              </Tag>
              <span className="nfi-capability-description">{meta.hint}</span>
            </label>
          )
        })}
      </div>
    </Tile>
  )
}

export function ManageUsersPage() {
  const capabilities = useCapabilities()
  const granted = capabilities.granted
  const list = useCapability("users.list", {})

  const canList = granted.includes("users.list")
  const canCreate = granted.includes("users.create")
  const canUpdate = granted.includes("users.update")
  const canRemove = granted.includes("users.remove")

  const [createOpen, setCreateOpen] = useState(false)
  const [createUsername, setCreateUsername] = useState("")
  const [createPassword, setCreatePassword] = useState("")
  const [createSelected, setCreateSelected] = useState<ReadonlySet<string>>(new Set())
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Capabilities the caller may grant (server enforces the same subset). */
  const grantable = useMemo(() => {
    const inSession = granted.includes("users.list") ? granted : []
    return inSession as ReadonlyArray<Capability>
  }, [granted])

  const refresh = async () => {
    await refreshCapability("users.list", {})
    // Own grants may have changed (self-edit); re-derive identity + grants.
    await refreshSessionState()
  }

  const runAction = async (action: () => Promise<unknown>) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(formatQueryError(cause) ?? "Action failed")
    } finally {
      setBusy(false)
    }
  }

  const submitCreate = () =>
    runAction(async () => {
      await callCapability("users.create", {
        username: createUsername.trim(),
        password: createPassword,
        capabilities: [...createSelected] as Capability[],
      })
      setCreateOpen(false)
      setCreateUsername("")
      setCreatePassword("")
      setCreateSelected(new Set())
    })

  const submitEditor = () =>
    runAction(async () => {
      if (!editor) return
      await callCapability("users.update", {
        id: editor.user.id,
        capabilities: [...editor.selected] as Capability[],
        password: editor.password.length > 0 ? editor.password : undefined,
      })
      setEditor(null)
    })

  const removeUser = (user: ManagedUser) => {
    void requestConfirm({
      title: `Delete "${user.username}"?`,
      message:
        "Their sessions end immediately (next request resolves as anonymous). This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return
      void runAction(() => callCapability("users.remove", { id: user.id }))
    })
  }

  // --- Forbidden gate --------------------------------------------------------

  if (!canList) {
    return (
      <AppShell>
        <main className="nfi-workspace-host nfi-settings-host" aria-label="Manage users">
          <div className="nfi-settings-inner">
              <WidgetStateView
                tone="forbidden"
                title="Not authorized"
                hint="Managing users requires the users.list capability. Ask an admin (the root user) to grant it."
                detail={`Missing capability: users.list — signed in as ${
                  capabilities.authenticated ? (capabilities.username ?? "unknown") : "anonymous"
                }`}
              >
                {capabilities.authenticated ? null : <SignInCta size="md" />}
              </WidgetStateView>
          </div>
        </main>
      </AppShell>
    )
  }

  const users = list.data?.users ?? []

  return (
    <AppShell>
      <main className="nfi-workspace-host nfi-settings-host" aria-label="Manage users">
        <div className="nfi-settings-inner nfi-users-inner">
            <Tile>
              <div className="nfi-users-heading">
                <div>
                  <h2 className="nfi-users-title">Manage users</h2>
                  <p className="nfi-users-subtitle">
                    Root is configured from the server environment and always holds every
                    capability. Anonymous is the grant for everyone not signed in — keep it to
                    the <span className="nfi-mono">.relative</span> + neutral ids to share the
                    dashboard without leaking absolute balances or PnL.
                  </p>
                </div>
                {canCreate ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setCreateSelected(new Set())
                      setCreateOpen(true)
                    }}
                  >
                    New user
                  </Button>
                ) : null}
              </div>
              {error ? (
                <InlineNotification
                  kind="error"
                  title="Action failed"
                  subtitle={error}
                  lowContrast
                  onCloseButtonClick={() => setError(null)}
                />
              ) : null}
              {list.isLoading ? (
                <p style={{ fontSize: "0.875rem", opacity: 0.7 }}>Loading users…</p>
              ) : null}
              {list.error ? (
                <InlineNotification
                  kind="error"
                  title="Could not load users"
                  subtitle={list.error}
                  lowContrast
                  hideCloseButton
                />
              ) : null}
              <div className="nfi-table-scroll">
                <table className="nfi-users-table" style={{ width: "100%", fontSize: "0.8125rem" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>User</th>
                      <th style={{ textAlign: "left" }}>Role</th>
                      <th style={{ textAlign: "left" }}>Capabilities</th>
                      <th style={{ textAlign: "left" }}>Updated</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => {
                      const isRoot = user.id === ROOT_USER_ID
                      const isAnonymous = user.id === ANONYMOUS_USER_ID
                      return (
                        <tr key={user.id}>
                          <td className="nfi-mono">{user.username}</td>
                          <td>
                            <Tag
                              size="sm"
                              type={isRoot ? "purple" : isAnonymous ? "teal" : "gray"}
                            >
                              {user.role}
                            </Tag>
                          </td>
                          <td style={{ opacity: 0.8 }}>
                            {isRoot
                              ? "all (env-configured)"
                              : `${user.capabilities.length} granted`}
                          </td>
                          <td className="nfi-mono" style={{ opacity: 0.7 }}>
                            {user.updatedAt
                              ? new Date(user.updatedAt).toLocaleString([], { hour12: false })
                              : "—"}
                          </td>
                          <td style={{ textAlign: "right" }}>
                            {isRoot ? (
                              <span style={{ opacity: 0.5 }}>read-only</span>
                            ) : (
                              <>
                                <Button
                                  kind="ghost"
                                  size="sm"
                                  disabled={!canUpdate || busy}
                                  onClick={() =>
                                    setEditor({
                                      user,
                                      selected: new Set(user.capabilities),
                                      password: "",
                                    })
                                  }
                                >
                                  {isAnonymous ? "Edit grant" : "Edit"}
                                </Button>
                                {!isAnonymous && canRemove ? (
                                  <Button
                                    kind="ghost"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => removeUser(user)}
                                  >
                                    Delete
                                  </Button>
                                ) : null}
                              </>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </Tile>
            {capabilities.role === "root" ? <SensitivityCriteriaTile /> : null}
        </div>
      </main>

      <Modal
        open={createOpen}
        modalHeading="New user"
        primaryButtonText={busy ? "Creating…" : "Create user"}
        secondaryButtonText="Cancel"
        onRequestSubmit={() => void submitCreate()}
        onRequestClose={() => setCreateOpen(false)}
        preventCloseOnClickOutside={busy}
      >
        <div className="nfi-users-modal-body">
          <TextInput
            id="new-user-username"
            labelText="Username"
            value={createUsername}
            onChange={(event) => setCreateUsername(event.target.value)}
          />
          <PasswordInput
            id="new-user-password"
            labelText="Password"
            value={createPassword}
            onChange={(event) => setCreatePassword(event.target.value)}
          />
          <p className="nfi-capability-group-title">Granted capabilities</p>
          <CapabilityEditor
            available={grantable}
            selected={createSelected}
            onToggle={(capability, checked) =>
              setCreateSelected((current) => {
                const next = new Set(current)
                if (checked) next.add(capability)
                else next.delete(capability)
                return next
              })
            }
          />
        </div>
      </Modal>

      <Modal
        open={editor !== null}
        modalHeading={editor ? `Edit "${editor.user.username}"` : "Edit"}
        primaryButtonText={busy ? "Saving…" : "Save changes"}
        secondaryButtonText="Cancel"
        onRequestSubmit={() => void submitEditor()}
        onRequestClose={() => setEditor(null)}
        preventCloseOnClickOutside={busy}
      >
        {editor ? (
          <div className="nfi-users-modal-body">
            <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>
              {editor.user.id === ANONYMOUS_USER_ID
                ? "This is the grant applied to every visitor who is not signed in. It can never have a password."
                : "Capabilities are limited to what you hold yourself; the server rejects anything beyond that."}
            </p>
            {editor.user.id !== ANONYMOUS_USER_ID ? (
              <PasswordInput
                id="edit-user-password"
                labelText="New password (leave empty to keep)"
                value={editor.password}
                onChange={(event) =>
                  setEditor((current) =>
                    current ? { ...current, password: event.target.value } : current,
                  )
                }
              />
            ) : null}
            <p className="nfi-capability-group-title">Granted capabilities</p>
            <CapabilityEditor
              available={grantable}
              selected={editor.selected}
              onToggle={(capability, checked) =>
                setEditor((current) => {
                  if (!current) return current
                  const next = new Set(current.selected)
                  if (checked) next.add(capability)
                  else next.delete(capability)
                  return { ...current, selected: next }
                })
              }
            />
          </div>
        ) : null}
      </Modal>
    </AppShell>
  )
}
