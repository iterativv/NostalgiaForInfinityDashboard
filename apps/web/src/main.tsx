// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import "@ibm/plex-sans/css/ibm-plex-sans-default.css"
import "@ibm/plex-mono/css/ibm-plex-mono-default.css"
import "@carbon/styles/css/styles.css"
import "@carbon/charts/styles.css"
import "./styles.css"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "@tanstack/react-router"
import { Theme } from "@carbon/react"
import { setCapabilityTransport, setCapabilitiesGrant } from "@nfi/widgets/live"
import { setPanelConfigSink } from "@nfi/widgets"
import { queryClient } from "./api"
import { callCapability } from "./capabilities/client"
import { capabilitiesStore } from "./auth/capabilities"
import { updatePanelConfig } from "./workspace/store"
import { router } from "./router"

// --- Widget-package bridges (registered once, before any render) -----------
// The widgets package owns the live layer and settings write path but gets
// its app-owned inputs injected: the HTTP transport, the capability grant
// mirror, and the workspace panel-config sink.
setCapabilityTransport(callCapability)
setPanelConfigSink(updatePanelConfig)
// Both stores seed with the same offline-lenient defaults (full grant,
// anonymous), so mirroring on change is enough.
capabilitiesStore.subscribe((state) =>
  setCapabilitiesGrant(state.granted, state.authenticated),
)

const rootElement = document.getElementById("root")
if (!rootElement) {
  throw new Error("Missing #root element")
}

createRoot(rootElement).render(
  <StrictMode>
    <Theme theme="g100">
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </Theme>
  </StrictMode>,
)
