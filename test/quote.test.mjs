import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeQuote, parsePlace, money } from "../lib/quote.js";
import { parseRateSheet, parseTempSurcharges } from "../lib/rates.js";
import { parseEmail } from "../lib/email.js";
import { read } from "./helpers.mjs";

const NOW = new Date(2026, 9, 23);
const DV = "Dry van/tractor trailer";
const rateSheet = parseRateSheet([
  ["Origin City", "Origin State", "Destination City", "Destination State",
    "Min Charge - Dry van/tractor trailer", "Unit Rate - Dry van/tractor trailer", "Min Charge - Single-drop", "Unit Rate - Single-drop"],
  ["Grand Prairie", "TX", "Fort Worth", "TX", "500", "", "600", ""],
  ["Grand Prairie", "TX", "Itasca", "IL", "", "1.43", "", ""],
  ["Grand Prairie", "TX", "Pomona", "CA", "300", "0.93", "", ""],
  ["Dallas", "TX", "Waco", "TX", "", "", "", ""],
]);
const tempSurcharges = { list: parseTempSurcharges([["Lane", "Eq", "Pct"], ["Grand Prairie,TX-IL", "Dry van/tractor trailer inclusive of air ride", "0.2"], ["Grand Prairie,TX-TX", "Dry van/tractor trailer inclusive of air ride", "0.1"]]) };
const fuel = { price: 6.276, week: "2026-10-19", source: "EIA weekly page" };
const email = parseEmail(read("../sample/email-sample.txt"), NOW); // Grand Prairie -> Fort Worth, van

const base = (over = {}) => ({
  rateSheet, tempSurcharges, details: email, originText: "Grand Prairie, TX", destText: "Fort Worth, TX",
  equipment: DV, equipmentFromEmail: true, miles: 20, milesStatus: { fromRoute: true }, diesel: 6.276, fuel, now: NOW, ...over,
});
const line = (q, label) => q.lines.find(([l]) => l.startsWith(label))?.[1];
const where = (list) => list.map(([w]) => w);

describe("complete quotes", () => {
  test("minimum-charge lane: minimum + temporary surcharge + fuel", () => {
    const q = computeQuote(base());
    assert.equal(q.complete, true);
    assert.deepEqual(q.lines, [
      ["Linehaul (minimum charge)", "$500.00"],
      ["Temporary surcharge 10%", "$50.00"],
      ["Fuel (20 mi × $1.03)", "$20.60"],
      ["Total", "$570.60", "total"],
    ]);
    assert.equal(q.total, 570.6);
    assert.equal(q.lane.match, "city to city");
    assert.equal(q.lane.text, "Lane matched city to city: minimum $500.00.");
  });

  test("per-mile lane: Itasca, 934 miles", () => {
    const q = computeQuote(base({ destText: "Itasca, IL", miles: 934 }));
    assert.equal(q.complete, true);
    assert.equal(line(q, "Linehaul"), "$1,335.62");
    assert.equal(line(q, "Temporary surcharge 20%"), "$267.12");
    assert.equal(line(q, "Fuel"), "$962.02");
    assert.equal(q.total, 2564.76);
  });

  test("per mile beats a lower minimum", () => {
    const q = computeQuote(base({ destText: "Pomona, CA", miles: 1420 }));
    assert.equal(q.lines[0][0], "Linehaul (per mile)");
    assert.equal(line(q, "Linehaul"), money(0.93 * 1420));
  });

  test("the minimum beats per mile on a short run", () => {
    const q = computeQuote(base({ destText: "Pomona, CA", miles: 100 }));
    assert.deepEqual(q.lines[0], ["Linehaul (minimum charge)", "$300.00"]);
  });

  test("the lane fields can be typed differently from the email", () => {
    const q = computeQuote(base({ originText: "GRAND PRAIRIE TX 75050", destText: "fort worth, tx" }));
    assert.equal(q.complete, true);
    assert.equal(q.total, 570.6);
  });

  test("a different equipment column on the same lane", () => {
    const q = computeQuote(base({ equipment: "Single-drop" }));
    assert.equal(line(q, "Linehaul"), "$600.00");
    assert.equal(line(q, "Temporary surcharge"), undefined, "no single-drop surcharge for this lane");
  });
});

describe("incomplete quotes say what's missing", () => {
  test("no email yet", () => {
    const q = computeQuote(base({ details: null, originText: "", destText: "" }));
    assert.equal(q.complete, false);
    assert.deepEqual(where(q.problems), ["Email"]);
    assert.match(q.problems[0][1], /Open one in Gmail/);
    assert.equal(q.total, 0);
  });

  test("email with no pickup or delivery found", () => {
    const q = computeQuote(base({ details: parseEmail("hello", NOW), originText: "", destText: "" }));
    assert.deepEqual(where(q.problems), ["Pickup", "Delivery"]);
    assert.match(q.problems[0][1], /Type it in under Lane/);
  });

  test("a lane field that isn't City, ST", () => {
    const q = computeQuote(base({ destText: "Fort Worth" }));
    assert.deepEqual(where(q.problems), ["Delivery"]);
    assert.match(q.problems[0][1], /“Fort Worth” isn't City, ST/);
    const p = computeQuote(base({ originText: "somewhere" }));
    assert.deepEqual(where(p.problems), ["Pickup"]);
  });

  test("no rate sheet", () => {
    const q = computeQuote(base({ rateSheet: null }));
    assert.deepEqual(where(q.problems), ["Rate sheet"]);
    assert.match(q.problems[0][1], /Data & settings/);
  });

  test("no lane, even at state level", () => {
    const q = computeQuote(base({ destText: "Miami, FL" }));
    assert.deepEqual(where(q.problems), ["Rate sheet"]);
    assert.match(q.problems[0][1], /no lane for Grand Prairie, TX → Miami, FL, not even a TX → FL state lane/);
  });

  test("lane exists but not for this equipment: lists what it has", () => {
    const q = computeQuote(base({ equipment: "Refrigerated Truck" }));
    assert.match(q.problems[0][1], /has no Refrigerated Truck rate\. It has: Dry van\/tractor trailer, Single-drop\./);
    const empty = computeQuote(base({ originText: "Dallas, TX", destText: "Waco, TX" }));
    assert.match(empty.problems[0][1], /It has no rates at all/);
  });

  test("per-mile lane without miles: says why miles are missing", () => {
    const busy = computeQuote(base({ destText: "Itasca, IL", miles: null, milesStatus: { busy: true } }));
    assert.deepEqual(where(busy.problems), ["Miles"]);
    assert.match(busy.problems[0][1], /still working out the route/);
    const failed = computeQuote(base({ destText: "Itasca, IL", miles: null, milesStatus: { error: "Routing service didn't return a route." } }));
    assert.match(failed.problems[0][1], /couldn't work out the route \(Routing service didn't return a route\.\)\. Type the miles in/);
    const unknown = computeQuote(base({ destText: "Itasca, IL", miles: null, milesStatus: {} }));
    assert.match(unknown.problems[0][1], /unknown\. Type them in/);
  });

  test("minimum lane without miles: linehaul is fine, fuel needs miles", () => {
    const q = computeQuote(base({ miles: null, milesStatus: {} }));
    assert.deepEqual(where(q.problems), ["Fuel"]);
    assert.equal(line(q, "Linehaul"), "$500.00");
    assert.equal(q.total, 550);
  });

  test("a per-mile lane with a minimum shows the minimum until miles arrive", () => {
    const q = computeQuote(base({ destText: "Pomona, CA", miles: null, milesStatus: { busy: true } }));
    assert.equal(line(q, "Linehaul"), "$300.00");
    assert.ok(q.notes.some(([w, t]) => w === "Linehaul" && /minimum until the miles/.test(t)));
  });

  test("diesel price failed to load", () => {
    const q = computeQuote(base({ diesel: null, fuel: null, fuelError: "EIA page failed to load (503)." }));
    assert.deepEqual(where(q.problems), ["Fuel"]);
    assert.match(q.problems[0][1], /\(EIA page failed to load \(503\)\.\)\. Type this week's price/);
  });

  test("diesel still loading isn't a problem yet", () => {
    const q = computeQuote(base({ diesel: null, fuel: null, fuelError: null }));
    assert.deepEqual(q.problems, []);
    assert.equal(q.fuel, null);
  });

  test("several problems at once, in order", () => {
    const q = computeQuote(base({ details: parseEmail("hello", NOW), originText: "", destText: "", rateSheet: null, diesel: null, fuel: null, fuelError: "down" }));
    assert.deepEqual(where(q.problems), ["Pickup", "Delivery", "Rate sheet", "Fuel"]);
  });
});

describe("notes", () => {
  test("assumed equipment", () => {
    const q = computeQuote(base({ equipmentFromEmail: false }));
    assert.ok(q.notes.some(([w, t]) => w === "Equipment" && t.includes(DV)));
  });

  test("no surcharge sheet", () => {
    const q = computeQuote(base({ tempSurcharges: null }));
    assert.ok(q.notes.some(([w]) => w === "Temporary surcharge"));
    assert.equal(q.total, 520.6);
  });

  test("stale diesel price", () => {
    const q = computeQuote(base({ fuel: { ...fuel, week: "2026-09-28" } }));
    assert.equal(q.fuel.stale, true);
    assert.ok(q.notes.some(([w, t]) => w === "Fuel" && t.includes("2026-09-28")));
  });

  test("car miles warning only when miles came from the route", () => {
    assert.ok(computeQuote(base()).notes.some(([w]) => w === "Miles"));
    assert.ok(!computeQuote(base({ milesStatus: {} })).notes.some(([w]) => w === "Miles"));
  });

  test("a typed diesel price overrides the fetched one", () => {
    const q = computeQuote(base({ diesel: 3.05 }));
    assert.equal(q.fuel.perMile, 0.39);
    assert.equal(line(q, "Fuel"), "$7.80");
  });
});

describe("accessorials in the quote", () => {
  const weekend = parseEmail("Pickup: Grand Prairie, TX 75050\nPickup date: 10/31/2026 7:00 PM\nDeliver to: Fort Worth, TX 76111\nhazmat", NOW);

  test("detected ones are added with their price", () => {
    const q = computeQuote(base({ details: weekend }));
    assert.equal(line(q, "Weekend pickup"), "$200.00");
    assert.equal(line(q, "After-hours pickup"), "$250.00");
    assert.equal(line(q, "Hazmat"), "$50.00");
    assert.equal(q.total, 570.6 + 500);
    const row = q.accessorials.find((a) => a.item.id === "weekendPickup");
    assert.equal(row.checked, true);
    assert.match(row.found.reason, /Saturday/);
  });

  test("the broker can untick a detected one and tick an undetected one", () => {
    const overrides = new Map([["weekendPickup", false], ["dropTrailer", true]]);
    const q = computeQuote(base({ details: weekend, overrides }));
    assert.equal(line(q, "Weekend pickup"), undefined);
    assert.equal(line(q, "Drop trailer"), "$200.00");
    assert.equal(q.total, 570.6 + 250 + 50 + 200);
  });

  test("hints show as notes until the broker decides", () => {
    const hint = parseEmail("Pickup: Grand Prairie, TX\nPickup date: 10/15/2026\nDeliver to: Itasca, IL", NOW);
    const q = computeQuote(base({ details: hint, destText: "Itasca, IL", miles: 934 }));
    assert.ok(q.notes.some(([w, t]) => w === "Accessorials" && /Weekend delivery: estimated delivery/.test(t)));
    const decided = computeQuote(base({ details: hint, destText: "Itasca, IL", miles: 934, overrides: new Map([["weekendDelivery", false]]) }));
    assert.ok(!decided.notes.some(([w]) => w === "Accessorials"));
  });

  test("every accessorial is listed, with its amount for this load", () => {
    const q = computeQuote(base({ miles: 1420 }));
    assert.equal(q.accessorials.length, 15);
    assert.equal(q.accessorials.find((a) => a.item.id === "team").amount, 142);
  });
});

describe("parsePlace and money", () => {
  test("parsePlace", () => {
    assert.deepEqual(parsePlace("Grand Prairie, TX"), { city: "Grand Prairie", state: "TX" });
    assert.deepEqual(parsePlace("FORT WORTH TX 76111"), { city: "FORT WORTH", state: "TX" });
    assert.deepEqual(parsePlace("  itasca il "), { city: "itasca", state: "IL" });
    for (const bad of ["", "Fort Worth", "TX", null, undefined]) assert.equal(parsePlace(bad), null, String(bad));
  });
  test("money", () => {
    assert.equal(money(0), "$0.00");
    assert.equal(money(1335.62), "$1,335.62");
    assert.equal(money(0.005), "$0.01");
    assert.equal(money(1234567.891), "$1,234,567.89");
  });
  test("totals are rounded to the cent", () => {
    const q = computeQuote(base({ destText: "Itasca, IL", miles: 933 }));
    assert.equal(q.total, Math.round(q.total * 100) / 100);
  });
});
