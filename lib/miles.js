// Lane miles from free public APIs, no keys:
//   1. US Census geocoder for a street address, falling back to OpenStreetMap Nominatim
//      when there's only a city and zip.
//   2. OSRM routing for the driving distance.
// These are car routes. Truck routes (PC*Miler and similar) can run a few percent longer.

const CENSUS = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = "https://router.project-osrm.org/route/v1/driving/";
const METERS_PER_MILE = 1609.344;

export const addressText = (p) => [p.street, `${p.city}, ${p.state}${p.zip ? " " + p.zip : ""}`].filter(Boolean).join(", ");

export async function geocode(p, fetchImpl = fetch) {
  if (p.street) {
    const res = await fetchImpl(`${CENSUS}?${new URLSearchParams({ address: addressText(p), benchmark: "Public_AR_Current", format: "json" })}`);
    if (res.ok) {
      const hit = (await res.json())?.result?.addressMatches?.[0]?.coordinates;
      if (hit) return { lon: hit.x, lat: hit.y, source: "street address" };
    }
  }
  const q = `${p.city}, ${p.state}${p.zip ? " " + p.zip : ""}, USA`;
  const res = await fetchImpl(`${NOMINATIM}?${new URLSearchParams({ q, format: "json", limit: "1", countrycodes: "us,ca" })}`);
  if (!res.ok) throw new Error(`Couldn't find ${q} on the map (${res.status}).`);
  const hit = (await res.json())?.[0];
  if (!hit) throw new Error(`Couldn't find ${q} on the map.`);
  return { lon: Number(hit.lon), lat: Number(hit.lat), source: "city/zip" };
}

export async function drivingMiles(a, b, fetchImpl = fetch) {
  const res = await fetchImpl(`${OSRM}${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
  const body = res.ok ? await res.json() : null;
  if (!body || body.code !== "Ok" || !body.routes?.length) throw new Error("Routing service didn't return a route.");
  return Math.round(body.routes[0].distance / METERS_PER_MILE);
}

export async function laneMiles(origin, dest, fetchImpl = fetch) {
  const [a, b] = [await geocode(origin, fetchImpl), await geocode(dest, fetchImpl)];
  return { miles: await drivingMiles(a, b, fetchImpl), precision: a.source === "street address" && b.source === "street address" ? "street address" : "city/zip" };
}
