// Step 3: fuel surcharge.
// "Siemens FTL Fuel Surcharge Scale 2026": $0.01/mile at $1.150-$1.199 diesel, +$0.01 for every
// $0.05 after that, capped at $1.28/mile from $7.500 up. Based on the DOE/EIA national average
// diesel price, adjusted each Wednesday from the prior Monday's price.

export function fscPerMile(dieselPrice) {
  if (!Number.isFinite(dieselPrice) || dieselPrice < 1.15) return 0;
  // Work in tenths of a cent so float error can't push a price into the wrong bracket.
  const steps = Math.floor((Math.round(dieselPrice * 1000) - 1100) / 50);
  return Math.min(steps, 128) / 100;
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
