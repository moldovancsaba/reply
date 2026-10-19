import { Component, type ErrorInfo, type ReactNode } from "react";
import { SemanticButton, StateBlock } from "@sovereignsquad/gds";

type Props = { children: ReactNode; resetKey?: string };
type State = { failed: boolean };

// A render error in one screen must not blank the whole app: show a GDS error state with a way out.
// The error goes to the console only (no telemetry leaves this machine).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("render error", error.message, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <StateBlock
        variant="error"
        title="Something went wrong showing this screen"
        description="Reload the page. If it keeps happening, restart Reply Core."
        action={<SemanticButton action="refresh" label="Reload" onClick={() => window.location.reload()} />}
      />
    );
  }
}
