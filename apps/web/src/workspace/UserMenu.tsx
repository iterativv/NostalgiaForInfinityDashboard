// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Link } from "@tanstack/react-router"
import { useStore } from "@tanstack/react-store"
import { Logout, UserAvatar, UserMultiple } from "@carbon/icons-react"
import { capabilitiesStore } from "../auth/capabilities"
import { logout } from "../auth/session"

/**
 * Topbar account menu — the single surface for everything about the caller.
 *
 * Mirrors the backend's view (hydrated from `Auth.capabilities`): anonymous
 * visitors get "Sign in"; signed-in callers get an icon trigger whose menu
 * carries the identity (username + role) plus the actions that used to
 * litter the header (manage users, sign out). Hiding actions here is
 * cosmetic — the backend enforces every capability either way.
 *
 * The menu portals to `#root` (under Carbon's g100 theme) and anchors below
 * the trigger like the tab actions menu.
 */

const MENU_WIDTH_PX = 11 * 16
const HEADER_HEIGHT_PX = 35

export function UserMenu() {
  const state = useStore(capabilitiesStore, (s) => s)
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // First menu item (Link or button) — HTMLElement, since either element
  // type can hold it depending on the caller's grants.
  const firstItemRef = useRef<HTMLElement | null>(null)

  const canManage = state.granted.includes("users.list")

  useEffect(() => {
    if (open) firstItemRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && !document.querySelector(".nfi-usermenu")?.contains(target)) setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [open])

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
    )
  }

  const toggle = () => {
    setAnchor(triggerRef.current?.getBoundingClientRect() ?? null)
    setOpen((value) => !value)
  }

  // Below the trigger, right-aligned; flipped above near the viewport
  // bottom, clamped horizontally (same geometry as the tab actions menu).
  const style: CSSProperties = (() => {
    const items = 1 + (canManage ? 1 : 0)
    const height = HEADER_HEIGHT_PX + items * 37 + 12
    if (!anchor) return { top: 0, left: 0, width: MENU_WIDTH_PX }
    const below = anchor.bottom + 4
    const top =
      below + height > window.innerHeight
        ? Math.max(8, anchor.top - height - 4)
        : Math.min(window.innerHeight - height - 8, below)
    const left = Math.max(
      8,
      Math.min(window.innerWidth - MENU_WIDTH_PX - 8, anchor.right - MENU_WIDTH_PX),
    )
    return { top, left, width: MENU_WIDTH_PX }
  })()

  const username = state.username ?? "user"
  const role = state.role ?? "user"

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="nfi-topbar-button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Signed in as ${username}`}
        onClick={toggle}
      >
        <UserAvatar size={16} />
      </button>
      {open
        ? createPortal(
            <div
              className="nfi-tabmenu-overlay"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setOpen(false)
              }}
            >
              <div role="menu" aria-label="Account" className="nfi-usermenu" style={style}>
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
                {canManage ? (
                  <Link
                    ref={(element) => {
                      firstItemRef.current = element
                    }}
                    to="/users"
                    role="menuitem"
                    className="nfi-tabmenu-item"
                    onClick={() => setOpen(false)}
                  >
                    <UserMultiple size={16} />
                    Manage users
                  </Link>
                ) : null}
                <button
                  ref={
                    canManage
                      ? undefined
                      : (element) => {
                          firstItemRef.current = element
                        }
                  }
                  type="button"
                  role="menuitem"
                  className="nfi-tabmenu-item nfi-tabmenu-item--danger"
                  onClick={() => {
                    setOpen(false)
                    void logout()
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
  )
}
