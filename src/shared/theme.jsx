// Theme for both pages, with a light / dark / system switch saved in chrome.storage.local
// so the sidebar and the settings page stay in step.
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createTheme, ThemeProvider, CssBaseline, IconButton, Tooltip, useMediaQuery } from "@mui/material";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import BrightnessAutoOutlined from "@mui/icons-material/BrightnessAutoOutlined";

const MODES = ["system", "light", "dark"];
const ColorModeContext = createContext({ mode: "system", setMode: () => {} });
export const useColorMode = () => useContext(ColorModeContext);

function makeTheme(mode) {
  const dark = mode === "dark";
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? "#7aa2ff" : "#1d4ed8" },
      secondary: { main: dark ? "#5eead4" : "#0f766e" },
      success: { main: dark ? "#4ade80" : "#15803d" },
      warning: { main: dark ? "#fbbf24" : "#b45309" },
      background: dark ? { default: "#0b1020", paper: "#121a2e" } : { default: "#f4f6fb", paper: "#ffffff" },
      divider: dark ? "rgba(148,163,184,0.16)" : "rgba(15,23,42,0.08)",
      text: dark ? { primary: "#e5e9f2", secondary: "#94a3b8" } : { primary: "#0f172a", secondary: "#475569" },
    },
    shape: { borderRadius: 10 },
    typography: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      fontSize: 13,
      h6: { fontSize: 15, fontWeight: 650, letterSpacing: "-0.01em" },
      subtitle2: { fontSize: 12, fontWeight: 650, letterSpacing: "0.04em", textTransform: "uppercase" },
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiCard: { defaultProps: { variant: "outlined" }, styleOverrides: { root: { borderRadius: 12 } } },
      MuiCardHeader: {
        styleOverrides: {
          root: { padding: "12px 14px 4px" },
          title: { fontSize: 12, fontWeight: 650, letterSpacing: "0.05em", textTransform: "uppercase" },
          action: { margin: 0, alignSelf: "center" },
        },
      },
      MuiCardContent: { styleOverrides: { root: { padding: "8px 14px 14px", "&:last-child": { paddingBottom: 14 } } } },
      MuiTextField: { defaultProps: { size: "small", fullWidth: true } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 }, sizeSmall: { height: 22, fontSize: 11 } } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10, fontSize: 12.5 } } },
      MuiTooltip: { defaultProps: { arrow: true } },
    },
  });
}

export function AppTheme({ children }) {
  const [mode, setModeState] = useState("system");
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");

  useEffect(() => {
    chrome.storage.local.get("colorMode").then(({ colorMode }) => colorMode && setModeState(colorMode));
    const onChange = (changes, area) => {
      if (area === "local" && changes.colorMode?.newValue) setModeState(changes.colorMode.newValue);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const resolved = mode === "system" ? (prefersDark ? "dark" : "light") : mode;
  const theme = useMemo(() => makeTheme(resolved), [resolved]);
  const value = useMemo(() => ({
    mode,
    resolved,
    setMode: (m) => {
      setModeState(m);
      chrome.storage.local.set({ colorMode: m });
    },
  }), [mode, resolved]);

  return (
    <ColorModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ColorModeContext.Provider>
  );
}

const ICON = { system: BrightnessAutoOutlined, light: LightModeOutlined, dark: DarkModeOutlined };
const LABEL = { system: "Theme: match system", light: "Theme: light", dark: "Theme: dark" };

// Cycles system -> light -> dark.
export function ColorModeButton() {
  const { mode, setMode } = useColorMode();
  const Icon = ICON[mode];
  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  return (
    <Tooltip title={`${LABEL[mode]} (click for ${next})`}>
      <IconButton size="small" aria-label={LABEL[mode]} onClick={() => setMode(next)} data-mode={mode}>
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
  );
}
