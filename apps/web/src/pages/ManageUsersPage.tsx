// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useStore } from "@tanstack/react-store";
import { functionalUpdate } from "@tanstack/react-table";
import {
  Button,
  InlineNotification,
  Modal,
  PasswordInput,
  Tag,
  TextInput,
  Tile,
} from "@carbon/react";
import {
  ANONYMOUS_USER_ID,
  DEFAULT_SENSITIVE_INFO_KINDS,
  ROOT_USER_ID,
  Capability,
  type InfoKind,
  type ManagedUser,
  type PageDefaultsConfig,
} from "@nfi/api-contract";
import { Schema } from "effect";
import { CAPABILITY_REGISTRY, isCapabilitySensitive } from "@nfi/capabilities";
import {
  NfiDataTable,
  useLocalStore,
  WidgetStateView,
  type NfiColumnDef,
} from "@nfi/ui";
import { formatQueryError } from "../api";
import { useCapabilities } from "../auth/capabilities";
import { refreshSessionState } from "../auth/session";
import { SignInCta } from "../auth/SignInCta";
import { callCapability } from "../capabilities/client";
import { refreshCapability, useCapability } from "../capabilities/live";
import {
  ALL_INFO_KINDS,
  INFO_KIND_META,
  saveSensitivity,
  useSensitivity,
} from "../capabilities/sensitivity";
import {
  fetchPageDefaultsFor,
  savePageDefaults,
  usePageDefaults,
} from "../workspace/pageDefaults";
import { getCachedWorkspace, workspaceStore } from "../workspace/store";
import { formatDateTime, requestConfirm } from "@nfi/widgets";

/**
 * Manage users — the capability-gated admin surface, rendered inside the
 * `/settings` page's "Users & permissions" tab (the `/users` route redirects
 * there).
 *
 * Every action here checks its OWN capability before it is offered, mirroring
 * the server-side enforcement (`users.list` to see the panel at all,
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
 *
 * Holders of `system.page-defaults.update` additionally see the "Default
 * landing page" tile (deployment-wide landing other than Home) and, per
 * user row, a "Default pages" section in the edit dialog: landing page,
 * visible pages and default tab per page — including the `anonymous` role.
 * The header's View-as switcher previews any of these dashboards.
 */

/** `auth.capabilities` is implicitly callable by everyone — never shown. */
const EDITABLE_EXCLUDE: ReadonlySet<string> = new Set(["auth.capabilities"]);

interface EditorState {
  readonly user: ManagedUser;
  readonly selected: ReadonlySet<string>;
  readonly password: string;
  /**
   * Page-defaults draft: undefined = still loading the stored override,
   * null = follow the global default (no override), object = explicit entry.
   */
  readonly defaults: PageDefaultsConfig | null | undefined;
}

const groupOf = (capability: string): string =>
  capability.split(".")[0] ?? "other";

function CapabilityEditor({
  available,
  selected,
  onToggle,
}: {
  available: ReadonlyArray<Capability>;
  selected: ReadonlySet<string>;
  onToggle: (capability: Capability, checked: boolean) => void;
}) {
  // Live criteria: chips color per the root's current sensitive kinds.
  const { sensitiveKinds } = useSensitivity();

  const groups = (() => {
    const map = new Map<string, Capability[]>();

    for (const capability of available) {
      if (EDITABLE_EXCLUDE.has(capability)) continue;
      const group = groupOf(capability);
      const list = map.get(group) ?? [];
      list.push(capability);
      map.set(group, list);
    }

    return [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  })();

  if (available.length === 0) {
    return (
      <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>
        No capabilities available to grant (you hold none beyond the bootstrap).
      </p>
    );
  }

  return (
    <div className="nfi-capability-editor">
      {groups.map(([group, capabilities]) => (
        <div key={group} className="nfi-capability-group">
          <p className="nfi-capability-group-title">{group}</p>
          {capabilities.map((capability) => {
            const def = CAPABILITY_REGISTRY[capability];
            const sensitive = isCapabilitySensitive(capability, sensitiveKinds);

            return (
              <label key={capability} className="nfi-capability-row">
                <input
                  type="checkbox"
                  checked={selected.has(capability)}
                  onChange={(event) =>
                    onToggle(capability, event.target.checked)
                  }
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
                  {sensitive
                    ? ""
                    : " — non-sensitive under the current criteria"}
                </span>
              </label>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/**
 * Root-only editor for the sensitivity criteria: which information kinds
 * count as sensitive. Everything else (capability chips, widget marks)
 * derives from this live — the server persists the choice.
 */
function SensitivityCriteriaTile() {
  const { sensitiveKinds, status, detail } = useSensitivity();

  interface CriteriaDraft {
    draft: ReadonlySet<InfoKind> | null;
    busy: boolean;
    error: string | null;
  }

  const draftStore = useLocalStore<CriteriaDraft>({
    draft: null,
    busy: false,
    error: null,
  });

  const { draft, busy, error } = useStore(draftStore, (s) => s);

  const setDraft = (
    next:
      | ReadonlySet<InfoKind>
      | null
      | ((prev: ReadonlySet<InfoKind> | null) => ReadonlySet<InfoKind> | null),
  ): void =>
    draftStore.setState((p) => ({
      ...p,
      draft: functionalUpdate(next, p.draft),
    }));

  const current = draft ?? new Set(sensitiveKinds);

  const dirty =
    draft !== null &&
    (draft.size !== sensitiveKinds.length ||
      [...draft].some((kind) => !sensitiveKinds.includes(kind)));

  const toggle = (kind: InfoKind, checked: boolean) =>
    setDraft((prev) => {
      const next = new Set(prev ?? sensitiveKinds);

      if (checked) next.add(kind);
      else next.delete(kind);

      return next;
    });

  const save = async () => {
    if (busy) return;
    draftStore.setState((p) => ({ ...p, busy: true, error: null }));

    try {
      await saveSensitivity([...current]);
      draftStore.setState((p) => ({ ...p, draft: null }));
    } catch (cause) {
      draftStore.setState((p) => ({
        ...p,
        error: formatQueryError(cause) ?? "Saving the criteria failed",
      }));
    } finally {
      draftStore.setState((p) => ({ ...p, busy: false }));
    }
  };

  return (
    <Tile className="nfi-users-tile">
      <div className="nfi-users-heading">
        <div>
          <h2 className="nfi-users-title">Sensitivity criteria</h2>
          <p className="nfi-users-subtitle">
            What counts as sensitive is your call. Check the kinds of
            information that must never show up on a shared screen — every
            capability declares what it exposes, and capability chips / widget
            marks across the app follow this list live. This only changes labels
            and marks; access is still governed by the grants above.
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
          <Button
            size="sm"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
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
          onCloseButtonClick={() =>
            draftStore.setState((p) => ({ ...p, error: null }))
          }
        />
      ) : null}
      <div className="nfi-sensitivity-kinds">
        {ALL_INFO_KINDS.map((kind) => {
          const meta = INFO_KIND_META[kind];

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
          );
        })}
      </div>
    </Tile>
  );
}

/**
 * Deployment-wide landing page (holders of `system.page-defaults.update`).
 * Null = Home; any page id = land there on first visit (last-visited still
 * wins once the visitor has navigated). Persisted via the update capability.
 */
function GlobalDefaultsTile() {
  const { globalDefaultPageId, status } = usePageDefaults();
  const pages = useStore(workspaceStore, (s) => s.pages);

  interface LandingDraft {
    draft: string | null;
    busy: boolean;
    error: string | null;
  }

  const draftStore = useLocalStore<LandingDraft>({
    draft: null,
    busy: false,
    error: null,
  });

  const { draft, busy, error } = useStore(draftStore, (s) => s);

  const current = draft ?? globalDefaultPageId ?? "";

  const dirty = draft !== null && draft !== (globalDefaultPageId ?? "");

  const save = async () => {
    if (busy || !dirty) return;
    draftStore.setState((p) => ({ ...p, busy: true, error: null }));

    try {
      await savePageDefaults({
        globalDefaultPageId: draft === "" ? null : draft,
      });
      draftStore.setState((p) => ({ ...p, draft: null }));
    } catch (cause) {
      draftStore.setState((p) => ({
        ...p,
        error: formatQueryError(cause) ?? "Saving the landing page failed",
      }));
    } finally {
      draftStore.setState((p) => ({ ...p, busy: false }));
    }
  };

  return (
    <Tile className="nfi-users-tile">
      <div className="nfi-users-heading">
        <div>
          <h2 className="nfi-users-title">Default landing page</h2>
          <p className="nfi-users-subtitle">
            First visit lands here instead of Home — for everyone without a
            personal override below (including signed-out visitors when the
            anonymous entry follows the global). Explicit page visits and the
            header switcher still win afterwards.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            size="sm"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save landing page"}
          </Button>
        </div>
      </div>
      {status === "offline" ? (
        <InlineNotification
          kind="warning"
          title="Page defaults unavailable"
          subtitle="The backend could not be reached — landing pages stay on Home until it returns."
          lowContrast
          hideCloseButton
        />
      ) : null}
      {error ? (
        <InlineNotification
          kind="error"
          title="Could not save landing page"
          subtitle={error}
          lowContrast
          onCloseButtonClick={() =>
            draftStore.setState((p) => ({ ...p, error: null }))
          }
        />
      ) : null}
      <div className="nfi-settings-select">
        <label htmlFor="global-default-page">Landing page</label>
        <select
          id="global-default-page"
          value={current}
          onChange={(event) =>
            draftStore.setState((p) => ({ ...p, draft: event.target.value }))
          }
        >
          <option value="">Home (no override)</option>
          {pages
            .filter((page) => !page.home)
            .map((page) => (
              <option key={page.id} value={page.id}>
                {page.name}
              </option>
            ))}
        </select>
      </div>
    </Tile>
  );
}

/** Tabs available for a default-tab pick (panel id -> widget label). */
function tabsForPage(
  pageId: string,
): ReadonlyArray<{ id: string; label: string }> {
  const workspace = getCachedWorkspace(pageId);

  if (!workspace) return [];

  return Object.values(workspace.panels).map((panel) => ({
    id: panel.id,
    label: `${panel.widgetType}${panel.title ? ` — ${panel.title}` : ""}`,
  }));
}

/**
 * Per-user default pages editor (inside the user edit dialog): landing page
 * override, visible pages and one default tab per page. `undefined` renders
 * the loading state while the stored override resolves.
 */
function DefaultsSection({
  defaults,
  onChange,
}: {
  defaults: PageDefaultsConfig | null | undefined;
  onChange: (next: PageDefaultsConfig | null) => void;
}) {
  const pages = useStore(workspaceStore, (s) => s.pages);

  if (defaults === undefined) {
    return (
      <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>
        Loading page defaults…
      </p>
    );
  }

  const effective: PageDefaultsConfig = defaults ?? {
    defaultPageId: null,
    visiblePageIds: null,
    defaultPanels: {},
  };

  const visible = new Set(effective.visiblePageIds ?? pages.map((p) => p.id));

  const togglePage = (pageId: string, checked: boolean) => {
    const next = new Set(visible);

    if (checked) next.add(pageId);
    else next.delete(pageId);

    const all = pages.every((p) => next.has(p.id));

    const tabs = Object.fromEntries(
      Object.entries(effective.defaultPanels).filter(([page]) =>
        next.has(page),
      ),
    );

    onChange({
      ...effective,
      visiblePageIds: all ? null : [...next],
      defaultPanels: tabs,
    });
  };

  const setLanding = (pageId: string) =>
    onChange({ ...effective, defaultPageId: pageId === "" ? null : pageId });

  const setTab = (pageId: string, tabId: string) => {
    const tabs = { ...effective.defaultPanels };

    if (tabId === "") delete tabs[pageId];
    else tabs[pageId] = tabId;

    onChange({ ...effective, defaultPanels: tabs });
  };

  return (
    <div className="nfi-defaults-grid">
      <div className="nfi-settings-select">
        <label htmlFor="user-default-page">Landing page override</label>
        <select
          id="user-default-page"
          value={effective.defaultPageId ?? ""}
          onChange={(event) => setLanding(event.target.value)}
        >
          <option value="">Follow the global landing page</option>
          {pages.map((page) => (
            <option key={page.id} value={page.id}>
              {page.home ? `${page.name} (home)` : page.name}
            </option>
          ))}
        </select>
        <span className="nfi-settings-hint">
          Empty = this identity lands on the deployment-wide page above.
        </span>
      </div>
      <div>
        <p className="nfi-capability-group-title">Visible pages</p>
        <div className="nfi-defaults-pages">
          {pages.map((page) => (
            <label key={page.id} className="nfi-capability-row">
              <input
                type="checkbox"
                checked={visible.has(page.id)}
                onChange={(event) => togglePage(page.id, event.target.checked)}
              />
              <span className="nfi-mono">{page.name}</span>
              <span className="nfi-capability-description">
                {page.home ? "home" : page.preset ? "preset" : "custom"}
              </span>
            </label>
          ))}
        </div>
        <span className="nfi-settings-hint">
          Unchecked pages hide from their header (view-as preview shows this
          exactly). All checked = every page, including future ones.
        </span>
      </div>
      <div>
        <p className="nfi-capability-group-title">Default tabs</p>
        {pages
          .filter((page) => visible.has(page.id))
          .map((page) => {
            const tabs = tabsForPage(page.id);

            if (tabs.length === 0) return null;

            return (
              <div key={page.id} className="nfi-defaults-tabrow">
                <span className="nfi-mono" style={{ minWidth: "8rem" }}>
                  {page.name}
                </span>
                <div className="nfi-settings-select" style={{ flex: 1 }}>
                  <select
                    aria-label={`Default tab for ${page.name}`}
                    value={effective.defaultPanels[page.id] ?? ""}
                    onChange={(event) => setTab(page.id, event.target.value)}
                  >
                    <option value="">Workspace default</option>
                    {tabs.map((tab) => (
                      <option key={tab.id} value={tab.id}>
                        {tab.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}

export function ManageUsersContent() {
  const capabilities = useCapabilities();
  const granted = capabilities.granted;
  const list = useCapability("users.list", {});

  const canList = granted.includes("users.list");
  const canCreate = granted.includes("users.create");
  const canUpdate = granted.includes("users.update");
  const canRemove = granted.includes("users.remove");
  const canSetDefaults = granted.includes("system.page-defaults.update");

  interface CreateFormState {
    open: boolean;
    username: string;
    password: string;
    selected: ReadonlySet<string>;
  }

  const createStore = useLocalStore<CreateFormState>({
    open: false,
    username: "",
    password: "",
    selected: new Set<string>(),
  });

  const createForm = useStore(createStore, (s) => s);

  const setCreateOpen = (open: boolean): void =>
    createStore.setState((p) => ({ ...p, open }));

  const editorStore = useLocalStore<EditorState | null>(null);
  const editor = useStore(editorStore, (s) => s);

  const setEditor = (
    next:
      | EditorState
      | null
      | ((current: EditorState | null) => EditorState | null),
  ): void => editorStore.setState((p) => functionalUpdate(next, p));

  interface ActionState {
    error: string | null;
    busy: boolean;
  }

  const actionStore = useLocalStore<ActionState>({
    error: null,
    busy: false,
  });

  const { error, busy } = useStore(actionStore, (s) => s);

  /** Capabilities the caller may grant (server enforces the same subset). */
  const grantable = granted.includes("users.list") ? granted : ([] as const);

  const refresh = async () => {
    await refreshCapability("users.list", {});
    // Own grants may have changed (self-edit); re-derive identity + grants.
    await refreshSessionState();
  };

  const runAction = async (action: () => Promise<void>): Promise<void> => {
    if (actionStore.state.busy) return;
    actionStore.setState((p) => ({ ...p, busy: true, error: null }));

    try {
      await action();
      await refresh();
    } catch (cause) {
      actionStore.setState((p) => ({
        ...p,
        error: formatQueryError(cause) ?? "Action failed",
      }));
    } finally {
      actionStore.setState((p) => ({ ...p, busy: false }));
    }
  };

  const submitCreate = () =>
    runAction(async () => {
      await callCapability("users.create", {
        username: createStore.state.username.trim(),
        password: createStore.state.password,
        capabilities: [...createStore.state.selected].map((id) =>
          Schema.decodeUnknownSync(Capability)(id),
        ),
      });
      createStore.setState(() => ({
        open: false,
        username: "",
        password: "",
        selected: new Set(),
      }));
    });

  /** Open the edit dialog, resolving the stored page-defaults override. */
  const openEditor = (user: ManagedUser) => {
    setEditor({
      user,
      selected: new Set(user.capabilities),
      password: "",
      defaults: canSetDefaults ? undefined : null,
    });

    if (!canSetDefaults) return;
    void fetchPageDefaultsFor(user.id).then((scoped) => {
      setEditor((current) =>
        current !== null && current.user.id === user.id
          ? { ...current, defaults: scoped?.defaults ?? null }
          : current,
      );
    });
  };

  const submitEditor = () =>
    runAction(async () => {
      const editor = editorStore.state;

      if (!editor) return;
      await callCapability("users.update", {
        id: editor.user.id,
        capabilities: [...editor.selected].map((id) =>
          Schema.decodeUnknownSync(Capability)(id),
        ),
        password: editor.password.length > 0 ? editor.password : undefined,
      });

      if (canSetDefaults && editor.defaults !== undefined) {
        // Null clears the override back to global-following; an object
        // replaces it (landing page, visible pages, default tabs).
        await savePageDefaults({
          userId: editor.user.id,
          defaults: editor.defaults,
        });
      }

      setEditor(null);
    });

  const removeUser = (user: ManagedUser) => {
    void requestConfirm({
      title: `Delete "${user.username}"?`,
      message:
        "Their sessions end immediately (next request resolves as anonymous). This cannot be undone.",
      confirmLabel: "Delete",
      danger: true,
    }).then((confirmed) => {
      if (!confirmed) return;
      void runAction(async () => {
        await callCapability("users.remove", { id: user.id });
      });
    });
  };

  // --- Forbidden gate --------------------------------------------------------

  if (!canList) {
    return (
      <div className="nfi-settings-inner">
        <WidgetStateView
          tone="forbidden"
          title="Not authorized"
          hint="Managing users requires the users.list capability. Ask an admin (the root user) to grant it."
          detail={`Missing capability: users.list — signed in as ${
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

  const users = list.data?.users ?? [];

  const columns: NfiColumnDef<ManagedUser>[] = [
    {
      id: "user",
      header: "User",
      cell: ({ row }) => row.original.username,
      meta: { className: "nfi-mono" },
      enableSorting: false,
    },
    {
      id: "role",
      header: "Role",
      cell: ({ row }) => {
        const isRoot = row.original.id === ROOT_USER_ID;
        const isAnonymous = row.original.id === ANONYMOUS_USER_ID;

        return (
          <Tag
            size="sm"
            type={isRoot ? "purple" : isAnonymous ? "teal" : "gray"}
          >
            {row.original.role}
          </Tag>
        );
      },
      enableSorting: false,
    },
    {
      id: "capabilities",
      header: "Capabilities",
      cell: ({ row }) =>
        row.original.id === ROOT_USER_ID
          ? "all (env-configured)"
          : `${row.original.capabilities.length} granted`,
      meta: { style: { opacity: 0.8 } },
      enableSorting: false,
    },
    {
      id: "updated",
      header: "Updated",
      cell: ({ row }) =>
        row.original.updatedAt
          ? formatDateTime(new Date(row.original.updatedAt))
          : "—",
      meta: { className: "nfi-mono", style: { opacity: 0.7 } },
      enableSorting: false,
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const user = row.original;
        const isRoot = user.id === ROOT_USER_ID;
        const isAnonymous = user.id === ANONYMOUS_USER_ID;

        if (isRoot) {
          return <span style={{ opacity: 0.5 }}>read-only</span>;
        }

        return (
          <>
            <Button
              kind="ghost"
              size="sm"
              disabled={!canUpdate || busy}
              onClick={() => openEditor(user)}
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
              <h2 className="nfi-users-title">Manage users</h2>
              <p className="nfi-users-subtitle">
                Root is configured from the server environment and always holds
                every capability. Anonymous is the grant for everyone not signed
                in — keep it to the <span className="nfi-mono">.relative</span>{" "}
                + neutral ids to share the dashboard without leaking absolute
                balances or PnL. To set what signed-out visitors see, edit Home
                (header View-as → anonymous, arrange, it auto-saves shared) and
                keep their landing page on Home — Home is public-readable, while
                custom/preset pages need{" "}
                <span className="nfi-mono">workspace.list</span> +{" "}
                <span className="nfi-mono">workspace.load</span> granted to
                anonymous to load in incognito.
              </p>
            </div>
            {canCreate ? (
              <Button
                size="sm"
                onClick={() => {
                  createStore.setState((p) => ({ ...p, selected: new Set() }));
                  setCreateOpen(true);
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
              onCloseButtonClick={() =>
                actionStore.setState((p) => ({ ...p, error: null }))
              }
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
          <div
            className="nfi-table-scroll"
            style={{ width: "100%", fontSize: "0.8125rem" }}
          >
            <NfiDataTable
              className="nfi-users-table"
              columns={columns}
              data={users}
              getRowId={(user) => user.id}
              size="md"
            />
          </div>
        </Tile>
        {canSetDefaults ? <GlobalDefaultsTile /> : null}
        {capabilities.role === "root" ? <SensitivityCriteriaTile /> : null}
      </div>

      <Modal
        open={createForm.open}
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
            value={createForm.username}
            onChange={(event) =>
              createStore.setState((p) => ({
                ...p,
                username: event.target.value,
              }))
            }
          />
          <PasswordInput
            id="new-user-password"
            labelText="Password"
            value={createForm.password}
            onChange={(event) =>
              createStore.setState((p) => ({
                ...p,
                password: event.target.value,
              }))
            }
          />
          <p className="nfi-capability-group-title">Granted capabilities</p>
          <CapabilityEditor
            available={grantable}
            selected={createForm.selected}
            onToggle={(capability, checked) =>
              createStore.setState((p) => {
                const next = new Set(p.selected);

                if (checked) next.add(capability);
                else next.delete(capability);

                return { ...p, selected: next };
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
                    current
                      ? { ...current, password: event.target.value }
                      : current,
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
                  if (!current) return current;
                  const next = new Set(current.selected);

                  if (checked) next.add(capability);
                  else next.delete(capability);

                  return { ...current, selected: next };
                })
              }
            />
            {canSetDefaults ? (
              <>
                <p className="nfi-capability-group-title">Default pages</p>
                <p style={{ fontSize: "0.8125rem", opacity: 0.7 }}>
                  Landing page, header visibility and default tabs for this
                  {editor.user.id === ANONYMOUS_USER_ID
                    ? " role (every signed-out visitor)"
                    : " user"}
                  . Preview the result with the header&apos;s View-as switcher.
                </p>
                <DefaultsSection
                  defaults={editor.defaults}
                  onChange={(defaults) =>
                    setEditor((current) =>
                      current ? { ...current, defaults } : current,
                    )
                  }
                />
                {editor.defaults !== null && editor.defaults !== undefined ? (
                  <Button
                    kind="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      setEditor((current) =>
                        current ? { ...current, defaults: null } : current,
                      )
                    }
                  >
                    Clear override (follow global)
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}
