import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  parseRateSheet, findLane, matchEquipment, linehaul, parseTempSurcharges, findTempSurcharge,
  equipmentKey, normCity, normState,
} from "../lib/rates.js";

// Same layout as the Siemens bid sheet: title rows, then the header on row 3.
const HEADER = ["ID", "Lane", "Origin City", "Origin State", "Origin Country", "Destination City", "Destation State", "Destination Country", "UOM", "Project Currency",
  "Min Charge - Dry van/tractor trailer (inclusive of air ride)", "Unit Rate - Dry van/tractor trailer (inclusive of air ride)",
  "Min Charge - Flatbed Rate inclusive of 48' & 53' (inclusive of air ride)", "Unit Rate - Flatbed Rate inclusive of 48' & 53' (inclusive of air ride)",
  "Min Charge - Single-drop (inclusive of air ride)", "Unit Rate - Single-drop (inclusive of air ride)",
  "Min Charge - Refrigerated Truck (inclusive of air ride)", "Unit Rate - Refrigerated Truck (inclusive of air ride)", "Comments"];
const row = (oc, os, dc, ds, rates) => ["1", "", oc, os, "USA", dc, ds, "USA", "Per Mile", "USD", ...rates];
const ROWS = [
  ["US FTL RFQ"],
  ["Instructions: only fill out the blue cells"],
  HEADER,
  row("Grand Prairie", "TX", "Fort Worth", "TX", ["500", "", "", "", "600", ""]),
  row("Grand Prairie", "TX", "Itasca", "IL", [" ", "1.43"]),
  row("Grand Prairie", "TX", "", "IL", ["", "1.31", "", "1.94", "", "1.94"]),
  row("", "TX", "Itasca", "IL", ["", "1.50"]),
  row("", "TX", "", "IL", ["750", "1.59", "850", "1.83", "850", "1.83"]),
  row("St. Louis", "MO", "Chicago", "IL", ["$1,200.00", "$2.10"]),
  row("", "", "", "", ["1", "1"]), // no states: skipped
  row("Nowhere", "WY", "Elsewhere", "WY", []), // no rates
];

describe("parseRateSheet", () => {
  const sheet = parseRateSheet(ROWS);

  test("finds the header under title rows and reads every equipment type", () => {
    assert.deepEqual(sheet.equipmentTypes, ["Dry van/tractor trailer", "Flatbed Rate inclusive of 48' & 53'", "Single-drop", "Refrigerated Truck"]);
    assert.equal(sheet.lanes.length, 7);
  });

  test("min charge and rate per mile per equipment; blank and space-only cells are null", () => {
    assert.deepEqual(sheet.lanes[0].rates, { "Dry van/tractor trailer": { min: 500, perMile: null }, "Single-drop": { min: 600, perMile: null } });
    assert.deepEqual(sheet.lanes[1].rates, { "Dry van/tractor trailer": { min: null, perMile: 1.43 } });
  });

  test("dollar signs and thousands separators", () => {
    assert.deepEqual(sheet.lanes[5].rates["Dry van/tractor trailer"], { min: 1200, perMile: 2.1 });
  });

  test("a lane with no rates is kept, with an empty rate list", () => {
    assert.deepEqual(sheet.lanes[6].rates, {});
  });

  test("errors name what's missing", () => {
    assert.throws(() => parseRateSheet([["foo", "bar"], ["1", "2"]]), /Origin City/);
    assert.throws(() => parseRateSheet([["Origin City", "Origin State", "Destination City"]]), /destState/);
    assert.throws(() => parseRateSheet([["Origin City", "Origin State", "Destination City", "Destination State"]]), /Min Charge/);
    assert.throws(() => parseRateSheet([]), /header row/);
  });

  test("header cells with extra spaces or different case", () => {
    const s = parseRateSheet([["  origin city ", "ORIGIN STATE", "Destination City", "Destination State", "Unit Rate - Van"], ["A", "tx", "B", "ok", "2"]]);
    assert.deepEqual(s.lanes[0], { originCity: "A", originState: "TX", destCity: "B", destState: "OK", rates: { Van: { min: null, perMile: 2 } } });
  });
});

describe("findLane", () => {
  const { lanes } = parseRateSheet(ROWS);
  const gp = { city: "Grand Prairie", state: "TX" };

  test("city to city wins", () => {
    const hit = findLane(lanes, gp, { city: "Itasca", state: "IL" });
    assert.equal(hit.match, "city to city");
    assert.equal(hit.lane.rates["Dry van/tractor trailer"].perMile, 1.43);
  });

  test("city to state when the destination city has no lane", () => {
    const hit = findLane(lanes, gp, { city: "Joliet", state: "IL" });
    assert.equal(hit.match, "city to state");
    assert.equal(hit.lane.rates["Dry van/tractor trailer"].perMile, 1.31);
  });

  test("state to city when the origin city has no lane", () => {
    const hit = findLane(lanes, { city: "Austin", state: "TX" }, { city: "Itasca", state: "IL" });
    assert.equal(hit.match, "state to city");
    assert.equal(hit.lane.rates["Dry van/tractor trailer"].perMile, 1.5);
  });

  test("state to state as the last resort", () => {
    const hit = findLane(lanes, { city: "Austin", state: "TX" }, { city: "Joliet", state: "IL" });
    assert.equal(hit.match, "state to state");
    assert.equal(hit.lane.rates["Dry van/tractor trailer"].min, 750);
  });

  test("no lane at all", () => {
    assert.equal(findLane(lanes, gp, { city: "Miami", state: "FL" }), null);
  });

  test("city names match regardless of case, punctuation and St./Saint", () => {
    assert.equal(findLane(lanes, { city: "GRAND PRAIRIE", state: "tx" }, { city: "fort worth", state: "TX" }).match, "city to city");
    assert.equal(findLane(lanes, { city: "Saint Louis", state: "MO" }, { city: "Chicago", state: "IL" }).match, "city to city");
    assert.equal(findLane(lanes, { city: "St Louis", state: "MO" }, { city: "Chicago", state: "IL" }).match, "city to city");
  });

  test("direction matters", () => {
    assert.equal(findLane(lanes, { city: "Fort Worth", state: "TX" }, gp)?.match, undefined);
  });
});

describe("helpers", () => {
  test("normCity and normState", () => {
    assert.equal(normCity("St. Louis"), "saintlouis");
    assert.equal(normCity("O'Fallon"), "ofallon");
    assert.equal(normCity(null), "");
    assert.equal(normState(" tx "), "TX");
  });

  test("equipmentKey lines up the surcharge sheet's names with the rate sheet's", () => {
    assert.equal(equipmentKey("Dry van/tractor trailer inclusive of air ride"), "dry van/tractor trailer");
    assert.equal(equipmentKey("Dry van/tractor trailer (inclusive of air ride)"), "dry van/tractor trailer");
    assert.equal(equipmentKey("Flatbed Rate inclusive of 48' & 53' and air ride"), "flatbed rate inclusive of 48' & 53'");
    assert.equal(equipmentKey("  Single-drop  "), "single-drop");
  });

  test("matchEquipment", () => {
    const types = ["Dry van/tractor trailer", "Flatbed Rate inclusive of 48' & 53'", "Single-drop", "Refrigerated Truck"];
    assert.equal(matchEquipment(types, "Dry van/tractor trailer"), "Dry van/tractor trailer");
    assert.equal(matchEquipment(types, "single-drop (inclusive of air ride)"), "Single-drop");
    assert.equal(matchEquipment(types, "Refrigerated"), "Refrigerated Truck");
    assert.equal(matchEquipment(types, "Lowboy"), null);
    assert.equal(matchEquipment(types, null), null);
    assert.equal(matchEquipment([], "Dry van/tractor trailer"), null);
  });
});

describe("linehaul", () => {
  test("per mile, with the minimum as a floor", () => {
    assert.deepEqual(linehaul({ min: 500, perMile: 2 }, 400), { amount: 800, basis: "per mile" });
    assert.deepEqual(linehaul({ min: 500, perMile: 2 }, 100), { amount: 500, basis: "minimum charge" });
    assert.deepEqual(linehaul({ min: 500, perMile: 2 }, 250), { amount: 500, basis: "per mile" }, "a tie bills per mile");
    assert.deepEqual(linehaul({ min: null, perMile: 1.43 }, 934), { amount: 1.43 * 934, basis: "per mile" });
  });

  test("minimum-only lanes don't need miles", () => {
    assert.deepEqual(linehaul({ min: 500, perMile: null }, null), { amount: 500, basis: "minimum charge" });
    assert.deepEqual(linehaul({ min: 500, perMile: null }, 2000), { amount: 500, basis: "minimum charge" });
  });

  test("per-mile lanes without miles, and no rate", () => {
    assert.equal(linehaul({ min: null, perMile: 2 }, null), null);
    assert.equal(linehaul({ min: null, perMile: 2 }, 0), null);
    assert.equal(linehaul(null, 100), null);
    assert.deepEqual(linehaul({ min: 500, perMile: 2 }, null), { amount: 500, basis: "minimum charge" });
  });
});

describe("temporary surcharges", () => {
  const rows = [
    ["Lane", "Equipment Type", "Temporary Surcharge: Percentage Added to the Current Linehaul Price"],
    ["All Laredo, TX outbound lanes", "Single-drop", "0.15"],
    ["All Laredo, TX outbound lanes", "Dry van/tractor trailer inclusive of air ride ", "0.09"],
    ["Grand Prairie,TX-CA", "Dry van/tractor trailer inclusive of air ride", "0"],
    ["Grand Prairie,TX-Pomona,CA", "Dry van/tractor trailer inclusive of air ride", "0.1"],
    ["Grand Prairie, TX-Coppell,TX", "Single-drop", "7.0000000000000007E-2"],
    ["All Grand Prairie, TX outbound lanes", "Dry van/tractor trailer inclusive of air ride", "0.05"],
    ["Grand Prairie,TX-AR", "Dry van/tractor trailer inclusive of air ride", ""], // blank: skipped
    ["Somewhere weird", "Single-drop", "0.3"], // unreadable lane: skipped
    ["", "", ""],
  ];
  const list = parseTempSurcharges(rows);
  const gp = { city: "Grand Prairie", state: "TX" };

  test("reads the three lane formats, skips blanks and unreadable rows", () => {
    assert.equal(list.length, 6);
    assert.deepEqual(list[0], { originCity: "Laredo", originState: "TX", destCity: null, destState: null, equipment: "single-drop", pct: 0.15 });
    assert.deepEqual(list[2], { originCity: "Grand Prairie", originState: "TX", destCity: null, destState: "CA", equipment: "dry van/tractor trailer", pct: 0 });
    assert.equal(list[4].pct, 0.07000000000000001, "scientific notation from Excel");
  });

  test("most specific wins: city, then state, then all outbound", () => {
    const dv = "Dry van/tractor trailer";
    assert.equal(findTempSurcharge(list, gp, { city: "Pomona", state: "CA" }, dv).pct, 0.1);
    assert.equal(findTempSurcharge(list, gp, { city: "Fresno", state: "CA" }, dv).pct, 0);
    assert.equal(findTempSurcharge(list, gp, { city: "Denver", state: "CO" }, dv).pct, 0.05);
    assert.equal(findTempSurcharge(list, { city: "Laredo", state: "TX" }, { city: "Any", state: "NY" }, "Single-drop").pct, 0.15);
  });

  test("equipment has to match", () => {
    assert.equal(findTempSurcharge(list, { city: "Laredo", state: "TX" }, { city: "Any", state: "NY" }, "Refrigerated Truck"), null);
    assert.equal(findTempSurcharge(list, gp, { city: "Coppell", state: "TX" }, "Single-drop").pct, 0.07000000000000001);
  });

  test("no entry for the origin", () => {
    assert.equal(findTempSurcharge(list, { city: "Austin", state: "TX" }, { city: "Pomona", state: "CA" }, "Dry van/tractor trailer"), null);
    assert.equal(findTempSurcharge([], gp, { city: "Pomona", state: "CA" }, "Dry van/tractor trailer"), null);
  });
});
