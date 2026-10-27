import { Component, type ReactNode } from "react";

interface Props {
  /** What failed, for the message: "this chat", "the preview". */
  what: string;
  children: ReactNode;
}

/** Contains a rendering error to one part of the app instead of blanking the whole page. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel-empty">
        <div>
          <p>Something went wrong showing {this.props.what}: {this.state.error.message}</p>
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      </div>
    );
  }
}
