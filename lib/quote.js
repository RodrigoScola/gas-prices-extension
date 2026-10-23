// The whole quote as a pure function, so it can be tested without the sidebar.
import { findLane, linehaul, findTempSurcharge } from "./rates.js";
import { fscPerMile, isStale } from "./fuel.js";
import { ACCESSORIALS, detectAccessorials, accessorialAmount } from "./accessorials.js";

const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const placeText = (p) => (p ? `${p.city}, ${p.state}` : "");

export { money, placeText };

// "Grand Prairie, TX", "FORT WORTH TX 76111" -> { city, state }
export function parsePlace(s) {
  const m = String(s ?? "").match(/^\s*(.+?),?\s+([A-Za-z]{2})\s*(\d{5})?\s*$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : null;
}

// input:
//   rateSheet, tempSurcharges   loaded sheets (or null)
//   details                     parseEmail() result (or null before an email is read)
//   originText, destText        the Lane fields, "City, ST"
//   equipment, equipmentFromEmail
//   miles, milesStatus          { busy, error, fromRoute }
//   diesel, fuel, fuelError     typed/fetched price, its { price, week, source }, last EIA error
//   overrides                   Map(accessorial id -> checked) the broker set by hand
//   now
// Returns lines (quote rows), total, problems and notes ([where, what] pairs), the lane and
// fuel status lines, and every accessorial with its checked state.
export function computeQuote(input) {
  const {
    rateSheet: rs = null, tempSurcharges = null, details: d = null,
    originText = "", destText = "", equipment = "", equipmentFromEmail = false,
    miles = null, milesStatus = {}, diesel = null, fuel = null, fuelError = null,
    overrides = new Map(), now = new Date(),
  } = input;
  const origin = parsePlace(originText);
  const dest = parsePlace(destText);
  const lines = [];
  const problems = [];
  const notes = [];
  let total = 0;
  let lane = null; // { text, ok }

  if (!d) problems.push(["Email", "no shipping email read yet. Open one in Gmail, or select its text, right-click, and pick “Quote this shipment”."]);
  if (d && !d.origin && !origin) problems.push(["Pickup", "no pickup address found (no sender signature address in the email). Type it in under Lane as City, ST."]);
  else if (originText.trim() && !origin) problems.push(["Pickup", `“${originText}” isn't City, ST.`]);
  if (d && !d.destination && !dest) problems.push(["Delivery", "no delivery address found in the email. Type it in under Lane as City, ST."]);
  else if (destText.trim() && !dest) problems.push(["Delivery", `“${destText}” isn't City, ST.`]);
  if (d && !equipmentFromEmail && equipment) notes.push(["Equipment", `not in the email, so ${equipment} is assumed. Change it under Lane if needed.`]);

  const milesProblem = () => {
    if (milesStatus.busy) return "still working out the route.";
    if (milesStatus.error) return `couldn't work out the route (${milesStatus.error}). Type the miles in under Lane.`;
    return "unknown. Type them in under Lane.";
  };

  // Lane and linehaul
  let lh = null;
  if (!rs) {
    problems.push(["Rate sheet", "none loaded. Pick the Final Bid sheet in Data & settings."]);
  } else if (origin && dest) {
    const hit = findLane(rs.lanes, origin, dest);
    const rate = hit?.lane.rates[equipment];
    if (!hit) {
      problems.push(["Rate sheet", `no lane for ${placeText(origin)} → ${placeText(dest)}, not even a ${origin.state} → ${dest.state} state lane.`]);
    } else if (!rate) {
      const others = Object.keys(hit.lane.rates);
      problems.push(["Rate sheet", `the ${placeText(origin)} → ${placeText(dest)} lane (${hit.match}) has no ${equipment || "equipment"} rate.` +
        (others.length ? ` It has: ${others.join(", ")}.` : " It has no rates at all.")]);
    } else {
      const parts = [rate.perMile != null ? `${money(rate.perMile)}/mile` : null, rate.min != null ? `minimum ${money(rate.min)}` : null].filter(Boolean);
      lane = { text: `Lane matched ${hit.match}: ${parts.join(", ")}.`, ok: true, match: hit.match, rate };
      lh = linehaul(rate, miles);
      if (!lh) problems.push(["Miles", `needed: this lane is priced per mile. Miles are ${milesProblem()}`]);
      else if (rate.perMile != null && !miles) notes.push(["Linehaul", "using the lane minimum until the miles are known."]);
    }
  }

  let tempSurcharge = null;
  if (lh) {
    lines.push([`Linehaul (${lh.basis})`, money(lh.amount)]);
    total += lh.amount;
    if (!tempSurcharges) notes.push(["Temporary surcharge", "no surcharge sheet loaded, so none is added."]);
    tempSurcharge = tempSurcharges ? findTempSurcharge(tempSurcharges.list, origin, dest, equipment) : null;
    if (tempSurcharge?.pct) {
      const amt = lh.amount * tempSurcharge.pct;
      lines.push([`Temporary surcharge ${Math.round(tempSurcharge.pct * 100)}%`, money(amt)]);
      total += amt;
    }
  }

  // Fuel applies on minimum-charge lanes too (confirmed with Aidan, 2026-10-23).
  const price = diesel || fuel?.price || null;
  let fuelLine = null; // { text, stale }
  if (price) {
    const perMile = fscPerMile(price);
    const stale = isStale(fuel, now);
    fuelLine = { perMile, stale, text: `${money(perMile)}/mile surcharge. ` + (fuel ? `Source: ${fuel.source}, week of ${fuel.week}.` : "") };
    if (stale) notes.push(["Fuel", fuel ? `the diesel price is from the week of ${fuel.week}, over a week old.` : "the diesel price has no date."]);
    // No lane, no load to charge fuel on.
    if (miles && lh) {
      lines.push([`Fuel (${miles} mi × ${money(perMile)})`, money(perMile * miles)]);
      total += perMile * miles;
    } else if (lh) problems.push(["Fuel", `needs miles. Miles are ${milesProblem()}`]);
  } else if (fuelError) {
    problems.push(["Fuel", `couldn't get the diesel price from EIA (${fuelError}). Type this week's price in under Fuel surcharge.`]);
  }
  if (miles && milesStatus.fromRoute) notes.push(["Miles", "car-route miles; truck miles can run a few percent longer."]);

  // Accessorials
  const auto = detectAccessorials(d, { miles, equipment, now });
  const accessorials = ACCESSORIALS.map((item) => {
    const found = auto.get(item.id) || null;
    const checked = overrides.has(item.id) ? overrides.get(item.id) : !!found?.checked;
    return { item, found, checked, amount: accessorialAmount(item, { miles, stops: d?.stops }) };
  });
  for (const a of accessorials) {
    if (a.checked) {
      lines.push([a.item.label.replace(/\s*\(.*\)$/, ""), money(a.amount)]);
      total += a.amount;
    } else if (a.found && !overrides.has(a.item.id)) {
      notes.push(["Accessorials", `${a.item.label}: ${a.found.reason}.`]);
    }
  }

  total = Math.round(total * 100) / 100;
  lines.push(["Total", money(total), "total"]);
  return { lines, total, problems, notes, lane, fuel: fuelLine, tempSurcharge, accessorials, complete: problems.length === 0 };
}
