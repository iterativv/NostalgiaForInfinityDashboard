// SPDX-FileCopyrightText: 2026 Laode Muhammad Al Fatih <lamualfa@gmail.com>
// SPDX-License-Identifier: SSPL-1.0

import { Component, type ReactNode } from "react";
import { Button } from "@carbon/react";
import { WidgetStateView } from "@nfi/ui";

/**
 * WorkspaceErrorBoundary — the last line of defense around the workspace
 * viewport (grid renderer + floating layer).
 *
 * Individual widgets already degrade through `PanelErrorBoundary`, but a
 * fault in the layout tree itself (a corrupt grid, a bad tab group, a
 * preset page whose curated shape no longer matches its panels) would
 * otherwise unmount the entire shell — the "page crash". This boundary
 * contains the fault to the viewport: the header, pages bar, dialogs and
 * status bar keep working, and the fallback offers a way back (Home) plus
 * a layout reset for the offending page.
 *
 * The boundary resets whenever the active page changes (`pageId` in the
 * key is owned by the caller), so navigating away and back retries the
 * render instead of sticking on the error.
 */

export function WorkspaceErrorFallback({
  pageName,
  detail,
  onHome,
  onReset,
}: {
  pageName: string;
  detail: string | null;
  onHome: () => void;
  onReset: () => void;
}) {
  return (
    <div
      className="nfi-panel"
      data-focused="false"
      style={{ alignSelf: "center", maxWidth: "36rem", margin: "2rem auto" }}
    >
      <div className="nfi-panel-body">
        <WidgetStateView
          tone="error"
          title={`"${pageName}" failed to render`}
          hint="The page layout hit an unexpected error. Your other pages and data are unaffected — go back Home or reset this page to its default layout."
          detail={detail ?? undefined}
        >
          <Button size="sm" kind="primary" onClick={onHome}>
            Back to Home
          </Button>
          <Button size="sm" kind="secondary" onClick={onReset}>
            Reset this page
          </Button>
        </WidgetStateView>
      </div>
    </div>
  );
}

interface WorkspaceErrorBoundaryProps {
  readonly pageId: string;
  readonly pageName: string;
  readonly onHome: () => void;
  readonly onReset: () => void;
  readonly children: ReactNode;
}

interface WorkspaceErrorBoundaryState {
  readonly error: Error | null;
}

export class WorkspaceErrorBoundary extends Component<
  WorkspaceErrorBoundaryProps,
  WorkspaceErrorBoundaryState
> {
  constructor(props: WorkspaceErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(
    error: Error,
  ): WorkspaceErrorBoundaryState {
    return { error };
  }

  componentDidUpdate(
    prevProps: WorkspaceErrorBoundaryProps,
  ): void {
    if (
      prevProps.pageId !== this.props.pageId &&
      this.state.error !== null
    ) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return (
        <WorkspaceErrorFallback
          pageName={this.props.pageName}
          detail={this.state.error.message}
          onHome={this.props.onHome}
          onReset={() => {
            this.setState({ error: null });
            this.props.onReset();
          }}
        />
      );
    }

    return this.props.children;
  }
}
