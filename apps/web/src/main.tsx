// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import "@ibm/plex-sans/css/ibm-plex-sans-default.css";
import "@ibm/plex-mono/css/ibm-plex-mono-default.css";
import "@carbon/styles/css/styles.css";
import "@carbon/charts/styles.css";
import "./styles.css";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useStore } from "@tanstack/react-store";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Theme } from "@carbon/react";
import {
  setCapabilityTransport,
  setCapabilitiesGrant,
  setStreamBaseUrl,
  reconnectStream,
} from "@nfi/widgets/live";
import { setPanelConfigSink } from "@nfi/widgets";
import { colorBlindStore } from "@nfi/widgets";
import { queryClient } from "./api";
import { callCapability } from "./capabilities/client";
import { capabilitiesStore } from "./auth/capabilities";
import { effectiveGranted, viewAsStore } from "./auth/viewAs";
import { prefsStore } from "./store";
import {
  accentStyleFor,
  colorBlindStyleFor,
  highContrastStyleFor,
} from "./carbonTheme";
import { updatePanelConfig } from "./workspace/store";
import { router } from "./router";

// --- Widget-package bridges (registered once, before any render) -----------
// The widgets package owns the live layer and settings write path but gets
// its app-owned inputs injected: the HTTP transport, the SSE stream base URL
// (same backend the REST calls hit — empty = same-origin), the capability
// grant mirror, and the workspace panel-config sink.
setCapabilityTransport(callCapability);

setPanelConfigSink(updatePanelConfig);

setStreamBaseUrl(prefsStore.state.apiBaseUrl);

// When the user retargets the backend in Settings, the multiplexed SSE
// stream must follow the unary transport to the new origin immediately.
let lastStreamBaseUrl = prefsStore.state.apiBaseUrl;

prefsStore.subscribe((state) => {
  if (state.apiBaseUrl !== lastStreamBaseUrl) {
    lastStreamBaseUrl = state.apiBaseUrl;
    setStreamBaseUrl(state.apiBaseUrl);
    reconnectStream();
  }
});

// Both stores seed with the same offline-lenient defaults (full grant,
// anonymous), so mirroring on change is enough. The view-as preview
// overlays the mocked grant so picker/palette badges follow the target —
// the backend still enforces the real session on every call.
const mirrorEffectiveGrant = () => {
  const state = capabilitiesStore.state;
  setCapabilitiesGrant(effectiveGranted(), state.authenticated);
};

capabilitiesStore.subscribe(mirrorEffectiveGrant);

viewAsStore.subscribe(mirrorEffectiveGrant);

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Missing #root element");
}

/**
 * The Carbon theme scope + accent color follow the user's preferences: the
 * base theme is one of the compiled `@carbon/styles` scopes and the accent
 * layers `--cds-*` overrides on the same wrapper element (see
 * `carbonTheme.ts`), so every component — compiled Carbon or app CSS —
 * re-colors together.
 */
function ThemedApp({ children }: { children: ReactNode }) {
  const colorTheme = useStore(prefsStore, (state) => state.colorTheme);
  const accentColor = useStore(prefsStore, (state) => state.accentColor);
  const highContrast = useStore(prefsStore, (state) => state.highContrast);
  const colorBlind = useStore(colorBlindStore, (enabled) => enabled);

  // Layers merge accent -> high-contrast -> color-blind (see carbonTheme.ts):
  // each optional layer joins the style only when its toggle is on.
  let style = accentStyleFor(accentColor, colorTheme);

  if (highContrast) style = { ...style, ...highContrastStyleFor(colorTheme) };

  if (colorBlind) style = { ...style, ...colorBlindStyleFor(colorTheme) };

  return (
    <Theme theme={colorTheme} style={style}>
      {children}
    </Theme>
  );
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemedApp>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </ThemedApp>
  </StrictMode>,
);
