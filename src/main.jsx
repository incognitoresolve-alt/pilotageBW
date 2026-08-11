import React from "react";
import ReactDOM from "react-dom/client";
import "./lib/storage";
import "./index.css";
import App from "./App.jsx";
import { ErrorBoundary } from "./lib/ErrorBoundary.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
