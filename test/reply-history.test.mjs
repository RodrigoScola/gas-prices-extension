import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { quoteText } from "../lib/reply.js";
import { addToHistory, emailKey, ago, HISTORY_MAX } from "../lib/history.js";
import { computeQuote } from "../lib/quote.js";
import { parseRateSheet } from "../lib/rates.js";
import { parseEmail } from "../lib/email.js";
import { read, fuelScale } from "./helpers.mjs";

const NOW = new Date(2026, 9, 23);
const rateSheet = parseRateSheet([
  ["Origin City", "Origin State", "Destination City", "Destination State", "Min Charge - Dry van/tractor trailer", "Unit Rate - Dry van/tractor trailer"],
  ["Grand Prairie", "TX", "Fort Worth", "TX", "500", ""],
]);
const fuel = { price: 6.276, week: "2026-10-19", source: "EIA weekly page" };
const details = parseEmail(read("../sample/email-sample.txt"), NOW);
const lane = { origin: "Grand Prairie, TX", destination: "Fort Worth, TX", equipment: "Dry van/tractor trailer" };
const quote = computeQuote({ rateSheet, fuelScale, details, originText: lane.origin, destText: lane.destination, equipment: lane.equipment, equipmentFromEmail: true, miles: 20, diesel: 6.276, fuel, now: NOW });

describe("copy the quote", () => {
  test("quoteText", () => {
    assert.equal(quoteText(quote), "Linehaul (minimum charge): $500.00\nFuel (20 mi × $1.03): $20.60\nTotal: $520.60");
  });
});

describe("quote history", () => {
  const entry = (key, total) => ({ key, total, at: NOW.toISOString() });

  test("newest first, one entry per email", () => {
    let h = addToHistory([], entry("a", 1));
    h = addToHistory(h, entry("b", 2));
    h = addToHistory(h, entry("a", 3));
    assert.deepEqual(h.map((e) => [e.key, e.total]), [["a", 3], ["b", 2]]);
  });

  test(`keeps the last ${HISTORY_MAX}`, () => {
    let h = [];
    for (let i = 0; i < 40; i++) h = addToHistory(h, entry(String(i), i));
    assert.equal(h.length, HISTORY_MAX);
    assert.equal(h[0].key, "39");
    assert.equal(addToHistory(null, entry("x", 1)).length, 1);
  });

  test("emailKey is stable and short", () => {
    assert.equal(emailKey("hello"), emailKey("hello"));
    assert.notEqual(emailKey("hello"), emailKey("hello!"));
    assert.match(emailKey(read("../sample/email-sample.txt")), /^[0-9a-f]{8}$/);
  });

  test("ago", () => {
    const at = (secs) => new Date(NOW - secs * 1000).toISOString();
    assert.equal(ago(at(10), NOW), "just now");
    assert.equal(ago(at(300), NOW), "5 min ago");
    assert.equal(ago(at(7200), NOW), "2 h ago");
    assert.equal(ago(at(90000), NOW), "yesterday");
    assert.equal(ago(new Date(2026, 9, 1).toISOString(), NOW), "Oct 1");
  });
});
