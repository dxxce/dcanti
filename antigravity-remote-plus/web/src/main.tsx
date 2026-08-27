import React, { Component, ErrorInfo, ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[App ErrorBoundary]", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          padding: "24px",
          textAlign: "center",
          background: "var(--bg, #111)",
          color: "var(--text, #fff)",
          fontFamily: "system-ui, sans-serif"
        }}>
          <h2 style={{ fontSize: "1.3rem", marginBottom: "12px", color: "var(--err, #ff6b6b)" }}>
            Đã xảy ra lỗi hiển thị giao diện
          </h2>
          <p style={{ maxWidth: "480px", color: "var(--text-dim, #999)", fontSize: "13px", marginBottom: "20px" }}>
            {this.state.error?.message || "Lỗi không xác định"}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 18px",
              borderRadius: "8px",
              background: "var(--accent, #3b82f6)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: "13px"
            }}
          >
            Tải lại trang (Reload)
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const el = document.getElementById("root")!;
createRoot(el).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
