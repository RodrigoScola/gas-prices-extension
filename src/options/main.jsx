import { createRoot } from "react-dom/client";
import { AppTheme } from "../shared/theme.jsx";
import { ErrorBoundary } from "../shared/ErrorBoundary.jsx";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <AppTheme>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </AppTheme>,
);
