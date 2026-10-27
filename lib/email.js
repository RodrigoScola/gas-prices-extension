// Step 1: pull load details out of a plain-text shipping email.
//
// Built from the first real sample (a Siemens Grand Prairie coordinator email):
//   3011526620-23K            <- reference / order number
//   MEI                       <- consignee
//   2917 Chesser Boyer Rd
//   FORT WORTH TX 76111       <- delivery city/state/zip, no comma
//   Attn: Chris Green 682-... <- delivery contact
//   $185,690.00               <- shipment value
//   2cs / 3600lbs             <- pieces / weight
//   ...signature with the sender's address (Grand Prairie, TX 75050) <- pickup
// Labeled emails ("Pickup: Dallas, TX") are handled too, and labels win over position.

const STATES =
  "AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|AB|BC|MB|NB|NL|NS|ON|PE|QC|SK";

// "FORT WORTH TX 76111", "Grand Prairie, TX 75050, USA", "Dallas, TX"
// Without a comma the zip is required, so "SHIPPER CO" or "PLEASE CALL ME" isn't a place.
const CITY_STATE_SEP = `(?:,\\s*|\\s+(?=(?:${STATES})\\b\\.?\\s+\\d{5}))`;
const CITY_LINE = new RegExp(`^\\s*([A-Za-z][A-Za-z .'-]{0,40}?)${CITY_STATE_SEP}(${STATES})\\b\\.?(?:\\s+(\\d{5})(?:-\\d{4})?)?(?:,?\\s*(?:USA|US|United States))?\\s*$`);
const PLACE = `([A-Za-z][A-Za-z .'-]{0,40}?)${CITY_STATE_SEP}(${STATES})\\b(?:\\s+(\\d{5}))?`;

const EQUIPMENT = [
  { type: "Refrigerated Truck", re: /\b(reefer|refrigerated|temp[- ]controlled)\b/i },
  { type: "Single-drop", re: /\b(step ?deck|single[- ]drop)\b/i },
  { type: "Flatbed Rate inclusive of 48' & 53'", re: /\b(flat ?bed)\b/i },
  { type: "Dry van/tractor trailer", re: /\b(dry van|van|tractor trailer)\b/i },
];

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
const place = (city, state, zip) => ({ city: titleCase(city.trim()), state: state.toUpperCase(), zip: zip || null });

function labeledPlace(text, labels) {
  for (const label of labels) {
    const m = text.match(new RegExp(`(?:^|\\n)\\s*${label}\\s*[:\\-]\\s*(?:[^\\n]*\\n){0,3}?\\s*${PLACE}`, "i"));
    if (m) return place(m[1], m[2], m[3]);
  }
  return null;
}

// Same, but with the city and state run together, as in "ITASCAIL 60143". Needs the zip,
// so ordinary words ending in two capitals don't match.
const GLUED_CITY_LINE = new RegExp(`^\\s*([A-Z][A-Z .'-]*?[A-Z])(${STATES})\\s+(\\d{5})(?:-\\d{4})?\\s*$`);

// Contact lines right under the address: "Attn: Chris Green 682-...", "PH#630...", an email.
const CONTACT_LINE = /^\s*(?:attn:?\s*(.+)|((?:ph|phone|tel)\s*[#:.]?\s*[\d() .-]{7,}.*)|([^@\n]*\S@\S+\.\w+))\s*$/i;

// Address blocks: the lines above a "City ST zip" line, plus the contact lines after it.
function addressBlocks(lines) {
  const blocks = [];
  lines.forEach((line, i) => {
    const m = line.match(CITY_LINE) || line.match(GLUED_CITY_LINE);
    if (!m) return;
    const above = [];
    for (let j = i - 1; j >= 0 && above.length < 2 && lines[j].trim(); j--) above.unshift(lines[j].trim());
    const contacts = [];
    for (let j = i + 1; j < lines.length && contacts.length < 3; j++) {
      const c = lines[j].match(CONTACT_LINE);
      if (!c || /^mailto:/i.test(lines[j].trim())) break;
      contacts.push((c[1] || c[2] || c[3]).trim());
    }
    blocks.push({
      line: i,
      ...place(m[1], m[2], m[3]),
      street: above.find((l) => /^\d+\s/.test(l)) || null,
      name: above.find((l) => !/^\d+\s/.test(l) && !/^\d{6,}/.test(l)) || null,
      contact: contacts.length ? contacts.join(", ") : null,
    });
  });
  return blocks;
}

// Dates like 10/28/2026, 10/28, Oct 28 2026, 2026-10-28, with an optional time.
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
// A date written without a year is the next one coming up: "1/5" in late December is next
// January. Dates up to 60 days back stay in this year (a load that already went out).
function withoutYear(month, day, now) {
  const d = new Date(now.getFullYear(), month, day);
  return d < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60) ? new Date(now.getFullYear() + 1, month, day) : d;
}

export function parseDateTime(s, now = new Date()) {
  if (!s) return null;
  let date = null;
  let m;
  if ((m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) date = new Date(+m[1], m[2] - 1, +m[3]);
  else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    date = m[3] ? new Date(m[3].length === 2 ? 2000 + +m[3] : +m[3], m[1] - 1, +m[2]) : withoutYear(m[1] - 1, +m[2], now);
  } else if ((m = s.match(new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i")))) {
    const month = MONTHS.split("|").indexOf(m[1].toLowerCase().slice(0, 3));
    date = m[3] ? new Date(+m[3], month, +m[2]) : withoutYear(month, +m[2], now);
  }
  let minutes = null;
  if ((m = s.match(/\b(\d{1,2}):(\d{2})\s*([ap])\.?m?\b/i)) || (m = s.match(/\b(\d{1,2})\s*([ap])\.?m\b/i))) {
    const ampm = (m[3] || m[2]).toLowerCase();
    const mins = m[3] ? +m[2] : 0;
    minutes = ((+m[1] % 12) + (ampm === "p" ? 12 : 0)) * 60 + mins;
  } else if ((m = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/))) minutes = +m[1] * 60 + +m[2];
  return date || minutes != null ? { date, minutes } : null;
}

// First labeled line ("Pickup date: ...", "Delivery: ...") that actually holds a date or time.
function labeledDateTime(text, labels, now) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:${labels})(?:\\s+(?:date|time|appt|appointment))*\\s*[:\\-]\\s*([^\\n]+)`, "gi");
  for (const m of text.matchAll(re)) {
    const dt = parseDateTime(m[1], now);
    if (dt) return dt;
  }
  return null;
}

export function parseEmail(raw, now = new Date()) {
  const text = String(raw || "")
    .replace(/\r/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, ""); // quoted replies ("> MEI") read like the original
  const lines = text.split("\n");

  // Where the signature starts, so we can tell the sender's own address from the shipment's.
  const sigLine = lines.findIndex((l) => /^\s*(best regards|regards|with best regards|thanks|thank you|sincerely)\b/i.test(l));
  const blocks = addressBlocks(lines);
  const bodyBlocks = blocks.filter((b) => sigLine < 0 || b.line < sigLine);
  const sigBlocks = sigLine < 0 ? [] : blocks.filter((b) => b.line > sigLine);

  let origin = labeledPlace(text, ["origin", "pick ?up(?: location)?", "shipper", "ship from"]);
  let destination = labeledPlace(text, ["destination", "deliver(?:y)?(?: to)?", "consignee", "ship to", "drop"]);

  // "Dallas, TX to Atlanta, GA"
  if (!origin || !destination) {
    const lane = text.match(new RegExp(`${PLACE}\\s+(?:to|->|→)\\s+${PLACE}`, "i"));
    if (lane) {
      origin ||= place(lane[1], lane[2], lane[3]);
      destination ||= place(lane[4], lane[5], lane[6]);
    }
  }

  // Unlabeled email (the Siemens layout): pickup is always the sender's signature address,
  // and the address in the body is the delivery. With no signature address, two body
  // addresses are read as pickup then delivery.
  const asPlace = (b) => ({ city: b.city, state: b.state, zip: b.zip, street: b.street });
  let consignee = null;
  let originFromSignature = false;
  if (!origin) {
    const o = sigBlocks[0] || (bodyBlocks.length > 1 ? bodyBlocks[0] : null);
    if (o) {
      origin = asPlace(o);
      originFromSignature = o === sigBlocks[0];
    }
  }
  if (!destination) {
    const d = originFromSignature || bodyBlocks.length < 2 ? bodyBlocks[0] : bodyBlocks[1];
    if (d) {
      destination = asPlace(d);
      consignee = { name: d.name, street: d.street, contact: d.contact };
    }
  }

  // Delivery addresses past the first one are stop-offs.
  const extraStops = () => {
    const deliveries = originFromSignature ? bodyBlocks : bodyBlocks.slice(1);
    return Math.max(0, new Set(deliveries.map((b) => `${b.city}|${b.state}|${b.zip}`.toLowerCase())).size - 1);
  };

  const equipment = EQUIPMENT.find((e) => e.re.test(text))?.type || null;
  const num = (s) => Number(String(s).replace(/,/g, ""));
  // "bs" covers the "7200bs" typo in a real email.
  const weight = text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:lbs?|bs|pounds|#)(?=\W|$)/i);
  const pieces = text.match(/\b(\d+)\s*(cs|cases?|pcs|pieces?|plts?|pallets?|skids?|crates?|boxes)\b/i);
  const miles = text.match(/\b(\d[\d,]*)\s*(?:loaded\s+)?mi(?:les)?\b/i);
  const value = text.match(/\$\s?(\d[\d,]*\.\d{2})\b/);
  // Subject lines look like "Van Load for 10/14 READY NOW 3011526620-23K".
  const subject = (text.match(/^\s*(?:subject:\s*)?([^\n]*\bload\b[^\n]*)$/im) || [])[1] || "";
  const loadFor = subject.match(/\bload\s+for\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);
  // Multi-part references look like "3010759748-41K/42K/43K/44K".
  const reference = text.match(/^\s*(\d{6,}[-\w/]*)\s*$/m) || text.match(/\b(\d{8,}-[\w/]+)/) ||
    text.match(/\b(?:pro|po|bol|ref(?:erence)?|order|load)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9-]*\d[\w-]*)/i);
  const sender = sigLine >= 0 ? lines.slice(sigLine + 1).find((l) => l.trim()) : null;

  return {
    reference: reference ? reference[1] : null,
    origin,
    originFromSignature,
    destination,
    consignee,
    equipment,
    miles: miles ? num(miles[1]) : null,
    weight: weight ? num(weight[1]) : null,
    pieces: pieces ? `${pieces[1]} ${pieces[2]}` : null,
    value: value ? num(value[1]) : null,
    hazmat: /\bhaz(?:mat|ardous)\b|\bUN\s?\d{4}\b|\bclass\s+[1-9](?:\.\d)?\b|\bplacard/i.test(text),
    stops: extraStops(),
    flags: {
      tarp: /\btarp(?:s|ed|ing)?\b/i.test(text),
      overDimensional: /\bover[- ]?dimension(?:al)?\b|\boversized?\b|\bover[- ]?width\b|\bwide load\b|\bpermit load\b/i.test(text),
      team: /\bteam\s+(?:drivers?|service|required|needed|run|load)\b|\bteams? only\b/i.test(text),
      dropTrailer: /\bdrop(?:ped)?\s+trailer\b|\bdrop\s*(?:&|and)\s*hook\b/i.test(text),
    },
    readyNow: /\bready\s+now\b/i.test(text),
    pickup: labeledDateTime(text, "pick ?up|ship(?:ping)? date|ready", now) || (loadFor ? parseDateTime(loadFor[1], now) : null),
    delivery: labeledDateTime(text, "deliver(?:y)?(?: to)?|due|must deliver", now),
    sender: sender ? sender.trim() : null,
  };
}
