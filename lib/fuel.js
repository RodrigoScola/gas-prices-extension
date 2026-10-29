// Step 3: fuel surcharge.
// The "Siemens FTL Fuel Surcharge Scale 2026" sheet (made from the client's PDF by
// scripts/fuel-scale-pdf-to-xlsx.py): one row per diesel price bracket, Diesel From | Diesel To |
// Surcharge Per Mile, with no "To" on the last ("& Above") row. Based on the DOE/EIA national
// average diesel price, adjusted each Wednesday from the prior Monday's price.

// Some "empty" cells hold a space, which Number() would read as 0.
const toNumber = (v) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  const n = Number(s);
  return s === "" || !Number.isFinite(n) ? null : n;
};

export function parseFuelScale(rows) {
  const headerIdx = rows.findIndex((r) => r.some((c) => /^diesel from$/i.test(String(c).trim())));
  if (headerIdx < 0) throw new Error('Could not find the header row (expected a "Diesel From" column).');
  const header = rows[headerIdx].map((h) => String(h).trim());
  const col = (re) => header.findIndex((h) => re.test(h));
  const cols = { from: col(/^diesel from$/i), to: col(/^diesel to$/i), perMile: col(/^surcharge per mile$/i) };
  for (const [k, v] of Object.entries(cols)) if (v < 0) throw new Error(`Fuel scale is missing the ${k} column.`);
  const brackets = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const from = toNumber(r[cols.from]);
    const perMile = toNumber(r[cols.perMile]);
    if (from == null || perMile == null) continue;
    brackets.push({ from, to: toNumber(r[cols.to]), perMile });
  }
  if (!brackets.length) throw new Error("Fuel scale has no price brackets.");
  return brackets.sort((a, b) => a.from - b.from);
}

// The bracket the diesel price falls in (the last one that starts at or below it; the brackets
// run back to back). Below the first bracket there's no surcharge.
// Compared in tenths of a cent so float error can't push a price into the wrong bracket.
export function fscPerMile(dieselPrice, brackets) {
  if (!Number.isFinite(dieselPrice) || !brackets?.length) return 0;
  const p = Math.round(dieselPrice * 1000);
  const hit = brackets.filter((b) => Math.round(b.from * 1000) <= p).pop();
  return hit ? hit.perMile : 0;
}

// No key needed: EIA's public weekly history page for the same series.
const EIA_PAGE = "https://www.eia.gov/dnav/pet/hist/LeafHandler.ashx?n=PET&s=EMD_EPD2D_PTE_NUS_DPG&f=W";

// The page is a table with one row per month: "2026-Oct", then (Monday "10/05", price "6.199") pairs.
export function parseEiaHistoryPage(html) {
  const out = [];
  const rowRe = /(\d{4})-([A-Z][a-z]{2})\s*<\/td>([\s\S]*?)<\/tr>/g;
  for (const [, year, , cells] of html.matchAll(rowRe)) {
    for (const [, mm, dd, price] of cells.matchAll(/class='B5'>\s*(\d{2})\/(\d{2})&nbsp;<\/td>\s*<td class='B3'>\s*([\d.]+)/g)) {
      out.push({ week: `${year}-${mm}-${dd}`, price: Number(price) });
    }
  }
  return out;
}

// Per the scale: the surcharge changes on Wednesday, using the prior Monday's price.
export function effectivePrice(weeks, today = new Date()) {
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const todayStr = ymd(today);
  const usable = weeks.filter((w) => {
    const [y, m, d] = w.week.split("-").map(Number);
    return ymd(new Date(y, m - 1, d + 2)) <= todayStr;
  });
  return usable.sort((a, b) => a.week.localeCompare(b.week)).pop() || null;
}

export async function fetchDieselPricePublic(fetchImpl = fetch, today = new Date()) {
  const res = await fetchImpl(EIA_PAGE);
  if (!res.ok) throw new Error(`EIA page failed to load (${res.status}).`);
  const hit = effectivePrice(parseEiaHistoryPage(await res.text()), today);
  if (!hit) throw new Error("Couldn't read the diesel price from the EIA page.");
  return { price: hit.price, week: hit.week, source: "EIA weekly page" };
}

export const STALE_AFTER_DAYS = 7;

export function isStale(fuel, now = new Date()) {
  if (!fuel?.week) return true;
  return (now - new Date(fuel.week + "T00:00:00")) / 86400000 > STALE_AFTER_DAYS + 2;
}
