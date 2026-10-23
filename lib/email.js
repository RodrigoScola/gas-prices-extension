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
const CITY_LINE = new RegExp(`^\\s*([A-Za-z][A-Za-z .'-]*?),?\\s+(${STATES})\\b\\.?(?:\\s+(\\d{5})(?:-\\d{4})?)?(?:,?\\s*(?:USA|US|United States))?\\s*$`);
const PLACE = `([A-Za-z][A-Za-z .'-]*?),?\\s+(${STATES})\\b(?:\\s+(\\d{5}))?`;

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

// Address blocks: the lines above a "City ST zip" line, plus an "Attn:" line right after it.
function addressBlocks(lines) {
  const blocks = [];
  lines.forEach((line, i) => {
    const m = line.match(CITY_LINE);
    if (!m) return;
    const above = [];
    for (let j = i - 1; j >= 0 && above.length < 2 && lines[j].trim(); j--) above.unshift(lines[j].trim());
    const attn = (lines[i + 1] || "").match(/^\s*attn:?\s*(.+)$/i);
    blocks.push({
      line: i,
      ...place(m[1], m[2], m[3]),
      street: above.find((l) => /^\d+\s/.test(l)) || null,
      name: above.find((l) => !/^\d+\s/.test(l)) || null,
      contact: attn ? attn[1].trim() : null,
    });
  });
  return blocks;
}

// Dates like 10/28/2026, 10/28, Oct 28 2026, 2026-10-28, with an optional time.
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
export function parseDateTime(s, now = new Date()) {
  if (!s) return null;
  let date = null;
  let m;
  if ((m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/))) date = new Date(+m[1], m[2] - 1, +m[3]);
  else if ((m = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear();
    date = new Date(y, m[1] - 1, +m[2]);
  } else if ((m = s.match(new RegExp(`\\b(${MONTHS})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "i")))) {
    date = new Date(m[3] ? +m[3] : now.getFullYear(), MONTHS.split("|").indexOf(m[1].toLowerCase().slice(0, 3)), +m[2]);
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
  const text = String(raw || "").replace(/\r/g, "").replace(/ /g, " ");
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

  // Unlabeled email: two addresses in the body are pickup then delivery. One address in the
  // body is the delivery, and the sender's signature address is the pickup.
  let consignee = null;
  if (!destination && bodyBlocks.length) {
    const d = bodyBlocks.length > 1 ? bodyBlocks[1] : bodyBlocks[0];
    destination = { city: d.city, state: d.state, zip: d.zip };
    consignee = { name: d.name, street: d.street, contact: d.contact };
  }
  let originGuessed = false;
  if (!origin) {
    const o = bodyBlocks.length > 1 ? bodyBlocks[0] : sigBlocks[0];
    if (o) {
      origin = { city: o.city, state: o.state, zip: o.zip };
      originGuessed = bodyBlocks.length < 2;
    }
  }

  const equipment = EQUIPMENT.find((e) => e.re.test(text))?.type || null;
  const num = (s) => Number(String(s).replace(/,/g, ""));
  const weight = text.match(/\b(\d[\d,]*(?:\.\d+)?)\s*(?:lbs?|pounds|#)(?=\W|$)/i);
  const pieces = text.match(/\b(\d+)\s*(cs|cases?|pcs|pieces?|plts?|pallets?|skids?|crates?|boxes)\b/i);
  const miles = text.match(/\b(\d[\d,]*)\s*(?:loaded\s+)?mi(?:les)?\b/i);
  const value = text.match(/\$\s?(\d[\d,]*\.\d{2})\b/);
  const reference = text.match(/^\s*(\d{6,}[-\w]*)\s*$/m) ||
    text.match(/\b(?:pro|po|bol|ref(?:erence)?|order|load)\s*(?:#|no\.?|number)?\s*[:\-]?\s*([A-Z0-9-]*\d[\w-]*)/i);
  const sender = sigLine >= 0 ? lines.slice(sigLine + 1).find((l) => l.trim()) : null;

  return {
    reference: reference ? reference[1] : null,
    origin,
    originGuessed,
    destination,
    consignee,
    equipment,
    miles: miles ? num(miles[1]) : null,
    weight: weight ? num(weight[1]) : null,
    pieces: pieces ? `${pieces[1]} ${pieces[2]}` : null,
    value: value ? num(value[1]) : null,
    hazmat: /\bhaz(?:mat|ardous)\b/i.test(text),
    pickup: labeledDateTime(text, "pick ?up|ship(?:ping)? date|ready", now),
    delivery: labeledDateTime(text, "deliver(?:y)?(?: to)?|due|must deliver", now),
    sender: sender ? sender.trim() : null,
  };
}
