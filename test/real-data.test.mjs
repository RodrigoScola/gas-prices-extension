// Tests against the real Siemens files in private/ (git-ignored). Skipped on machines without them.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFirstSheet } from "../lib/xlsx.js";
import { parseRateSheet, findLane, parseTempSurcharges, findTempSurcharge } from "../lib/rates.js";
import { fscPerMile } from "../lib/fuel.js";
import { parseEmail } from "../lib/email.js";
import { computeQuote, placeText } from "../lib/quote.js";
import { read, readBuffer, PRIVATE, skipUnless } from "./helpers.mjs";

const skip = skipUnless(PRIVATE.rateSheet, PRIVATE.tempSheet);
const DV = "Dry van/tractor trailer";
const gp = { city: "Grand Prairie", state: "TX" };

describe("Siemens FTL Final Bid 2026", { skip }, async () => {
  const { equipmentTypes, lanes } = skip ? {} : parseRateSheet(await readFirstSheet(readBuffer(PRIVATE.rateSheet)));

  test("3,197 lanes and four equipment types", () => {
    assert.equal(lanes.length, 3197);
    assert.deepEqual(equipmentTypes, [DV, "Flatbed Rate inclusive of 48' & 53'", "Single-drop", "Refrigerated Truck"]);
  });

  test("every lane has states, and every rate is a sane number", () => {
    for (const l of lanes) {
      assert.match(l.originState, /^[A-Z]{2}$/);
      assert.match(l.destState, /^[A-Z]{2}$/);
      for (const r of Object.values(l.rates)) {
        if (r.min != null) assert.ok(r.min > 0 && r.min < 50000, `${l.originCity}->${l.destCity} min ${r.min}`);
        if (r.perMile != null) assert.ok(r.perMile > 0 && r.perMile < 50, `${l.originCity}->${l.destCity} rpm ${r.perMile}`);
      }
    }
  });

  test("known lanes from the sheet", () => {
    assert.deepEqual(findLane(lanes, gp, { city: "Fort Worth", state: "TX" }).lane.rates[DV], { min: 500, perMile: null });
    assert.deepEqual(findLane(lanes, gp, { city: "Itasca", state: "IL" }).lane.rates[DV], { min: null, perMile: 1.43 });
    assert.equal(findLane(lanes, gp, { city: "Pomona", state: "CA" }).lane.rates[DV].perMile, 0.93);
    assert.deepEqual(findLane(lanes, { city: "Louisville", state: "KY" }, { city: "Marion", state: "KY" }).lane.rates[DV], { min: 999, perMile: 4.99 });
    const wy = findLane(lanes, { city: "Any", state: "WY" }, { city: "Other", state: "WY" });
    assert.equal(wy.match, "state to state");
    assert.equal(wy.lane.rates["Flatbed Rate inclusive of 48' & 53'"].perMile, 5.38);
  });

  test("all four kinds of lane exist in the sheet", () => {
    const kinds = new Set(lanes.map((l) => `${l.originCity ? "city" : "state"}-${l.destCity ? "city" : "state"}`));
    assert.deepEqual([...kinds].sort(), ["city-city", "city-state", "state-city", "state-state"]);
  });

  test("every lane finds itself", () => {
    for (const l of lanes.filter((x) => x.originCity && x.destCity)) {
      const hit = findLane(lanes, { city: l.originCity, state: l.originState }, { city: l.destCity, state: l.destState });
      assert.equal(hit.match, "city to city", `${l.originCity}, ${l.originState} -> ${l.destCity}, ${l.destState}`);
    }
  });
});

describe("Siemens Accepted Surcharge", { skip }, async () => {
  const list = skip ? [] : parseTempSurcharges(await readFirstSheet(readBuffer(PRIVATE.tempSheet)));

  test("116 surcharges, all between 0% and 50%", () => {
    assert.equal(list.length, 116);
    for (const s of list) assert.ok(s.pct >= 0 && s.pct <= 0.5, `${s.originCity} ${s.pct}`);
  });

  test("known entries", () => {
    assert.equal(findTempSurcharge(list, gp, { city: "Pomona", state: "CA" }, DV).pct, 0.1);
    assert.equal(findTempSurcharge(list, gp, { city: "Denver", state: "CO" }, DV).pct, 0.25);
    assert.equal(findTempSurcharge(list, gp, { city: "Itasca", state: "IL" }, DV).pct, 0.2);
    assert.equal(findTempSurcharge(list, { city: "Laredo", state: "TX" }, { city: "Any", state: "CA" }, "Single-drop").pct, 0.15);
    assert.equal(findTempSurcharge(list, { city: "Laredo", state: "TX" }, { city: "Any", state: "CA" }, "Flatbed Rate inclusive of 48' & 53'").pct, 0.15);
  });

  test("every surcharge's equipment exists in the rate sheet", async () => {
    const { equipmentTypes } = parseRateSheet(await readFirstSheet(readBuffer(PRIVATE.rateSheet)));
    const keys = new Set(equipmentTypes.map((t) => t.toLowerCase()));
    for (const s of list) assert.ok(keys.has(s.equipment), s.equipment);
  });
});

test("fuel scale formula matches every row of the Siemens PDF", { skip: skipUnless(PRIVATE.fscScale) }, () => {
  const rows = [...read(PRIVATE.fscScale).matchAll(/\$(\d\.\d{3}) \$(\d\.\d{3}) \$(\d\.\d{2})/g)];
  assert.equal(rows.length, 127);
  for (const [, from, to, surcharge] of rows) {
    assert.equal(fscPerMile(Number(from)), Number(surcharge), `from $${from}`);
    assert.equal(fscPerMile(Number(to)), Number(surcharge), `to $${to}`);
  }
  assert.match(read(PRIVATE.fscScale), /\$7\.500 & Above \$1\.28/);
  assert.equal(fscPerMile(7.5), 1.28);
});

describe("both real emails, start to finish", { skip: skipUnless(PRIVATE.rateSheet, PRIVATE.tempSheet, PRIVATE.email1Subject, PRIVATE.email2) }, async () => {
  const rateSheet = skip ? null : parseRateSheet(await readFirstSheet(readBuffer(PRIVATE.rateSheet)));
  const tempSurcharges = skip ? null : { list: parseTempSurcharges(await readFirstSheet(readBuffer(PRIVATE.tempSheet))) };
  const fuel = { price: 6.276, week: "2026-10-19", source: "EIA weekly page" };
  const quoteFor = (path, miles) => {
    const details = parseEmail(read(path), new Date(2026, 9, 23));
    return computeQuote({
      rateSheet, tempSurcharges, details, originText: placeText(details.origin), destText: placeText(details.destination),
      equipment: details.equipment, equipmentFromEmail: true, miles, milesStatus: { fromRoute: true }, diesel: fuel.price, fuel, now: new Date(2026, 9, 23),
    });
  };

  test("MEI, Fort Worth: $570.60", () => {
    const q = quoteFor(PRIVATE.email1Subject, 20);
    assert.equal(q.complete, true);
    assert.deepEqual(q.lines.map(([l, v]) => `${l} ${v}`), [
      "Linehaul (minimum charge) $500.00", "Temporary surcharge 10% $50.00", "Fuel (20 mi × $1.03) $20.60", "Total $570.60",
    ]);
  });

  test("RDI, Itasca: $2,564.76", () => {
    const q = quoteFor(PRIVATE.email2, 934);
    assert.equal(q.complete, true);
    assert.deepEqual(q.lines.map(([l, v]) => `${l} ${v}`), [
      "Linehaul (per mile) $1,335.62", "Temporary surcharge 20% $267.12", "Fuel (934 mi × $1.03) $962.02", "Total $2,564.76",
    ]);
  });

  test("neither email ticks an accessorial (weekday pickups, no keywords)", () => {
    for (const [p, m] of [[PRIVATE.email1Subject, 20], [PRIVATE.email2, 934]]) {
      assert.deepEqual(quoteFor(p, m).accessorials.filter((a) => a.checked).map((a) => a.item.id), [], p);
    }
  });
});
