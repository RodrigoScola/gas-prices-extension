import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { ACCESSORIALS, isHoliday, detectAccessorials, estimateDelivery, accessorialAmount } from "../lib/accessorials.js";
import { parseEmail } from "../lib/email.js";

const ticked = (m) => [...m].filter(([, v]) => v.checked).map(([k]) => k).sort();
const hinted = (m) => [...m].filter(([, v]) => !v.checked).map(([k]) => k).sort();
const day = (y, m, d) => new Date(y, m - 1, d);
const FLATBED = "Flatbed Rate inclusive of 48' & 53'";

describe("the schedule", () => {
  test("matches the FY 2025 Siemens FTL accessorial schedule prices", () => {
    const price = Object.fromEntries(ACCESSORIALS.map((a) => [a.id, a.amount]));
    assert.deepEqual(price, {
      sameDay: 100, weekendPickup: 200, holidayPickup: 350, afterHoursPickup: 250,
      weekendDelivery: 200, holidayDelivery: 350, afterHoursDelivery: 250,
      tarp: 100, tarpDoubleDrop: 150, overDim: 200, overDimDoubleDrop: 250,
      stopOff: 75, hazmat: 50, team: 100, dropTrailer: 200,
    });
  });
  test("every item says how it's detected, and ids are unique", () => {
    for (const a of ACCESSORIALS) assert.ok(a.how && a.label, a.id);
    assert.equal(new Set(ACCESSORIALS.map((a) => a.id)).size, ACCESSORIALS.length);
  });
});

describe("holidays", () => {
  test("the six listed holidays, 2026 and 2027", () => {
    for (const d of [day(2026, 1, 1), day(2026, 5, 25), day(2026, 7, 4), day(2026, 9, 7), day(2026, 11, 26), day(2026, 12, 25),
      day(2027, 1, 1), day(2027, 5, 31), day(2027, 7, 4), day(2027, 9, 6), day(2027, 11, 25), day(2027, 12, 25)]) {
      assert.equal(isHoliday(d), true, d.toDateString());
    }
  });
  test("days next to them, and holidays the schedule leaves out", () => {
    for (const d of [day(2026, 5, 18), day(2026, 7, 3), day(2026, 11, 27), day(2026, 12, 24), day(2026, 1, 19) /* MLK */, day(2026, 11, 11) /* Veterans */, day(2026, 10, 12) /* Columbus */, day(2026, 2, 16) /* Presidents */]) {
      assert.equal(isHoliday(d), false, d.toDateString());
    }
  });
});

describe("dates and times", () => {
  test("weekend pickup and delivery", () => {
    const m = detectAccessorials({ pickup: { date: day(2026, 10, 31) }, delivery: { date: day(2026, 11, 1) } });
    assert.deepEqual(ticked(m), ["weekendDelivery", "weekendPickup"]);
    assert.match(m.get("weekendPickup").reason, /Saturday/);
    assert.deepEqual(ticked(detectAccessorials({ pickup: { date: day(2026, 10, 30) }, delivery: { date: day(2026, 11, 2) } })), []);
  });

  test("holiday on a weekend ticks both", () => {
    assert.deepEqual(ticked(detectAccessorials({ pickup: { date: day(2027, 12, 25) } })), ["holidayPickup", "weekendPickup"]);
  });

  test("after hours: before 6:00am or after 6:00pm", () => {
    const at = (minutes) => detectAccessorials({ pickup: { minutes }, delivery: { minutes } });
    assert.deepEqual(ticked(at(5 * 60 + 59)), ["afterHoursDelivery", "afterHoursPickup"]);
    assert.deepEqual(ticked(at(6 * 60)), []);
    assert.deepEqual(ticked(at(18 * 60)), []);
    assert.deepEqual(ticked(at(18 * 60 + 1)), ["afterHoursDelivery", "afterHoursPickup"]);
    assert.deepEqual(ticked(at(0)), ["afterHoursDelivery", "afterHoursPickup"]);
  });

  test("same-day pickup needs READY NOW and a pickup of today (or no date)", () => {
    const now = new Date(2026, 9, 14, 9);
    assert.equal(detectAccessorials({ readyNow: true }, { now }).get("sameDay").checked, true);
    assert.equal(detectAccessorials({ readyNow: true, pickup: { date: day(2026, 10, 14) } }, { now }).get("sameDay").checked, true);
    assert.equal(detectAccessorials({ readyNow: true, pickup: { date: day(2026, 10, 15) } }, { now }).has("sameDay"), false);
    assert.equal(detectAccessorials({ readyNow: false }, { now }).has("sameDay"), false);
  });
});

describe("estimated delivery", () => {
  test("transit estimate", () => {
    const p = day(2026, 10, 14);
    assert.equal(estimateDelivery(p, 20).toDateString(), p.toDateString(), "local: same day");
    assert.equal(estimateDelivery(p, 249).getDate(), 14);
    assert.equal(estimateDelivery(p, 250).getDate(), 15);
    assert.equal(estimateDelivery(p, 500).getDate(), 15);
    assert.equal(estimateDelivery(p, 934).getDate(), 16);
    assert.equal(estimateDelivery(p, 2600).getDate(), 20);
    assert.equal(estimateDelivery(day(2026, 12, 30), 1000).toDateString(), day(2027, 1, 1).toDateString(), "rolls into the new year");
    assert.equal(estimateDelivery(null, 500), null);
    assert.equal(estimateDelivery(p, null), null);
  });

  test("an estimated weekend or holiday delivery is a hint, never a tick", () => {
    const sat = detectAccessorials({ pickup: { date: day(2026, 10, 15) } }, { miles: 934 });
    assert.deepEqual(ticked(sat), []);
    assert.deepEqual(hinted(sat), ["weekendDelivery"]);
    assert.match(sat.get("weekendDelivery").reason, /estimated delivery .*check/);
    const xmas = detectAccessorials({ pickup: { date: day(2026, 12, 24) } }, { miles: 400 });
    assert.deepEqual(hinted(xmas), ["holidayDelivery"]);
  });

  test("a real delivery date beats the estimate", () => {
    const m = detectAccessorials({ pickup: { date: day(2026, 10, 15) }, delivery: { date: day(2026, 10, 19) } }, { miles: 934 });
    assert.equal(m.size, 0);
  });
});

describe("words in the email, checked against the equipment", () => {
  const kw = parseEmail("Needs tarps, oversize, team service required, drop trailer at shipper, hazmat class 3. Dallas, TX to Atlanta, GA");

  test("open deck: tarp and over dimensional", () => {
    assert.deepEqual(ticked(detectAccessorials(kw, { equipment: FLATBED })), ["dropTrailer", "hazmat", "overDim", "tarp", "team"]);
    assert.deepEqual(ticked(detectAccessorials(kw, { equipment: "Single-drop" })), ["dropTrailer", "hazmat", "overDim", "tarp", "team"]);
    assert.deepEqual(ticked(detectAccessorials(kw, { equipment: "Low Profile Step Deck" })), ["dropTrailer", "hazmat", "overDim", "tarp", "team"]);
  });

  test("double-drop gets the double-drop versions", () => {
    assert.deepEqual(ticked(detectAccessorials(kw, { equipment: "Double-drop" })), ["dropTrailer", "hazmat", "overDimDoubleDrop", "tarpDoubleDrop", "team"]);
  });

  test("tarp on a van is only a hint", () => {
    const m = detectAccessorials(kw, { equipment: "Dry van/tractor trailer" });
    assert.deepEqual(hinted(m), ["tarp"]);
    assert.ok(!ticked(m).includes("tarp"));
  });

  test("each reason says why", () => {
    const m = detectAccessorials(kw, { equipment: FLATBED });
    for (const [, v] of m) assert.ok(v.reason.length > 5);
  });

  test("a plain email ticks nothing", () => {
    assert.equal(detectAccessorials(parseEmail("Van load Dallas, TX to Atlanta, GA, 10 pallets 20,000 lbs"), { equipment: "Dry van/tractor trailer" }).size, 0);
    assert.equal(detectAccessorials(null).size, 0);
    assert.equal(detectAccessorials({}).size, 0);
  });
});

describe("stop-offs and amounts", () => {
  test("stop-offs from extra delivery addresses", () => {
    const m = detectAccessorials({ stops: 2 });
    assert.match(m.get("stopOff").reason, /2 extra delivery addresses/);
    assert.match(detectAccessorials({ stops: 1 }).get("stopOff").reason, /1 extra delivery address in/);
  });

  test("amounts: per stop, team per mile over 1,000 miles, flat otherwise", () => {
    const get = (id) => ACCESSORIALS.find((a) => a.id === id);
    assert.equal(accessorialAmount(get("stopOff"), { stops: 3 }), 225);
    assert.equal(accessorialAmount(get("stopOff"), { stops: 0 }), 75, "ticked by hand with no extra stops counts one");
    assert.equal(accessorialAmount(get("stopOff"), {}), 75);
    assert.equal(accessorialAmount(get("team"), { miles: 1000 }), 100);
    assert.equal(accessorialAmount(get("team"), { miles: 1001 }), 100.10000000000001);
    assert.equal(accessorialAmount(get("team"), { miles: 1420 }), 142);
    assert.equal(accessorialAmount(get("team"), { miles: null }), 100);
    assert.equal(accessorialAmount(get("hazmat"), { miles: 5000 }), 50);
  });
});
