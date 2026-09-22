// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useNavigate } from "@tanstack/react-router"
import { Button } from "@carbon/react"
import { UserAvatar } from "@carbon/icons-react"

/**
 * "Sign in" call-to-action for actionable forbidden states. Anonymous
 * visitors CAN act on a Not-authorized state — the fix may be as simple as
 * signing in (the admin viewing their own public dashboard, a user whose
 * grant covers the widget). Signed-in callers get no CTA: they cannot
 * self-grant a capability they lack (the server's escalation guard blocks
 * it), so their only path is asking an admin — the hint says so.
 */
export function SignInCta({ size = "sm" }: { size?: "sm" | "md" | "lg" }) {
  const navigate = useNavigate()
  return (
    <Button
      size={size}
      renderIcon={UserAvatar}
      iconDescription="Sign in"
      onClick={() => void navigate({ to: "/login" })}
    >
      Sign in
    </Button>
  )
}
