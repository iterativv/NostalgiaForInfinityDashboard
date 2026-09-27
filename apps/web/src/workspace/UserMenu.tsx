// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Link } from "@tanstack/react-router";
import { shallow, useStore } from "@tanstack/react-store";
import { Close, Logout, Settings, UserAvatar, View } from "@carbon/icons-react";
import { ANONYMOUS_USER_ID, ROOT_USER_ID } from "@nfi/api-contract";
import {
  useDerived,
  useElementStore,
  useLocalStore,
  useStoreEffect,
} from "@nfi/ui";
import { capabilitiesStore } from "../auth/capabilities";
import { logout } from "../auth/session";
import {
  clearViewAs,
  setViewAs,
  viewAsStore,
} from "../auth/viewAs";
import { useCapability } from "../capabilities/live";
import {
  discardPreviewEdits,
  hasPreviewEdits,
  savePreviewEdits,
  workspaceStore,
} from "./store";

/**
 * Topbar account menu — the single header surface for everything about the
 * caller. The aside drawer it replaces carried Settings + the account
 * block; the "View as" header select moved in here too, so the topbar
 * keeps only icon actions (search, share, account).
 *
 * Mirrors the backend's view (hydrated from `Auth.capabilities`): anonymous
 * visitors get "Sign in"; signed-in callers get an icon trigger whose menu
 * carries the identity (username + role), the view-as preview picker (for
 * `users.list` holders), Settings and Sign out. Hiding actions here is
 * cosmetic — the backend enforces every capability either way.
 *
 * The menu portals to `#root` (under Carbon's g100 theme) and anchors
 * below the trigger like the tab actions menu. The preview banner
 * (`ViewAsBanner`, exported here) stays a topbar strip of its own.
 */

const MENU_WIDTH_PX = 13 * 16;

/** Identity header + one picker row + two action items, in px (flip math). */
function menuHeightPx(hasViewAs: boolean): number {
  return 12 + 33 + (hasViewAs ? 49 : 0) + 2 * 37;
}

export function UserMenu() {
  const state = useStore(capabilitiesStore, (s) => s);

  // Menu state in one component store: open + anchor rect.
  interface UserMenuState {
    open: boolean;
    anchor: DOMRect | null;
  }

  const menuStore = useLocalStore<UserMenuState>({
    open: false,
    anchor: null,
  });

  const menu = useStore(menuStore, (s) => s);

  const { store: triggerEl, setElement: setTriggerEl } =
    useElementStore<HTMLButtonElement>();

  // First menu control (the picker when present, else the Settings link).
  const { store: firstItemEl, setElement: setFirstItemEl } =
    useElementStore<HTMLElement>();

  const canPreview = state.granted.includes("users.list");

  useStoreEffect(() => {
    if (menu.open) firstItemEl.state?.focus();
  }, [menu.open]);

  useStoreEffect(() => {
    if (!menu.open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        menuStore.setState((p) => ({ ...p, open: false }));
        triggerEl.state?.focus();
      }
    };

    const onPointer = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;

      if (target && !document.querySelector(".nfi-usermenu")?.contains(target))
        menuStore.setState((p) => ({ ...p, open: false }));
    };

    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);

    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [menu.open]);

  if (!state.authenticated) {
    return (
      <Link
        to="/login"
        className="nfi-topbar-button"
        aria-label="Sign in"
        title="Sign in"
      >
        <UserAvatar size={16} />
      </Link>
    );
  }

  const toggle = () => {
    menuStore.setState((p) => ({
      ...p,
      anchor: triggerEl.state?.getBoundingClientRect() ?? null,
      open: !p.open,
    }));
  };

  // Below the trigger, right-aligned; flipped above near the viewport
  // bottom, clamped horizontally (same geometry as the tab actions menu).
  const style: CSSProperties = (() => {
    const height = menuHeightPx(canPreview);

    if (!menu.anchor) return { top: 0, left: 0, width: MENU_WIDTH_PX };
    const below = menu.anchor.bottom + 4;

    const top =
      below + height > window.innerHeight
        ? Math.max(8, menu.anchor.top - height - 4)
        : Math.min(window.innerHeight - height - 8, below);

    const left = Math.max(
      8,
      Math.min(
        window.innerWidth - MENU_WIDTH_PX - 8,
        menu.anchor.right - MENU_WIDTH_PX,
      ),
    );

    return { top, left, width: MENU_WIDTH_PX };
  })();

  const username = state.username ?? "user";
  const role = state.role ?? "user";

  return (
    <>
      <button
        ref={setTriggerEl}
        type="button"
        className="nfi-topbar-button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        title={`Signed in as ${username}`}
        onClick={toggle}
      >
        <UserAvatar size={16} />
      </button>
      {menu.open
        ? createPortal(
            <div
              className="nfi-tabmenu-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget)
                  menuStore.setState((p) => ({ ...p, open: false }));
              }}
            >
              <div
                role="menu"
                aria-label="Account"
                className="nfi-usermenu"
                style={style}
              >
                <div className="nfi-usermenu-header">
                  <span className="nfi-mono">{username}</span>
                  <span
                    className="nfi-topbar-user-role"
                    data-role={role}
                    title={
                      role === "root"
                        ? "Root user — always holds every capability"
                        : undefined
                    }
                  >
                    {role}
                  </span>
                </div>
                {canPreview ? <ViewAsRow setFirstItemEl={setFirstItemEl} /> : null}
                <Link
                  ref={canPreview ? undefined : setFirstItemEl}
                  to="/settings"
                  search={{ tab: "appearance" }}
                  role="menuitem"
                  className="nfi-tabmenu-item"
                  onClick={() =>
                    menuStore.setState((p) => ({ ...p, open: false }))
                  }
                >
                  <Settings size={16} />
                  Settings
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item nfi-tabmenu-item--danger"
                  onClick={() => {
                    menuStore.setState((p) => ({ ...p, open: false }));
                    void logout();
                  }}
                >
                  <Logout size={16} />
                  Sign out
                </button>
              </div>
            </div>,
            // Inside #root (under Carbon's g100 Theme) so theme tokens
            // resolve; the menu would lose its colors on document.body.
            document.getElementById("root") ?? document.body,
          )
        : null}
    </>
  );
}

/**
 * View-as picker row inside the account menu (moved from the header's
 * standalone switcher): visible only to holders of `users.list` (they can
 * already see every grant). Picking a target overlays that identity's
 * capability grant and page visibility on the whole shell without ever
 * impersonating server-side — REST/SSE keep running as the real session.
 */
function ViewAsRow({
  setFirstItemEl,
}: {
  setFirstItemEl: (el: HTMLElement | null) => void;
}) {
  const viewAs = useStore(viewAsStore, (s) => s);
  const list = useCapability("users.list", {});
  const busyStore = useLocalStore(false);
  const busy = useStore(busyStore, (s) => s);

  // Stable user list (feeds the restore effect's deps below).
  const users = useDerived(
    [list.data] as const,
    ([data]) => data?.users ?? [],
    { inputs: shallow },
  );

  // Restore a persisted preview once the user list arrives (grants are
  // never trusted from storage — they re-resolve here; a deleted target
  // clears the preview).
  useStoreEffect(() => {
    if (list.isLoading || list.error) return;
    const current = viewAsStore.state;

    if (current.targetUserId === null || current.targetGranted !== null) return;
    const match = users.find((u) => u.id === current.targetUserId);

    if (!match) {
      clearViewAs();

      return;
    }

    setViewAs(match.id, match.username, match.capabilities);
  }, [list.isLoading, list.error, users]);

  const select = (targetId: string) => {
    if (targetId === "") {
      clearViewAs();

      return;
    }

    const match = users.find((u) => u.id === targetId);

    if (!match) return;
    setViewAs(match.id, match.username, match.capabilities);
  };

  return (
    <label
      className="nfi-usermenu-viewas"
      data-active={viewAs.targetUserId !== null ? "true" : "false"}
      title="Preview the dashboard as another user or the anonymous role (frontend mock — the backend still enforces your own grant)"
    >
      <View size={16} aria-hidden />
      <span className="nfi-usermenu-viewas-label">View as</span>
      <select
        ref={setFirstItemEl}
        aria-label="Preview dashboard as"
        value={viewAs.targetUserId ?? ""}
        disabled={busy || list.isLoading}
        onChange={(event) => {
          busyStore.setState(() => true);

          try {
            select(event.target.value);
          } finally {
            busyStore.setState(() => false);
          }
        }}
      >
        <option value="">Myself (actual)</option>
        {users.map((user) => (
          <option key={user.id} value={user.id}>
            {user.id === ANONYMOUS_USER_ID
              ? "anonymous (role)"
              : user.id === ROOT_USER_ID
                ? `${user.username} (root)`
                : `${user.username} (${user.role})`}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Amber strip below the header while a view-as preview is active. */
export function ViewAsBanner() {
  const viewAs = useStore(viewAsStore, (s) => s);
  // Re-render on every workspace commit (identity changes on each one);
  // the dirty flag itself derives from the staged-edit buffer.
  useStore(workspaceStore, (s) => s.workspace);
  const savingStore = useLocalStore(false);
  const saving = useStore(savingStore, (s) => s);

  if (viewAs.targetUserId === null) return null;
  const dirty = hasPreviewEdits();

  return (
    <div className="nfi-viewas-banner" role="status" aria-label="View-as preview active">
      <span>
        Previewing as{" "}
        <strong className="nfi-mono">{viewAs.targetUsername ?? viewAs.targetUserId}</strong>
        {" "}— a frontend mock for grants + page visibility. Widgets gate on
        their grant; data still loads with your own session (more privileged
        targets show backend errors, not their data). Layout edits stay local
        while previewing — save them to share, or discard.
      </span>
      <span className="nfi-viewas-banner-actions">
        {dirty ? (
          <span className="nfi-viewas-banner-notice" role="status">
            Unsaved preview edits
          </span>
        ) : null}
        {dirty ? (
          <button
            type="button"
            className="nfi-viewas-banner-button"
            disabled={saving}
            title="Persist the active page's staged edits to the shared backend"
            onClick={() => {
              savingStore.setState(() => true);
              void savePreviewEdits().finally(() =>
                savingStore.setState(() => false),
              );
            }}
          >
            {saving ? "Saving…" : "Save edits"}
          </button>
        ) : null}
        {dirty ? (
          <button
            type="button"
            className="nfi-viewas-banner-button"
            disabled={saving}
            title="Drop all staged preview edits and restore every touched page"
            onClick={discardPreviewEdits}
          >
            Discard
          </button>
        ) : null}
        <button
          type="button"
          className="nfi-viewas-banner-button nfi-viewas-banner-exit"
          onClick={clearViewAs}
          aria-label="Exit preview"
        >
          <Close size={14} aria-hidden /> Exit preview
        </button>
      </span>
    </div>
  );
}
