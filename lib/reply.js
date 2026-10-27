// Step 1 of the workflow: a reply to the customer with the rate, ready to paste into Gmail.
import { money } from "./quote.js";

const firstName = (sender) => (sender ? sender.trim().split(/\s+/)[0] : null);
const dateText = (x) => x?.date?.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// details: parseEmail() result; quote: computeQuote() result; lane: { origin, destination, equipment }.
export function buildReply({ details, quote, lane, miles, equipmentLabel }) {
  const hi = firstName(details?.sender);
  const ref = details?.reference;
  const out = [];
  out.push(hi ? `Hi ${hi},` : "Hi,", "");
  out.push(ref ? `Thanks for the load. Here's our rate for ${ref}:` : "Thanks for the load. Here's our rate:", "");
  out.push(`${lane.origin} → ${lane.destination}`);
  const facts = [equipmentLabel || lane.equipment, miles ? `${Number(miles).toLocaleString()} miles` : null,
    details?.weight ? `${details.weight.toLocaleString()} lbs` : null, details?.pieces].filter(Boolean);
  if (facts.length) out.push(facts.join(" · "));
  if (dateText(details?.pickup)) out.push(`Pickup ${dateText(details.pickup)}${details.readyNow ? " (ready now)" : ""}`);
  out.push("");
  const rows = quote.lines.filter(([, , cls]) => cls !== "total");
  const width = Math.max(...rows.map(([l]) => l.replace(/ \(.*\)$/, "").length), "All-in total".length);
  for (const [label, value] of rows) out.push(`${label.replace(/ \(.*\)$/, "").padEnd(width)}  ${value}`);
  out.push(`${"All-in total".padEnd(width)}  ${money(quote.total)}`, "");
  if (quote.fuel) out.push(`Fuel is based on this week's DOE diesel average, ${money(quote.fuel.perMile)}/mile.`);
  out.push("Let me know if you'd like to book it.", "", "Thanks,");
  return out.join("\n");
}

// The quote's lines as plain text, for pasting into a TMS or a note.
export function quoteText(quote) {
  return quote.lines.map(([l, v]) => `${l}: ${v}`).join("\n");
}
