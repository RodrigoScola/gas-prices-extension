import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateTime } from "../lib/email.js";

const NOW = new Date(2026, 9, 23);
const ymd = (x) => x?.date && [x.date.getFullYear(), x.date.getMonth() + 1, x.date.getDate()].join("-");

test("date formats", () => {
  const cases = {
    "2026-10-28": "2026-10-28",
    "10/28/2026": "2026-10-28",
    "10/28/26": "2026-10-28",
    "1/5/2027": "2027-1-5",
    "10/28": "2026-10-28",
    "Oct 28, 2026": "2026-10-28",
    "Oct. 28 2026": "2026-10-28",
    "October 28th": "2026-10-28",
    "Dec 1st, 2026": "2026-12-1",
    "sept 3": "2026-9-3",
  };
  for (const [s, want] of Object.entries(cases)) assert.equal(ymd(parseDateTime(s, NOW)), want, s);
});

test("a date without a year uses the current year", () => {
  assert.equal(parseDateTime("3/4", new Date(2030, 0, 1)).date.getFullYear(), 2030);
});

test("time formats", () => {
  const cases = {
    "7:00 PM": 19 * 60, "7:30pm": 19 * 60 + 30, "7 pm": 19 * 60, "7pm": 19 * 60,
    "7:00 a.m.": 7 * 60, "12:00 AM": 0, "12:15 PM": 12 * 60 + 15, "19:30": 19 * 60 + 30, "08:00": 8 * 60, "0:05": 5,
  };
  for (const [s, want] of Object.entries(cases)) assert.equal(parseDateTime(s, NOW)?.minutes, want, s);
});

test("date and time together", () => {
  const x = parseDateTime("10/31/2026 5:00 AM", NOW);
  assert.equal(ymd(x), "2026-10-31");
  assert.equal(x.minutes, 300);
});

test("time only, date only, and nothing", () => {
  assert.deepEqual(parseDateTime("8:00 AM", NOW), { date: null, minutes: 480 });
  assert.equal(parseDateTime("10/31/2026", NOW).minutes, null);
  assert.equal(parseDateTime("ASAP", NOW), null);
  assert.equal(parseDateTime("", NOW), null);
  assert.equal(parseDateTime(null, NOW), null);
});

test("invalid times aren't read as times", () => {
  assert.equal(parseDateTime("25:00", NOW), null);
  assert.equal(parseDateTime("10:75", NOW), null);
});

test("a date without a year is the next one coming up", () => {
  const lateDec = new Date(2026, 11, 28);
  assert.equal(ymd(parseDateTime("1/5", lateDec)), "2027-1-5", "early January seen in late December");
  assert.equal(ymd(parseDateTime("Jan 5", lateDec)), "2027-1-5");
  assert.equal(ymd(parseDateTime("12/20", lateDec)), "2026-12-20", "a few days back stays this year");
  assert.equal(ymd(parseDateTime("11/1", lateDec)), "2026-11-1", "under 60 days back stays this year");
  assert.equal(ymd(parseDateTime("10/14", new Date(2026, 9, 23))), "2026-10-14");
  assert.equal(ymd(parseDateTime("1/5/2026", lateDec)), "2026-1-5", "an explicit year is kept");
});
