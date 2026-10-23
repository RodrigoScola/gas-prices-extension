// Step 2: rate sheet lookups.
// Built for the "Siemens FTL Final Bid 2026" layout: one row per lane, with a
// "Min Charge - <equipment>" and "Unit Rate - <equipment>" column pair per equipment type.
// Some lanes are city-to-city, others only name a state on one or both ends.

export const normCity = (s) => String(s || "").toLowerCase().replace(/\bst\.?\s/g, "saint ").replace(/[^a-z]/g, "");
export const normState = (s) => String(s || "").trim().toUpperCase();

// "Dry van/tractor trailer inclusive of air ride" and "Flatbed Rate inclusive of 48' & 53' and air ride"
// should match the rate sheet's "Dry van/tractor trailer" and "Flatbed Rate inclusive of 48' & 53'".
export function equipmentKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\(inclusive of air ride\)/g, "")
    .replace(/\s+(inclusive of|and)\s+air ride/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(/[$,\s]/g, ""));
  return v === "" || v == null || !Number.isFinite(n) ? null : n;
};

export function parseRateSheet(rows) {
  const headerIdx = rows.findIndex((r) => r.some((c) => /^origin city$/i.test(String(c).trim())));
  if (headerIdx < 0) throw new Error('Could not find the header row (expected an "Origin City" column).');
  const header = rows[headerIdx].map((h) => String(h).trim());
  const col = (re) => header.findIndex((h) => re.test(h));
  const cols = {
    originCity: col(/^origin city$/i),
    originState: col(/^origin state$/i),
    destCity: col(/^destination city$/i),
    destState: col(/^dest\w* state$/i), // the sheet spells it "Destation State"
  };
  for (const [k, v] of Object.entries(cols)) if (v < 0) throw new Error(`Rate sheet is missing the ${k} column.`);

  const equipment = {};
  header.forEach((h, i) => {
    const m = h.match(/^(Min Charge|Unit Rate)\s*-\s*(.+)$/i);
    if (!m) return;
    const name = m[2].replace(/\s*\(inclusive of air ride\)\s*$/i, "").trim();
    equipment[name] ||= {};
    equipment[name][/min/i.test(m[1]) ? "min" : "perMile"] = i;
  });
  if (!Object.keys(equipment).length) throw new Error("Rate sheet has no Min Charge / Unit Rate columns.");

  const lanes = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const originState = normState(r[cols.originState]);
    const destState = normState(r[cols.destState]);
    if (!originState || !destState) continue;
    const rates = {};
    for (const [name, c] of Object.entries(equipment)) {
      const min = toNumber(r[c.min]);
      const perMile = toNumber(r[c.perMile]);
      if (min != null || perMile != null) rates[name] = { min, perMile };
    }
    lanes.push({
      originCity: String(r[cols.originCity] || "").trim(),
      originState,
      destCity: String(r[cols.destCity] || "").trim(),
      destState,
      rates,
    });
  }
  return { equipmentTypes: Object.keys(equipment), lanes };
}

// Most specific lane wins: city-city, city-state, state-city, then state-state.
export function findLane(lanes, origin, dest) {
  const oc = normCity(origin.city), os = normState(origin.state);
  const dc = normCity(dest.city), ds = normState(dest.state);
  const tiers = [
    (l) => normCity(l.originCity) === oc && normCity(l.destCity) === dc,
    (l) => normCity(l.originCity) === oc && !l.destCity,
    (l) => !l.originCity && normCity(l.destCity) === dc,
    (l) => !l.originCity && !l.destCity,
  ];
  for (const [i, test] of tiers.entries()) {
    const lane = lanes.find((l) => l.originState === os && l.destState === ds && test(l));
    if (lane) return { lane, match: ["city to city", "city to state", "state to city", "state to state"][i] };
  }
  return null;
}

// Pick the rate-sheet equipment column that matches what the email asked for.
export function matchEquipment(equipmentTypes, wanted) {
  if (!wanted) return null;
  const w = equipmentKey(wanted);
  return equipmentTypes.find((t) => equipmentKey(t) === w) ||
    equipmentTypes.find((t) => equipmentKey(t).includes(w) || w.includes(equipmentKey(t))) || null;
}

// Linehaul is miles x rate, but never below the lane minimum. Some lanes only have a minimum.
export function linehaul(rate, miles) {
  if (!rate) return null;
  const byMiles = rate.perMile != null && miles ? rate.perMile * miles : null;
  if (byMiles == null && rate.min == null) return null;
  if (byMiles == null) return { amount: rate.min, basis: "minimum charge" };
  if (rate.min != null && rate.min > byMiles) return { amount: rate.min, basis: "minimum charge" };
  return { amount: byMiles, basis: "per mile" };
}

// "Siemens Accepted Surcharge" sheet: Lane | Equipment Type | percentage added to linehaul.
// Lane is either "All Laredo, TX outbound lanes" or "Grand Prairie,TX-Pomona,CA".
export function parseTempSurcharges(rows) {
  const out = [];
  for (const [lane, equipment, pct] of rows) {
    const value = toNumber(pct);
    if (value == null || !lane) continue;
    const all = String(lane).match(/^All\s+(.+?),\s*([A-Z]{2})\s+outbound/i);
    if (all) {
      out.push({ originCity: all[1], originState: normState(all[2]), destCity: null, destState: null, equipment: equipmentKey(equipment), pct: value });
      continue;
    }
    // "Grand Prairie,TX-Pomona,CA" or "Grand Prairie,TX-CO"
    const pair = String(lane).match(/^(.+?),\s*([A-Z]{2})\s*-\s*(?:(.+?),\s*)?([A-Z]{2})$/i);
    if (pair) out.push({ originCity: pair[1], originState: normState(pair[2]), destCity: pair[3] || null, destState: normState(pair[4]), equipment: equipmentKey(equipment), pct: value });
  }
  return out;
}

// Most specific entry wins: city to city, then city to state, then "all outbound lanes".
export function findTempSurcharge(list, origin, dest, equipment) {
  const eq = equipmentKey(equipment);
  const same = (a, b) => normCity(a) === normCity(b);
  const ds = normState(dest.state);
  const hits = list.filter((s) => s.equipment === eq && same(s.originCity, origin.city) && s.originState === normState(origin.state));
  return hits.find((s) => s.destCity && same(s.destCity, dest.city) && s.destState === ds) ||
    hits.find((s) => !s.destCity && s.destState === ds) ||
    hits.find((s) => !s.destState) || null;
}
