import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fakeChrome, makeXlsx } from "./helpers.mjs";

const RATE_ROWS = [
  ["Origin City", "Origin State", "Destination City", "Destation State", "Min Charge - Dry van/tractor trailer (inclusive of air ride)", "Unit Rate - Dry van/tractor trailer (inclusive of air ride)"],
  ["Grand Prairie", "TX", "Fort Worth", "TX", 500, null],
  ["Grand Prairie", "TX", "Itasca", "IL", null, 1.43],
];
const TEMP_ROWS = [["Lane", "Equipment Type", "Pct"], ["Grand Prairie,TX-IL", "Dry van/tractor trailer inclusive of air ride", 0.2]];
const DEFAULT_FILES = {
  "private/Siemens FTL Final Bid 2026.xlsx": makeXlsx(RATE_ROWS),
  "private/Siemens Accepted Surcharge.xlsx": makeXlsx(TEMP_ROWS),
};

// lib/sheets.js reads chrome.storage.local when it loads, so each test installs its own fake
// chrome and imports a fresh copy of the module.
let n = 0;
async function load(files = DEFAULT_FILES) {
  const fake = fakeChrome({ files });
  globalThis.chrome = fake.chrome;
  globalThis.fetch = fake.fetch;
  const mod = await import(`../lib/sheets.js?case=${n++}`);
  return { ...mod, data: fake.chrome._data };
}
const xlsxFile = (rows, name) => ({ name, arrayBuffer: async () => { const b = makeXlsx(rows); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } });

beforeEach(() => { delete globalThis.chrome; });

test("first run: both defaults load from private/ and are saved", async () => {
  const { loadSheets, data } = await load();
  const s = await loadSheets();
  assert.equal(s.rateSheet.isDefault, true);
  assert.equal(s.rateSheet.fileName, "Siemens FTL Final Bid 2026.xlsx");
  assert.equal(s.rateSheet.lanes.length, 2);
  assert.deepEqual(s.rateSheet.equipmentTypes, ["Dry van/tractor trailer"]);
  assert.equal(s.tempSurcharges.isDefault, true);
  assert.equal(s.tempSurcharges.list[0].pct, 0.2);
  assert.equal(data.rateSheet.lanes.length, 2, "saved to storage");
  assert.equal(data.tempSurcharges.list.length, 1);
});

test("no default files (a machine without private/): nothing loaded, nothing saved", async () => {
  const { loadSheets, data } = await load({});
  const s = await loadSheets();
  assert.equal(s.rateSheet, null);
  assert.equal(s.tempSurcharges, null);
  assert.deepEqual(Object.keys(data), []);
});

test("a broken default file counts as missing", async () => {
  const { loadSheets } = await load({ "private/Siemens FTL Final Bid 2026.xlsx": new TextEncoder().encode("not a zip") });
  assert.equal((await loadSheets()).rateSheet, null);
});

test("your own file overrides the default and survives a reload", async () => {
  const { loadSheets, useFile, data } = await load();
  await loadSheets();
  const mine = await useFile("rateSheet", xlsxFile([...RATE_ROWS, ["Dallas", "TX", "Waco", "TX", 300, 2]], "my rates.xlsx"));
  assert.equal(mine.isDefault, false);
  assert.equal(mine.fileName, "my rates.xlsx");
  assert.equal(mine.lanes.length, 3);
  assert.ok(mine.loadedAt);
  const again = await loadSheets();
  assert.equal(again.rateSheet.fileName, "my rates.xlsx");
  assert.equal(data.rateSheet.isDefault, false);
});

test("a bad override file throws and leaves the saved sheet alone", async () => {
  const { loadSheets, useFile, data } = await load();
  await loadSheets();
  await assert.rejects(useFile("rateSheet", xlsxFile([["nothing", "useful"]], "bad.xlsx")), /Origin City/);
  assert.equal(data.rateSheet.isDefault, true);
});

test("Back to default replaces the override", async () => {
  const { loadSheets, useFile, useDefault } = await load();
  await loadSheets();
  await useFile("tempSurcharges", xlsxFile([["Lane", "Equipment", "Pct"], ["All Laredo, TX outbound lanes", "Single-drop", 0.15]], "mine.xlsx"));
  const back = await useDefault("tempSurcharges");
  assert.equal(back.isDefault, true);
  assert.equal(back.list[0].pct, 0.2);
  assert.equal((await loadSheets()).tempSurcharges.isDefault, true);
});

test("Back to default with the default file gone clears the setting", async () => {
  const { useDefault, data } = await load({});
  data.rateSheet = { fileName: "x", lanes: [], isDefault: false };
  assert.equal(await useDefault("rateSheet"), null);
  assert.equal("rateSheet" in data, false);
});

test("sheets saved by older versions get the isDefault flag", async () => {
  const { loadSheets, data } = await load();
  data.rateSheet = { fileName: "Siemens FTL Final Bid 2026.xlsx (default)", lanes: [], equipmentTypes: [] };
  data.tempSurcharges = { fileName: "client upload.xlsx", list: [] };
  const s = await loadSheets();
  assert.equal(s.rateSheet.isDefault, true);
  assert.equal(s.rateSheet.fileName, "Siemens FTL Final Bid 2026.xlsx");
  assert.equal(s.tempSurcharges.isDefault, false);
});
