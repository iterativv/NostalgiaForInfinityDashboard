// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Component, memo, type ReactNode } from "react";
import { Button } from "@carbon/react";
import { Close } from "@carbon/icons-react";
import { useStore } from "@tanstack/react-store";
import type { Store } from "@tanstack/store";
import {
  EmptyState,
  useElementStore,
  useLocalStore,
  useStoreEffect,
  WidgetChromeContext,
  WidgetStateView,
} from "@nfi/ui";
import {
  missingCapabilities,
  type WidgetProps,
  type WidgetRegistry,
} from "@nfi/widget-sdk";
import { PanelId, type PanelInstance } from "@nfi/api-contract";
import { Schema } from "effect";
import { mergeWidgetSettings, widgetGlobalsStore } from "@nfi/widgets";
import { capabilitiesStore } from "../auth/capabilities";
import { prefsStore } from "../store";
import { viewAsStore } from "../auth/viewAs";
import { LiveOwnerContext } from "../capabilities/live";
import { SignInCta } from "../auth/SignInCta";
import { isWidgetConfig } from "./floating";
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
 * - cell below the widget's minimum size → too-small warning, EXCEPT when
 *   the whole screen is narrower than the widget: then just the widget
 *   content scales down (tab strip and chrome stay full-size)
 * Data states (live-query loading/error/empty) stay widget-driven but render
 * through the same standardized components in `@nfi/ui`.
 *
 * Single-title rule: inside a tab group the tab button already shows the
 * title, so `showHeader` hides the panel header and the chrome context hides
 * each widget frame's title text (actions stay). Bare panel leaves keep
 * their header since no tab shows their title.
 */

/** Border-box size of the panel body (0×0 while the tab is hidden). */
function usePanelBodySize(elStore: Store<HTMLDivElement | null>): {
  width: number;
  height: number;
} {
  const sizeStore = useLocalStore({ width: 0, height: 0 });
  const el = useStore(elStore, (state) => state);

  useStoreEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;

    // Border box: the room the cell actually provides (padding included);
    // scrollbars are SlimScroll overlays (zero layout width), so the rect is
    // the full scrollable area — no scrollbar subtraction to worry about.
    // Equality-guarded + integer-floored: ResizeObserver fires per
    // sub-pixel step during drags, and an unconditional write (fresh
    // object identity) re-rendered the whole widget subtree every frame.
    const read = () => {
      const rect = el.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);
      sizeStore.setState((prev) =>
        prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    };

    const observer = new ResizeObserver(read);
    observer.observe(el);

    return () => observer.disconnect();
  }, [el]);

  return useStore(sizeStore, (size) => size);
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
  // Signed-out visitors are read-only: placeholder close buttons hide.
  const authenticated = useStore(
    capabilitiesStore,
    (state) => state.authenticated,
  );

  return (
    <div className="nfi-panel" data-focused="false" data-panel-id={panelId}>
      {showHeader ? (
        <div className="nfi-panel-header">
          <span className="nfi-panel-title nfi-tab-code">{title}</span>
          {authenticated ? (
            <Button
              size="sm"
              kind="ghost"
              hasIconOnly
              iconDescription={`Close ${title}`}
              renderIcon={Close}
              onClick={() => onClose(panelId)}
            />
          ) : null}
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

interface PanelErrorState {
  failed: boolean;
}

class PanelErrorBoundary extends Component<
  { panelId: string; title: string; children: ReactNode },
  { failed: boolean }
> {
  constructor(props: { panelId: string; title: string; children: ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): PanelErrorState {
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

function PanelImpl({
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
  widgetConfig: PanelInstance["widgetConfig"];
  title: string | undefined;
  focused: boolean;
  registry: WidgetRegistry;
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  /** False inside tab groups: the tab button already shows title + close. */
  showHeader?: boolean;
}) {
  // View-as preview: forbidden states follow the mocked grant so the
  // preview shows what the target would see (data still loads as self).
  // (Store reads inlined from `auth/viewAs`'s helper — same selectors.)
  const viewAsTarget = useStore(viewAsStore, (state) => state.targetUserId);
  const viewAsGrant = useStore(viewAsStore, (state) => state.targetGranted);
  const ownGrant = useStore(capabilitiesStore, (state) => state.granted);

  const granted =
    viewAsTarget !== null && viewAsGrant !== null ? viewAsGrant : ownGrant;

  const authenticated = useStore(
    capabilitiesStore,
    (state) => state.authenticated,
  );

  // Signed-out visitors are read-only: closes, renames and settings hide
  // (store ops refuse too, as a backstop).
  const readOnly = !authenticated;

  // The scroller element lands in a store (SlimScroll gets the stable
  // `setElement` callback as its ref); the too-small guard measures it.
  const { store: bodyElStore, setElement: setBodyElement } =
    useElementStore<HTMLDivElement>();

  const bodySize = usePanelBodySize(bodyElStore);

  // Global widget-settings layer (per widget TYPE): overrides merged on top
  // of the decoded config below, so every instance of the widget — grid,
  // page or floating window — renders the globally-set keys.
  const globalOverrides = useStore(widgetGlobalsStore, (state) =>
    widgetType ? state[widgetType] : undefined,
  );

  // User's custom tab title (rename); tooltips keep the widget's name.
  const customTitle = useStore(
    workspaceStore,
    (state) => state.workspace.panels[panelId]?.title,
  );

  // Preference: widget minimum dimensions off — every cell renders the
  // widget raw (no "needs more room" wall, no small-screen scale-down).
  const minSizesDisabled = useStore(
    prefsStore,
    (state) => state.disableWidgetMinSize,
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
        data-panel-id={panelId}
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
            {readOnly ? null : (
              <Button
                className="nfi-panel-close"
                size="sm"
                kind="ghost"
                hasIconOnly
                iconDescription={`Close ${definition.title}`}
                renderIcon={Close}
                onClick={() => onClose(panelId)}
              />
            )}
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

  let config: WidgetProps<unknown>["config"];

  try {
    const decoded = definition.decodeConfig(widgetConfig);
    const base = isWidgetConfig(decoded) ? decoded : {};

    config = mergeWidgetSettings(base, globalOverrides);
  } catch {
    return (
      <PanelPlaceholder
        title={definition.title}
        message="Stored configuration is invalid for this widget version. Reset or reopen it."
        panelId={panelId}
        onClose={onClose}
        showHeader={showHeader}
        action={
          readOnly ? undefined : (
            <Button
              size="sm"
              kind="secondary"
              onClick={() =>
                updatePanelConfig(
                  panelId,
                  structuredClone(definition.defaultConfig),
                )
              }
            >
              Reset to defaults
            </Button>
          )
        }
      />
    );
  }

  // Too-small guard: a hidden tab measures 0×0 and skips the check.
  // The "disable widget minimum dimensions" preference turns the whole
  // guard off — the widget renders at whatever size the cell provides.
  const measurable = bodySize.width > 0 && bodySize.height > 0;

  const tooNarrow =
    !minSizesDisabled && measurable && bodySize.width < definition.minWidth;

  const tooShort =
    !minSizesDisabled && measurable && bodySize.height < definition.minHeight;

  // Small-screen scale-down: when the whole screen is narrower than the
  // widget, no layout can fit it — scale just the widget content (a GPU
  // transform, origin top-left) instead of the "needs more room" wall. The
  // tab strip and panel chrome stay full-size; only the content shrinks.
  // On larger screens a too-narrow card keeps the warning so the user
  // widens it (the bento renderer wraps readable cards instead of
  // squeezing them, so that only fires for explicitly tiny cards).
  const smallScreen =
    typeof window !== "undefined" && window.innerWidth < definition.minWidth;

  const scaleContent = tooNarrow && smallScreen;

  const contentScale =
    scaleContent && definition.minWidth > 0
      ? bodySize.width / definition.minWidth
      : 1;

  const tooSmall = (tooNarrow || tooShort) && !scaleContent;

  const Component = definition.component;

  return (
    <div
      className="nfi-panel"
      data-focused={focused ? "true" : "false"}
      data-panel-id={panelId}
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
            locked={readOnly}
            canClose={!readOnly}
            canConfigure={definition.hasSettings && !readOnly}
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
      <SlimScroll
        scrollerRef={setBodyElement}
        scrollerClassName="nfi-panel-body"
      >
        {tooSmall ? (
          <WidgetStateView
            tone="warning"
            title={`${definition.title} needs more room`}
            hint="This cell is below the widget's minimum readable size — drag the grid divider, maximize the window, or move the tab to a larger cell."
            detail={`Needs at least ${definition.minWidth}×${definition.minHeight}px — currently ${Math.round(bodySize.width)}×${Math.round(bodySize.height)}px. Prefer smaller cells over the warning? Disable this guard in Settings → Appearance → "Disable widget minimum dimensions".`}
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
                // it so content fits every grid cell without clipping. A
                // scaled-down small screen reports the logical (unscaled)
                // size so widgets lay out as if they had the room.
                contentSize: scaleContent
                  ? {
                      width: definition.minWidth,
                      height: Math.round(bodySize.height / contentScale),
                    }
                  : { width: bodySize.width, height: bodySize.height },
              }}
            >
              {/* Owner id lets the live layer re-fetch exactly this
                  widget's keys (⋯ → Reload). */}
              <LiveOwnerContext.Provider value={panelId}>
                {scaleContent ? (
                  <div
                    style={{
                      width: definition.minWidth,
                      height: Math.max(
                        bodySize.height,
                        bodySize.height / contentScale,
                      ),
                      transform: `scale(${contentScale})`,
                      transformOrigin: "top left",
                    }}
                  >
                    <Component
                      panelId={Schema.decodeSync(PanelId)(panelId)}
                      config={config}
                      focused={focused}
                    />
                  </div>
                ) : (
                  <Component
                    panelId={Schema.decodeSync(PanelId)(panelId)}
                    config={config}
                    focused={focused}
                  />
                )}
              </LiveOwnerContext.Provider>
            </WidgetChromeContext.Provider>
          </PanelErrorBoundary>
        )}
      </SlimScroll>
    </div>
  );
}

/**
 * Memoized: workspace commits (grid resize, tab activation, floating-window
 * settle) replace the workspace object, which re-renders every renderer
 * level above the panels. Panel props are identity-stable across those
 * commits (the panels map keeps untouched instances, callbacks are module
 * functions), so untouched panels skip their whole subtree. Store-driven
 * changes (config, capabilities, globals, cell size) still re-render
 * through the subscriptions inside.
 */
export const Panel = memo(PanelImpl);
