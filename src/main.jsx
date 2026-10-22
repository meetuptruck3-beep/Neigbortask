import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("NeighborTask render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return React.createElement(
        "main",
        {
          style: {
            minHeight: "100vh",
            padding: "32px 24px",
            display: "grid",
            placeItems: "center",
            background: "#f8faf7",
            color: "#18372f",
            fontFamily: "system-ui, sans-serif"
          }
        },
        React.createElement(
          "section",
          { style: { maxWidth: "560px", width: "100%", background: "#fff", padding: "28px", borderRadius: "16px", boxShadow: "0 8px 32px #18372f12" } },
          React.createElement("h1", { style: { marginTop: 0 } }, "NeighborTask hit a problem"),
          React.createElement("p", null, "The page could not load correctly. Refresh the page and try again."),
          React.createElement("p", { style: { fontSize: "13px", overflowWrap: "anywhere", color: "#8b3328" } }, String(this.state.error?.message || this.state.error)),
          React.createElement("button", { onClick: () => window.location.reload(), style: { padding: "12px 18px", border: 0, borderRadius: "8px", background: "#1c4c3c", color: "#fff", fontWeight: 700 } }, "Reload NeighborTask")
        )
      );
    }
    return this.props.children;
  }
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    React.createElement(AppErrorBoundary, null,
      React.createElement(React.StrictMode, null, React.createElement(App))
    )
  );
} else {
  document.body.innerHTML = "<main style='font-family:system-ui;padding:24px'><h1>NeighborTask could not start</h1><p>The page is missing its app root element. Please check the deployment build.</p></main>";
}
