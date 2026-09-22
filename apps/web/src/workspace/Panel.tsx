// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@carbon/react";
import { Close } from "@carbon/icons-react";
import { useStore } from "@tanstack/react-store";
import { EmptyState, WidgetChromeContext, WidgetStateView } from "@nfi/ui";
import { missingCapabilities, type WidgetRegistry } from "@nfi/widget-sdk";
import {
  mergeWidgetSettings,
  widgetGlobalsStore,
} from "@nfi/widgets";
import { capabilitiesStore } from "../auth/capabilities";
import { LiveOwnerContext } from "../capabilities/live";
import { SignInCta } from "../auth/SignInCta";
import { SlimScroll } from "./SlimScroll";
import { updatePanelConfig, workspaceStore } from "./store";
import { TabActionsMenu } from "./TabMenu";

/**
 * Panel — the bridge between workspace infrastructure and a widget. It is
 * the widget manager: every NON-DATA widget state is owned and rendered
 * here through the one standardized `WidgetStateView` surface —
 * - missing instance → placeholder
 * - unknown widget type → placeholder (registry miss)
 * - invalid config → placeholder (schema decode failure)
 * - missing capabilities → forbidden state
 * - render throw → PanelErrorBoundary error state
 * - cell below the widget's minimum size → too-small warning
 * Data states (live-query loading/error/empty) stay widget-driven but render
 * through the same standardized components in `@nfi/ui`.
 *
 * Single-title rule: inside a tab group the tab button already shows the
 * title, so `showHeader` hides the panel header and the chrome context hides
 * each widget frame's title text (actions stay). Bare panel leaves keep
 * their header since no tab shows their title.
 */

/** Border-box size of the panel body (0×0 while the tab is hidden). */
function usePanelBodySize(ref: React.RefObject<HTMLDivElement | null>): {
  width: number;
  height: number;
} {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    // Border box: the room the cell actually provides (padding included);
    // scrollbars are SlimScroll overlays (zero layout width), so the rect is
    // the full scrollable area — no scrollbar subtraction to worry about.
    const read = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

export function PanelPlaceholder({
  title,
  message,
  panelId,
  onClose,
  showHeader = true,
  action,
}: {
  title: string;
  message: string;
  panelId: string;
  onClose: (panelId: string) => void;
  showHeader?: boolean;
  /** Optional call-to-action under the copy (e.g. "Reset to defaults"). */
  action?: ReactNode;
}) {
  return (
    <div className="nfi-panel" data-focused="false">
      {showHeader ? (
        <div className="nfi-panel-header">
          <span className="nfi-panel-title nfi-tab-code">{title}</span>
          <Button
            size="sm"
            kind="ghost"
            hasIconOnly
            iconDescription={`Close ${title}`}
            renderIcon={Close}
            onClick={() => onClose(panelId)}
          />
        </div>
      ) : null}
      <div className="nfi-panel-body">
        <EmptyState title={title} hint={message} />
        {action ? (
          <div
            className="nfi-widget-state-actions"
            style={{ justifyContent: "center" }}
          >
            {action}
          </div>
        ) : null}
      </div>
    </div>
  );
}

class PanelErrorBoundary extends Component<
  { panelId: string; title: string; children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { panelId: string; title: string; children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidUpdate(prevProps: { panelId: string }) {
    if (prevProps.panelId !== this.props.panelId && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    if (this.state.failed) {
      return (
        <WidgetStateView
          tone="error"
          title="This widget failed to render"
          hint="An unexpected error occurred while drawing it."
          detail="Close and reopen the tab to retry."
        />
      );
    }
    return this.props.children;
  }
}

export function Panel({
  panelId,
  widgetType,
  widgetConfig,
  title,
  focused,
  registry,
  onActivate,
  onClose,
  showHeader = true,
}: {
  panelId: string;
  widgetType: string | undefined;
  widgetConfig: unknown;
  title: string | undefined;
  focused: boolean;
  registry: WidgetRegistry;
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  /** False inside tab groups: the tab button already shows title + close. */
  showHeader?: boolean;
}) {
  const granted = useStore(capabilitiesStore, (state) => state.granted);
  const authenticated = useStore(
    capabilitiesStore,
    (state) => state.authenticated,
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const bodySize = usePanelBodySize(bodyRef);
  // Global widget-settings layer (per widget TYPE): overrides merged on top
  // of the decoded config below, so every instance of the widget — grid,
  // page or floating window — renders the globally-set keys.
  const globalOverrides = useStore(widgetGlobalsStore, (state) =>
    widgetType ? state[widgetType] : undefined,
  );
  // User's custom tab title (rename); tooltips keep the widget's name.
  const customTitle = useStore(workspaceStore, (state) =>
    state.workspace.panels[panelId]?.title,
  );

  if (widgetType === undefined) {
    return (
      <PanelPlaceholder
        title="Missing panel"
        message={`No widget instance for ${panelId}. It may have been removed.`}
        panelId={panelId}
        onClose={onClose}
        showHeader={showHeader}
      />
    );
  }

  const definition = registry.getWidget(widgetType);
  if (!definition) {
    return (
      <PanelPlaceholder
        title={widgetType}
        message={`Unknown widget type "${widgetType}". It may come from an uninstalled plugin.`}
        panelId={panelId}
        onClose={onClose}
        showHeader={showHeader}
      />
    );
  }

  const missing = missingCapabilities(definition.capabilities, granted);
  if (missing.length > 0) {
    return (
      <div
        className="nfi-panel"
        data-focused={focused ? "true" : "false"}
        onMouseDownCapture={() => {
          if (!focused) onActivate(panelId);
        }}
      >
        {showHeader ? (
          <div className="nfi-panel-header">
            <span
              className="nfi-panel-title nfi-tab-code"
              title={`${definition.title} · ${panelId}`}
            >
              {title ?? definition.title}
            </span>
            <Button
              className="nfi-panel-close"
              size="sm"
              kind="ghost"
              hasIconOnly
              iconDescription={`Close ${definition.title}`}
              renderIcon={Close}
              onClick={() => onClose(panelId)}
            />
          </div>
        ) : null}
        <div className="nfi-panel-body">
          <WidgetStateView
            tone="forbidden"
            title="Not authorized"
            hint={
              authenticated
                ? "Ask an admin to grant the missing capabilities, then reopen this widget."
                : "Sign in — your user may already have access, or ask an admin to widen the public grant."
            }
            detail={missing.join(", ")}
          >
            {authenticated ? null : <SignInCta />}
          </WidgetStateView>
        </div>
      </div>
    );
  }

  let config: unknown;
  try {
    config = mergeWidgetSettings(
      definition.decodeConfig(widgetConfig) as Record<string, unknown>,
      globalOverrides,
    );
  } catch {
    return (
      <PanelPlaceholder
        title={definition.title}
        message="Stored configuration is invalid for this widget version. Reset or reopen it."
        panelId={panelId}
        onClose={onClose}
        showHeader={showHeader}
        action={
          <Button
            size="sm"
            kind="secondary"
            onClick={() =>
              updatePanelConfig(panelId, structuredClone(definition.defaultConfig))
            }
          >
            Reset to defaults
          </Button>
        }
      />
    );
  }

  // Too-small guard: a hidden tab measures 0×0 and skips the check.
  const measurable = bodySize.width > 0 && bodySize.height > 0;
  const tooSmall =
    measurable &&
    (bodySize.width < definition.minWidth ||
      bodySize.height < definition.minHeight);

  const Component = definition.component;
  return (
    <div
      className="nfi-panel"
      data-focused={focused ? "true" : "false"}
      onMouseDownCapture={() => {
        if (!focused) onActivate(panelId);
      }}
      onFocusCapture={() => {
        if (!focused) onActivate(panelId);
      }}
    >
      {showHeader ? (
        <div className="nfi-panel-header">
          <span
            className="nfi-panel-title nfi-tab-code"
            title={`${definition.title} · ${panelId}`}
          >
            {title ?? customTitle ?? definition.title}
          </span>
          <TabActionsMenu
            title={title ?? customTitle ?? definition.title}
            panelId={panelId}
            renamed={customTitle !== undefined}
            canClose
            canConfigure={definition.hasSettings}
            widgetDefinition={definition}
            widgetConfig={config}
            onClosePanel={onClose}
            triggerClassName="nfi-panel-menu"
          />
        </div>
      ) : null}
      {/* Slim overlay scrollbars: the native bar is hidden on the scroller
          and replaced by 6px thumbs (see SlimScroll) — a browser-sized bar
          would eat a third of a small cell. */}
      <SlimScroll scrollerRef={bodyRef} scrollerClassName="nfi-panel-body">
        {tooSmall ? (
          <WidgetStateView
            tone="warning"
            title={`${definition.title} needs more room`}
            hint="This cell is below the widget's minimum readable size — drag the grid divider, maximize the window, or move the tab to a larger cell."
            detail={`Needs at least ${definition.minWidth}×${definition.minHeight}px — currently ${Math.round(bodySize.width)}×${Math.round(bodySize.height)}px.`}
          />
        ) : (
          <PanelErrorBoundary
            key={panelId}
            panelId={panelId}
            title={definition.title}
          >
            <WidgetChromeContext.Provider
              value={{
                hideTitle: !showHeader,
                // Live cell size: widgets switch dense/full presentations on
                // it so content fits every grid cell without clipping.
                contentSize: { width: bodySize.width, height: bodySize.height },
              }}
            >
              {/* Owner id lets the live layer re-fetch exactly this
                  widget's keys (⋯ → Reload). */}
              <LiveOwnerContext.Provider value={panelId}>
                <Component
                  panelId={panelId as never}
                  config={config}
                  focused={focused}
                />
              </LiveOwnerContext.Provider>
            </WidgetChromeContext.Provider>
          </PanelErrorBoundary>
        )}
      </SlimScroll>
    </div>
  );
}
