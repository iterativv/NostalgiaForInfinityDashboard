// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { callCapability } from "../capabilities/client"
import { useCapabilities } from "./capabilities"

/**
 * First-run gate — routes a fresh deployment through its two setup screens.
 *
 * 1. Root provisioning: the backend reports `rootProvisioned: false` on the
 *    auth bootstrap while no always-privileged account exists (env unset,
 *    setup never ran). The terminal and the sign-in page then send the
 *    visitor to `/setup` to claim root. Skipping (per browser session) keeps
 *    the public/anonymous surface usable without an admin.
 * 2. Freqtrade connection: for a signed-in caller allowed to manage
 *    instances, when no freqtrade instance is configured yet (no stored
 *    instance AND the env default has no credentials), `/setup/instances`
 *    offers the first connection. Skippable per browser session too.
 *
 * Both gates redirect ONLY on definitive backend answers (`false`, complete
 * lists) — loading, offline and older backends (field absent) never bounce
 * the user anywhere. The setup pages themselves live on their own routes, so
 * redirecting from here cannot loop.
 */

const ROOT_SETUP_DISMISSED_KEY = "nfi.first-run.root.dismissed"
const INSTANCE_SETUP_DISMISSED_KEY = "nfi.first-run.instances.dismissed"

const flag = (key: string): boolean => {
  try {
    return sessionStorage.getItem(key) === "1"
  } catch {
    return false
  }
}

const setFlag = (key: string): void => {
  try {
    sessionStorage.setItem(key, "1")
  } catch {
    // Private mode without storage: the gate simply re-prompts next mount.
  }
}

/** Silence the root setup redirect for this browser session. */
export function dismissRootSetup(): void {
  setFlag(ROOT_SETUP_DISMISSED_KEY)
}

/** Silence the instance setup redirect for this browser session. */
export function dismissInstanceSetup(): void {
  setFlag(INSTANCE_SETUP_DISMISSED_KEY)
}

export function useFirstRunGate(): void {
  const navigate = useNavigate()
  const capabilities = useCapabilities()
  const ready = capabilities.status === "ready"
  const [rootDismissed] = useState(() => flag(ROOT_SETUP_DISMISSED_KEY))
  const [instancesDismissed] = useState(() => flag(INSTANCE_SETUP_DISMISSED_KEY))

  // Gate 1: claim root before anything else on an unprovisioned deployment.
  useEffect(() => {
    if (ready && capabilities.rootProvisioned === false && !rootDismissed) {
      void navigate({ to: "/setup", replace: true })
    }
  }, [ready, capabilities.rootProvisioned, rootDismissed, navigate])

  // Gate 2: first freqtrade connection — only for callers who manage
  // instances (root today, any user granted instances.list tomorrow).
  const canManageInstances =
    ready &&
    capabilities.authenticated &&
    capabilities.rootProvisioned !== false &&
    capabilities.granted.includes("instances.list")

  const instancesQuery = useQuery({
    queryKey: ["first-run", "instances"],
    queryFn: () => callCapability("instances.list", {}),
    enabled: canManageInstances && !instancesDismissed,
    staleTime: 5_000,
  })
  const backendQuery = useQuery({
    queryKey: ["first-run", "backend-config"],
    queryFn: () => callCapability("system.backend-config", {}),
    enabled: canManageInstances && !instancesDismissed,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!canManageInstances || instancesDismissed) return
    const instances = instancesQuery.data?.instances
    const backend = backendQuery.data
    if (!instances || !backend) return
    const storedCount = instances.filter((instance) => instance.id !== "default").length
    if (storedCount === 0 && !backend.defaultInstanceConfigured) {
      void navigate({ to: "/setup/instances", replace: true })
    }
  }, [canManageInstances, instancesDismissed, instancesQuery.data, backendQuery.data, navigate])
}
