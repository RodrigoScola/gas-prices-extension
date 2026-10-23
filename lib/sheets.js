// Rate sheet and temporary surcharge sheet, stored in chrome.storage.local.
// Defaults are the copies kept in the extension's private/ folder (git-ignored, so they're only
// there on machines that have them; later they'll come from an API). A file picked on the
// options page overrides a default until "Back to default".
import { readFirstSheet } from "./xlsx.js";
import { parseRateSheet, parseTempSurcharges } from "./rates.js";

export const DEFAULTS = {
  rateSheet: "Siemens FTL Final Bid 2026.xlsx",
  tempSurcharges: "Siemens Accepted Surcharge.xlsx",
};

const PARSE = {
  rateSheet: (rows, fileName) => ({ ...parseRateSheet(rows), fileName, loadedAt: new Date().toISOString() }),
  tempSurcharges: (rows, fileName) => ({ list: parseTempSurcharges(rows), fileName, loadedAt: new Date().toISOString() }),
};

const store = chrome.storage.local;

export async function useDefault(key) {
  let rows = null;
  try {
    const res = await fetch(chrome.runtime.getURL(`private/${encodeURIComponent(DEFAULTS[key])}`));
    if (res.ok) rows = await readFirstSheet(await res.arrayBuffer());
  } catch {}
  const value = rows ? { ...PARSE[key](rows, DEFAULTS[key]), isDefault: true } : null;
  value ? await store.set({ [key]: value }) : await store.remove(key);
  return value;
}

export async function useFile(key, file) {
  const value = { ...PARSE[key](await readFirstSheet(await file.arrayBuffer()), file.name), isDefault: false };
  await store.set({ [key]: value });
  return value;
}

// Both sheets, falling back to the defaults when nothing is saved yet.
export async function loadSheets() {
  const saved = await store.get(["rateSheet", "tempSurcharges"]);
  const out = {};
  for (const key of Object.keys(DEFAULTS)) {
    const x = saved[key];
    // Saved before defaults existed: no isDefault flag.
    if (x && x.isDefault === undefined) {
      x.isDefault = /\(default\)$/.test(x.fileName) || x.fileName === DEFAULTS[key];
      if (x.isDefault) x.fileName = DEFAULTS[key];
    }
    out[key] = x || (await useDefault(key));
  }
  return out;
}
