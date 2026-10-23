import { test } from "node:test";
import assert from "node:assert/strict";
import { geocode, drivingMiles, laneMiles, addressText } from "../lib/miles.js";
import { routeFetch, jsonResponse } from "./helpers.mjs";

const GP = { street: "501 Fountain Parkway", city: "Grand Prairie", state: "TX", zip: "75050" };
const ITASCA = { street: "1070 ARDMORE AVE", city: "Itasca", state: "IL", zip: "60143" };
const census = (x, y) => jsonResponse({ result: { addressMatches: [{ coordinates: { x, y } }] } });
const censusMiss = jsonResponse({ result: { addressMatches: [] } });
const nominatim = (lon, lat) => jsonResponse([{ lon: String(lon), lat: String(lat) }]);
const osrm = (meters) => jsonResponse({ code: "Ok", routes: [{ distance: meters }] });

test("addressText", () => {
  assert.equal(addressText(GP), "501 Fountain Parkway, Grand Prairie, TX 75050");
  assert.equal(addressText({ city: "Itasca", state: "IL", zip: "60143" }), "Itasca, IL 60143");
  assert.equal(addressText({ city: "Itasca", state: "IL" }), "Itasca, IL");
});

test("street address goes to the Census geocoder", async () => {
  const f = routeFetch([["census.gov", census(-97.06, 32.78)]]);
  assert.deepEqual(await geocode(GP, f), { lon: -97.06, lat: 32.78, source: "street address" });
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /address=501\+Fountain\+Parkway%2C\+Grand\+Prairie%2C\+TX\+75050/);
  assert.match(f.calls[0], /benchmark=Public_AR_Current/);
});

test("Census miss or error falls back to OpenStreetMap by city and zip", async () => {
  for (const censusAnswer of [censusMiss, jsonResponse({}, false, 500)]) {
    const f = routeFetch([["census.gov", censusAnswer], ["nominatim", nominatim(-88.01, 41.97)]]);
    assert.deepEqual(await geocode(ITASCA, f), { lon: -88.01, lat: 41.97, source: "city/zip" });
    assert.match(f.calls[1], /q=Itasca%2C\+IL\+60143%2C\+USA/);
    assert.match(f.calls[1], /countrycodes=us%2Cca/);
  }
});

test("no street skips the Census geocoder", async () => {
  const f = routeFetch([["nominatim", nominatim(1, 2)]]);
  await geocode({ city: "Itasca", state: "IL" }, f);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0], /nominatim/);
});

test("a place nobody can find is an error that names it", async () => {
  const f = routeFetch([["nominatim", jsonResponse([])]]);
  await assert.rejects(geocode({ city: "Atlantis", state: "ZZ" }, f), /Atlantis, ZZ, USA/);
  const down = routeFetch([["nominatim", jsonResponse([], false, 429)]]);
  await assert.rejects(geocode({ city: "Itasca", state: "IL" }, down), /429/);
});

test("driving miles from OSRM, rounded", async () => {
  const f = routeFetch([["project-osrm", osrm(1502534.7)]]);
  assert.equal(await drivingMiles({ lon: -97.06, lat: 32.78 }, { lon: -88.03, lat: 41.98 }, f), 934);
  assert.match(f.calls[0], /driving\/-97.06,32.78;-88.03,41.98\?overview=false/);
  assert.equal(await drivingMiles({ lon: 0, lat: 0 }, { lon: 0, lat: 0 }, routeFetch([["osrm", osrm(0)]])), 0);
});

test("OSRM failures", async () => {
  const a = { lon: 0, lat: 0 };
  await assert.rejects(drivingMiles(a, a, routeFetch([["osrm", jsonResponse({ code: "NoRoute", routes: [] })]])), /didn't return a route/);
  await assert.rejects(drivingMiles(a, a, routeFetch([["osrm", jsonResponse({}, false, 502)]])), /didn't return a route/);
  await assert.rejects(drivingMiles(a, a, routeFetch([["osrm", jsonResponse({ code: "Ok", routes: [] })]])), /didn't return a route/);
});

test("laneMiles: street precision only when both ends geocoded by street", async () => {
  const both = routeFetch([["census.gov", (u) => (u.includes("Fountain") ? census(-97.06, 32.78) : census(-88.03, 41.98))], ["osrm", osrm(1502534.7)]]);
  assert.deepEqual(await laneMiles(GP, ITASCA, both), { miles: 934, precision: "street address" });
  assert.equal(both.calls.length, 3);

  const oneSide = routeFetch([["census.gov", censusMiss], ["nominatim", nominatim(-88, 42)], ["osrm", osrm(160934.4)]]);
  assert.deepEqual(await laneMiles(GP, { city: "Itasca", state: "IL" }, oneSide), { miles: 100, precision: "city/zip" });
});

test("laneMiles geocodes one end at a time (OpenStreetMap allows 1 request at a time)", async () => {
  let inFlight = 0, maxInFlight = 0;
  const slow = async (url) => {
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return url.includes("osrm") ? osrm(1000) : nominatim(1, 1);
  };
  await laneMiles({ city: "A", state: "TX" }, { city: "B", state: "TX" }, slow);
  assert.equal(maxInFlight, 1);
});
