import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { LoadBoundary } from "./components/LoadBoundary";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LoadBoundary>
      <App />
    </LoadBoundary>
  </React.StrictMode>,
);

if (new URL(location.href).searchParams.get("profile") === "1") {
  void import("./performance").then((m) => m.installPerformanceProbe());
}
