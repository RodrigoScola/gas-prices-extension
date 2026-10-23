// Run with: node test/run.mjs
// Tests against the real Siemens sheets in private/ run only when those files are present.
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { parseEmail, parseDateTime } from "../lib/email.js";
import { readFirstSheet } from "../lib/xlsx.js";
import { parseRateSheet, findLane, matchEquipment, linehaul, parseTempSurcharges, findTempSurcharge, equipmentKey } from "../lib/rates.js";
import { fscPerMile, parseEiaHistoryPage, effectivePrice, fetchDieselPricePublic, isStale } from "../lib/fuel.js";
import { laneMiles, addressText } from "../lib/miles.js";
import { detectAccessorials, isHoliday } from "../lib/accessorials.js";

const file = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(file(p), "utf8");
const buf = (p) => { const b = readFileSync(file(p)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };

await test("unlabeled email (real sample layout)", () => {
  const d = parseEmail(read("../sample/email-sample.txt"));
  assert.equal(d.reference, "3011500000-01A");
  assert.deepEqual(d.destination, { city: "Fort Worth", state: "TX", zip: "76111", street: "1200 Example Industrial Blvd" });
  assert.deepEqual(d.origin, { city: "Grand Prairie", state: "TX", zip: "75050", street: "501 Fountain Parkway" });
  assert.equal(d.originFromSignature, true);
  assert.equal(d.consignee.name, "ACME ELECTRIC");
  assert.equal(d.consignee.street, "1200 Example Industrial Blvd");
  assert.equal(d.consignee.contact, "Jane Doe 555-010-0000");
  assert.equal(d.value, 42500);
  assert.equal(d.pieces, "4 cs");
  assert.equal(d.weight, 2150);
  assert.equal(d.sender, "Sam Sender");
  assert.equal(d.equipment, "Dry van/tractor trailer");
  assert.equal(d.readyNow, true);
  assert.equal(d.pickup.date.getMonth(), 9);
  assert.equal(d.pickup.date.getDate(), 28);
});

if (existsSync(file("../private/email-real-1.txt"))) {
  await test("real email 1 with subject", () => {
    const s = parseEmail(read("../private/email-real-1-with-subject.txt"));
    assert.equal(s.reference, "3011526620-23K");
    assert.equal(s.equipment, "Dry van/tractor trailer");
    assert.equal(s.pickup.date.getDate(), 14);
  });
  await test("real email 1", () => {
    const d = parseEmail(read("../private/email-real-1.txt"));
    assert.equal(d.reference, "3011526620-23K");
    assert.deepEqual(d.destination, { city: "Fort Worth", state: "TX", zip: "76111", street: "2917 Chesser Boyer Rd" });
    assert.deepEqual(d.origin, { city: "Grand Prairie", state: "TX", zip: "75050", street: "501 Fountain Parkway" });
    assert.equal(d.consignee.name, "MEI");
    assert.equal(d.value, 185690);
    assert.equal(d.weight, 3600);
    assert.equal(d.pieces, "2 cs");
  });
}

if (existsSync(file("../private/email-real-2.txt"))) {
  await test("real email 2 (RDI, Itasca)", () => {
    const d = parseEmail(read("../private/email-real-2.txt"));
    assert.equal(d.reference, "3010759748-41K/42K/43K/44K");
    assert.deepEqual(d.destination, { city: "Itasca", state: "IL", zip: "60143", street: "1070 ARDMORE AVE" });
    assert.deepEqual(d.origin, { city: "Grand Prairie", state: "TX", zip: "75050", street: "501 Fountain Parkway" });
    assert.equal(d.consignee.name, "RDI Enclosures & Systems");
    assert.equal(d.consignee.street, "1070 ARDMORE AVE");
    assert.equal(d.consignee.contact, "PH#6303738084, brian dlugos@therdigroup.com");
    assert.equal(d.value, 132600);
    assert.equal(d.pieces, "4 pcs");
    assert.equal(d.weight, 7200);
    assert.equal(d.equipment, "Dry van/tractor trailer");
    assert.equal(d.pickup.date.getDate(), 14);
    assert.equal(d.readyNow, true);
  });
}

await test("labeled email", () => {
  const d = parseEmail(read("../sample/email-labeled.txt"));
  assert.deepEqual(d.origin, { city: "Grand Prairie", state: "TX", zip: "75050" });
  assert.deepEqual(d.destination, { city: "Pomona", state: "CA", zip: "91766" });
  assert.equal(d.equipment, "Dry van/tractor trailer");
  assert.equal(d.miles, 1420);
  assert.equal(d.weight, 38500);
  assert.equal(d.reference, "LOAD-4471");
  assert.equal(d.pickup.date.toDateString(), new Date(2026, 9, 31).toDateString());
  assert.equal(d.pickup.minutes, 19 * 60);
  assert.equal(d.delivery.minutes, 10 * 60);
});

await test("lane sentence and dates", () => {
  const d = parseEmail("Need a flatbed, Chicago, IL to Columbus, OH, 355 miles");
  assert.equal(d.origin.city, "Chicago");
  assert.equal(d.destination.state, "OH");
  assert.equal(d.equipment, "Flatbed Rate inclusive of 48' & 53'");
  assert.equal(parseDateTime("Oct 28, 2026 08:00").minutes, 480);
  assert.equal(parseDateTime("2026-12-25").date.getDate(), 25);
});

await test("fuel surcharge scale", () => {
  assert.equal(fscPerMile(1.10), 0);
  assert.equal(fscPerMile(1.15), 0.01);
  assert.equal(fscPerMile(1.199), 0.01);
  assert.equal(fscPerMile(3.05), 0.39);
  assert.equal(fscPerMile(3.749), 0.52);
  assert.equal(fscPerMile(4.95), 0.77);
  assert.equal(fscPerMile(7.449), 1.26);
  assert.equal(fscPerMile(7.5), 1.28);
  assert.equal(fscPerMile(9), 1.28);
  assert.equal(isStale({ week: "2026-10-01" }, new Date("2026-10-23")), true);
  assert.equal(isStale({ week: "2026-10-19" }, new Date("2026-10-23")), false);
});

await test("EIA weekly page, Wednesday rule", async () => {
  const html = read("./eia-diesel-page.html");
  const weeks = parseEiaHistoryPage(html);
  assert.deepEqual(weeks.at(-1), { week: "2026-10-19", price: 6.276 });
  // Monday 10/19 price takes effect Wednesday 10/21.
  assert.equal(effectivePrice(weeks, new Date(2026, 9, 20)).week, "2026-10-12");
  assert.equal(effectivePrice(weeks, new Date(2026, 9, 21)).week, "2026-10-19");
  const fake = async () => ({ ok: true, text: async () => html });
  assert.deepEqual(await fetchDieselPricePublic(fake, new Date(2026, 9, 23)), { price: 6.276, week: "2026-10-19", source: "EIA weekly page" });
  assert.equal(fscPerMile(6.276), 1.03);
});

await test("lane miles from geocoder + router responses", async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (url.includes("census.gov")) return { ok: true, json: async () => ({ result: { addressMatches: [{ coordinates: url.includes("Fountain") ? { x: -97.06, y: 32.78 } : { x: -88.03, y: 41.98 } }] } }) };
    if (url.includes("project-osrm")) return { ok: true, json: async () => ({ code: "Ok", routes: [{ distance: 1502534.7 }] }) };
    throw new Error("unexpected " + url);
  };
  const r = await laneMiles({ street: "501 Fountain Parkway", city: "Grand Prairie", state: "TX", zip: "75050" }, { street: "1070 ARDMORE AVE", city: "Itasca", state: "IL", zip: "60143" }, fake);
  assert.deepEqual(r, { miles: 934, precision: "street address" });
  assert.match(calls[2], /-97.06,32.78;-88.03,41.98/);
  assert.equal(addressText({ city: "Itasca", state: "IL", zip: "60143" }), "Itasca, IL 60143");
});

await test("accessorials", () => {
  assert.equal(isHoliday(new Date(2026, 10, 26)), true); // Thanksgiving 2026
  assert.equal(isHoliday(new Date(2026, 4, 25)), true); // Memorial Day 2026
  assert.equal(isHoliday(new Date(2026, 8, 7)), true); // Labor Day 2026
  assert.equal(isHoliday(new Date(2026, 10, 11)), false);
  const on = detectAccessorials({ pickup: { date: new Date(2026, 9, 31), minutes: 19 * 60 }, delivery: { date: new Date(2026, 11, 25), minutes: 600 } });
  assert.deepEqual([...on].sort(), ["afterHoursPickup", "holidayDelivery", "weekendPickup"]);
});

await test("linehaul uses the minimum when it is higher", () => {
  assert.deepEqual(linehaul({ min: 500, perMile: 2 }, 100), { amount: 500, basis: "minimum charge" });
  assert.deepEqual(linehaul({ min: 500, perMile: 2 }, 400), { amount: 800, basis: "per mile" });
  assert.deepEqual(linehaul({ min: 500, perMile: null }, null), { amount: 500, basis: "minimum charge" });
  assert.equal(linehaul({ min: null, perMile: 2 }, null), null);
  assert.equal(equipmentKey("Flatbed Rate inclusive of 48' & 53' and air ride"), "flatbed rate inclusive of 48' & 53'");
});

if (existsSync(file("../private/Siemens FTL Final Bid 2026.xlsx"))) {
  await test("real rate sheet", async () => {
    const { equipmentTypes, lanes } = parseRateSheet(await readFirstSheet(buf("../private/Siemens FTL Final Bid 2026.xlsx")));
    assert.deepEqual(equipmentTypes, ["Dry van/tractor trailer", "Flatbed Rate inclusive of 48' & 53'", "Single-drop", "Refrigerated Truck"]);
    assert.equal(lanes.length, 3197);
    const gp = { city: "Grand Prairie", state: "TX" };
    const fw = findLane(lanes, gp, { city: "Fort Worth", state: "TX" });
    assert.equal(fw.match, "city to city");
    assert.deepEqual(fw.lane.rates["Dry van/tractor trailer"], { min: 500, perMile: null });
    // Min Charge cell holds a space here; it must not become a $0 minimum.
    assert.deepEqual(findLane(lanes, gp, { city: "Itasca", state: "IL" }).lane.rates["Dry van/tractor trailer"], { min: null, perMile: 1.43 });
    const pom = findLane(lanes, gp, { city: "Pomona", state: "CA" });
    assert.equal(pom.lane.rates["Dry van/tractor trailer"].perMile, 0.93);
    const st = findLane(lanes, { city: "Nowhere", state: "WY" }, { city: "Elsewhere", state: "WY" });
    assert.equal(st.match, "state to state");
    assert.equal(st.lane.rates["Flatbed Rate inclusive of 48' & 53'"].perMile, 5.38);
    assert.equal(matchEquipment(equipmentTypes, "Dry van/tractor trailer"), "Dry van/tractor trailer");
  });
}

if (existsSync(file("../private/Siemens Accepted Surcharge.xlsx"))) {
  await test("real temporary surcharges", async () => {
    const list = parseTempSurcharges(await readFirstSheet(buf("../private/Siemens Accepted Surcharge.xlsx")));
    assert.ok(list.length > 100);
    const gp = { city: "Grand Prairie", state: "TX" };
    assert.equal(findTempSurcharge(list, gp, { city: "Pomona", state: "CA" }, "Dry van/tractor trailer").pct, 0.1);
    assert.equal(findTempSurcharge(list, gp, { city: "Denver", state: "CO" }, "Dry van/tractor trailer").pct, 0.25);
    assert.equal(findTempSurcharge(list, { city: "Laredo", state: "TX" }, { city: "Any", state: "CA" }, "Single-drop").pct, 0.15);
  });
}

console.log(`\n${passed} tests passed.`);
