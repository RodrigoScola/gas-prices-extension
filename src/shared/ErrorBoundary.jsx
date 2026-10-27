// If a page crashes, show what happened and a way out instead of a blank panel.
import { Component } from "react";
import { Alert, AlertTitle, Box, Button } from "@mui/material";

export class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Sidebar crashed:", error, info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" id="crash">
          <AlertTitle>Something went wrong</AlertTitle>
          {String(this.state.error.message || this.state.error)}
          <Box sx={{ mt: 1.5 }}>
            <Button size="small" variant="outlined" color="error" onClick={async () => {
              // A saved quote that breaks the page would break it again on reload; drop it.
              await chrome.storage.session.remove("lastQuote");
              location.reload();
            }}>Reload</Button>
          </Box>
        </Alert>
      </Box>
    );
  }
}
