import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./assets/fonts.css";
import "./styles.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("MarkDownGonzo render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <pre style={{ minHeight: "100vh", margin: 0, padding: 24, color: "#ffb4b4", background: "#15171b", whiteSpace: "pre-wrap" }}>
        <strong>MarkDownGonzo render error</strong>{"\n\n"}{this.state.error.stack ?? this.state.error.message}
      </pre>;
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
);
