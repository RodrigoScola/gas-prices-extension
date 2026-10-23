// Builds the extension into dist/ (load that folder in chrome://extensions).
// The pages are React; background.js, the manifest, the sample email and the default sheets
// from private/ are copied as they are.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const out = `${root}dist`;

function copyExtensionFiles() {
  return {
    name: "copy-extension-files",
    closeBundle() {
      cpSync(`${root}manifest.json`, `${out}/manifest.json`);
      cpSync(`${root}background.js`, `${out}/background.js`);
      cpSync(`${root}icons`, `${out}/icons`, { recursive: true });
      cpSync(`${root}sample`, `${out}/sample`, { recursive: true });
      // Default sheets (client data, git-ignored). Only the .xlsx files the extension reads.
      if (existsSync(`${root}private`)) {
        mkdirSync(`${out}/private`, { recursive: true });
        for (const f of readdirSync(`${root}private`).filter((f) => f.endsWith(".xlsx"))) cpSync(`${root}private/${f}`, `${out}/private/${f}`);
      }
    },
  };
}

export default defineConfig({
  root: `${root}src`,
  base: "./",
  plugins: [react(), copyExtensionFiles()],
  build: {
    outDir: out,
    emptyOutDir: true,
    target: "chrome116",
    chunkSizeWarningLimit: 1500, // one shared React + MUI chunk; it loads from disk, not the network
    rollupOptions: {
      input: {
        sidepanel: `${root}src/sidepanel/index.html`,
        options: `${root}src/options/index.html`,
      },
    },
  },
});
