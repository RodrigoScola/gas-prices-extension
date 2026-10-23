import { createRoot } from "react-dom/client";
import { AppTheme } from "../shared/theme.jsx";
import App from "./App.jsx";

createRoot(document.getElementById("root")).render(
  <AppTheme>
    <App />
  </AppTheme>,
);
