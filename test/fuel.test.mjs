import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { fscPerMile, parseFuelScale, parseEiaHistoryPage, effectivePrice, fetchDieselPricePublic, isStale, STALE_AFTER_DAYS } from "../lib/fuel.js";
import { read, textResponse, SCALE_ROWS, fuelScale } from "./helpers.mjs";

describe("fuel surcharge scale sheet", () => {
  test("reads every bracket, the open-ended top row included", () => {
    const b = parseFuelScale(SCALE_ROWS);
    assert.equal(b.length, 128);
    assert.deepEqual(b[0], { from: 1.15, to: 1.199, perMile: 0.01 });
    assert.deepEqual(b.at(-1), { from: 7.5, to: null, perMile: 1.28 });
  });

  test("finds the header below a title, skips blank and junk rows, sorts by price", () => {
    const b = parseFuelScale([["Truckload fuel surcharge scale"], [], ["Diesel From", "Diesel To", "Surcharge Per Mile"],
      ["$2.000", "$2.049", "$0.18"], [" ", " ", " "], ["note", "", ""], ["1.150", "1.199", "0.01"]]);
    assert.deepEqual(b, [{ from: 1.15, to: 1.199, perMile: 0.01 }, { from: 2, to: 2.049, perMile: 0.18 }]);
  });

  test("a sheet that isn't the fuel scale says what's wrong", () => {
    assert.throws(() => parseFuelScale([["Lane", "Pct"]]), /Diesel From/);
    assert.throws(() => parseFuelScale([["Diesel From", "Diesel To"]]), /perMile column/);
    assert.throws(() => parseFuelScale([["Diesel From", "Diesel To", "Surcharge Per Mile"]]), /no price brackets/);
  });
});

describe("fuel surcharge from the scale", () => {
  const S = fuelScale.brackets;
  test("every bracket: both ends give its surcharge", () => {
    for (const { from, to, perMile } of S.slice(0, -1)) {
      assert.equal(fscPerMile(from, S), perMile, `from ${from}`);
      assert.equal(fscPerMile(to, S), perMile, `to ${to}`);
    }
  });

  test("$7.500 and above is the top bracket", () => {
    for (const p of [7.5, 7.75, 9, 25]) assert.equal(fscPerMile(p, S), 1.28, String(p));
  });

  test("below the first bracket, zero, negative and junk give no surcharge", () => {
    for (const p of [1.149, 1, 0, -2, NaN, Infinity, null, undefined, "3.05"]) assert.equal(fscPerMile(p, S), 0, String(p));
  });

  test("no scale loaded gives no surcharge", () => {
    assert.equal(fscPerMile(4, null), 0);
    assert.equal(fscPerMile(4, []), 0);
  });

  test("values that float math would put in the wrong bracket", () => {
    assert.equal(fscPerMile(3.05, S), 0.39);
    assert.equal(fscPerMile(1.2, S), 0.02);
    assert.equal(fscPerMile(4.35, S), 0.65);
    assert.equal(fscPerMile(6.276, S), 1.03);
  });
});

describe("EIA weekly page", () => {
  const html = read("eia-diesel-page.html");
  const weeks = parseEiaHistoryPage(html);

  test("reads every Monday and price, oldest first", () => {
    assert.ok(weeks.length > 80);
    assert.deepEqual(weeks.at(-1), { week: "2026-10-19", price: 6.276 });
    assert.deepEqual(weeks.at(-2), { week: "2026-10-12", price: 6.179 });
    for (const w of weeks) {
      assert.match(w.week, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(new Date(w.week + "T00:00:00").getDay(), 1, `${w.week} is a Monday`);
      assert.ok(w.price > 1 && w.price < 10);
    }
    assert.deepEqual([...weeks].sort((a, b) => a.week.localeCompare(b.week)), weeks);
  });

  test("empty cells at the end of a month are skipped", () => {
    const row = "<td class='B6'>&nbsp;&nbsp;2026-Nov</td> <td class='B5'>11/02&nbsp;</td> <td class='B3'>6.300&nbsp;</td> <td class='B5'>&nbsp;</td> <td class='B3'>&nbsp;</td> </tr>";
    assert.deepEqual(parseEiaHistoryPage(row), [{ week: "2026-11-02", price: 6.3 }]);
  });

  test("a page with no table gives nothing", () => {
    assert.deepEqual(parseEiaHistoryPage("<html>maintenance</html>"), []);
    assert.deepEqual(parseEiaHistoryPage(""), []);
  });

  test("Wednesday rule: Monday's price takes effect two days later", () => {
    const at = (y, m, d) => effectivePrice(weeks, new Date(y, m - 1, d)).week;
    assert.equal(at(2026, 10, 19), "2026-10-12", "Monday: still last week's");
    assert.equal(at(2026, 10, 20), "2026-10-12", "Tuesday: still last week's");
    assert.equal(at(2026, 10, 21), "2026-10-19", "Wednesday: the new one");
    assert.equal(at(2026, 10, 25), "2026-10-19", "Sunday");
    assert.equal(at(2030, 1, 1), "2026-10-19", "far future: the latest we have");
  });

  test("Wednesday rule across a month and year boundary", () => {
    const list = [{ week: "2026-12-28", price: 5 }, { week: "2027-01-04", price: 6 }];
    assert.equal(effectivePrice(list, new Date(2027, 0, 5)).week, "2026-12-28");
    assert.equal(effectivePrice(list, new Date(2027, 0, 6)).week, "2027-01-04");
    assert.equal(effectivePrice(list, new Date(2026, 11, 29)), null, "before any price took effect");
    assert.equal(effectivePrice([], new Date()), null);
  });

  test("fetchDieselPricePublic", async () => {
    const ok = async () => textResponse(html);
    assert.deepEqual(await fetchDieselPricePublic(ok, new Date(2026, 9, 23)), { price: 6.276, week: "2026-10-19", source: "EIA weekly page" });
    await assert.rejects(fetchDieselPricePublic(async () => textResponse("", false, 503)), /503/);
    await assert.rejects(fetchDieselPricePublic(async () => textResponse("<html></html>")), /Couldn't read/);
    await assert.rejects(fetchDieselPricePublic(async () => { throw new TypeError("Failed to fetch"); }), /Failed to fetch/);
  });
});

describe("staleness", () => {
  const now = new Date(2026, 9, 23);
  test(`a price older than ${STALE_AFTER_DAYS} days (plus the 2-day Wednesday lag) is stale`, () => {
    assert.equal(isStale({ week: "2026-10-19" }, now), false);
    assert.equal(isStale({ week: "2026-10-14" }, now), false);
    assert.equal(isStale({ week: "2026-10-13" }, now), true);
    assert.equal(isStale({ week: "2026-10-01" }, now), true);
  });
  test("no price or no date is stale", () => {
    assert.equal(isStale(null, now), true);
    assert.equal(isStale({}, now), true);
  });
});
