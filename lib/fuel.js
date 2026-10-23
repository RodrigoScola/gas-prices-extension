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

const EIA_URL = "https://api.eia.gov/v2/petroleum/pri/gnd/data/";
const US_DIESEL_SERIES = "EMD_EPD2D_PTE_NUS_DPG"; // U.S. No 2 diesel retail, weekly

// Latest weekly U.S. average diesel price from EIA. Needs a free EIA API key.
export async function fetchDieselPrice(apiKey, fetchImpl = fetch) {
  const params = new URLSearchParams({
    api_key: apiKey,
    frequency: "weekly",
    "data[0]": "value",
    "facets[series][]": US_DIESEL_SERIES,
    "sort[0][column]": "period",
    "sort[0][direction]": "desc",
    length: "1",
  });
  const res = await fetchImpl(`${EIA_URL}?${params}`);
  if (!res.ok) throw new Error(`EIA request failed (${res.status}). Check the API key.`);
  const row = (await res.json())?.response?.data?.[0];
  if (!row) throw new Error("EIA returned no diesel price.");
  return { price: Number(row.value), week: row.period, source: "EIA" };
}

export const STALE_AFTER_DAYS = 7;

export function isStale(fuel, now = new Date()) {
  if (!fuel?.week) return true;
  return (now - new Date(fuel.week + "T00:00:00")) / 86400000 > STALE_AFTER_DAYS + 2;
}
