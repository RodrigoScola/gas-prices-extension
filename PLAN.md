# Gas Prices Quote Sidebar: plan

## Goal

The broker opens a customer's shipping email and gets a quote in a Chrome sidebar, without hunting through spreadsheets by hand. This covers the first three steps of the workflow in `todo.txt`:

1. Respond to the customer we're working with (read the shipping email).
2. Find the equipment type and rate per mile in the 3,100-row rate sheet.
3. Look up the current fuel surcharge, which changes weekly.

The meeting notes add accessorials (weekend, holiday, after-hours, tarp and so on). They're included too, because their schedule is fixed.

Out of scope for now: building the load in the TMS, finding a carrier, BOLs, tracking, POD.

## Answers to the technical questions from the meeting

- **Is there a Manifest V4?** No. Manifest V3 is the latest and the only version Chrome accepts for new extensions.
- **Can an MV3 extension read the email?** Yes. The ad-blocker change in MV3 is about blocking network requests (`webRequestBlocking` was replaced by `declarativeNetRequest`). It doesn't stop an extension from reading a page. `chrome.scripting.executeScript` runs a small function in the open Gmail or Outlook tab and returns `element.innerText`. That gives the plain text of the email, not the HTML.
- **Is the sidebar a public API?** Yes. `chrome.sidePanel` is a stable public API since Chrome 114. This extension uses it.
- **Right-click menu:** `chrome.contextMenus` adds "Quote this shipment" when text is selected. It opens the sidebar with that text.

## How it works (built in this repo)

```
Gmail / Outlook tab                    Side panel (sidepanel/)
┌──────────────────────┐  innerText   ┌───────────────────────────────┐
│ open email           │ ───────────▶ │ 1. parse email  (lib/email.js) │
│ (or selected text,   │              │ 2. lane + rate  (lib/rates.js) │
│  via right-click)    │              │ 3. fuel         (lib/fuel.js)  │
└──────────────────────┘              │    accessorials (lib/accessorials.js)
                                      │ quote = linehaul + temp surcharge
   eia.gov weekly page ── diesel ──▶ │        + fuel + accessorials   │
   Census geocoder + OSRM ── miles ─▶ │                                │
                                      └───────────────────────────────┘
   Rate sheets (.xlsx) are loaded once and kept in chrome.storage.local.
```

| Part | File | Status |
|---|---|---|
| Manifest V3 with side panel, toolbar button, right-click menu | `manifest.json`, `background.js` | Done |
| Read the open email as text, with the subject (Gmail `div.a3s` + `h2.hP` first; Outlook later), selection, whole-page fallback | `lib/capture.js` | Done. Not yet tried on a live Gmail inbox |
| Email parser: reference #, pickup, delivery, consignee, contact, weight, pieces, value, equipment, miles, dates and times, hazmat, sender | `lib/email.js` | Done for the one real sample and for labeled emails. Needs more samples |
| .xlsx reader with no library (uses Chrome's built-in `DecompressionStream`) | `lib/xlsx.js` | Done |
| Rate lookup in "Siemens FTL Final Bid 2026" (3,197 lanes, 4 equipment types, min charge + rate per mile) | `lib/rates.js` | Done |
| Temporary surcharge % from "Siemens Accepted Surcharge" (city→city, city→state, "all outbound") | `lib/rates.js` | Done |
| Fuel surcharge from the "Siemens FTL Fuel Surcharge Scale 2026" PDF, turned into a formula | `lib/fuel.js` | Done |
| Weekly diesel price from EIA's public weekly page (series `EMD_EPD2D_PTE_NUS_DPG`, no key), with the Wednesday rule; can be typed in by hand | `lib/fuel.js` | Done |
| Lane miles: US Census geocoder for the street address (OpenStreetMap Nominatim for city/zip only), then OSRM driving distance, all free with no keys; saved per lane | `lib/miles.js` | Done. Car routes, not truck routes |
| Fuel on minimum-charge lanes: off by default, with a toggle | `sidepanel/` | Done. Waiting on Aidan |
| Accessorials from "FY 2025 Siemens FTL Accessorial Schedule", auto-ticked for weekend, holiday, after-hours and hazmat | `lib/accessorials.js` | Done |
| Sidebar UI with every field editable, so the broker can fix anything the parser got wrong | `sidepanel/` | Done |
| Tests | `test/run.mjs` | 13 passing, including tests against the real sheets and both real emails |

### Quote math

- **Lane:** the most specific match wins: city→city, then city→state, then state→city, then state→state. The sheet has all four kinds.
- **Linehaul:** `max(min charge, miles × rate per mile)`. If a lane only has a minimum, the minimum is used.
- **Temporary surcharge:** linehaul × the % from the accepted surcharge sheet (most specific entry wins).
- **Fuel:** miles × the surcharge per mile from the scale (not charged on minimum-charge lanes unless the toggle is on). That's $0.01 at $1.150–$1.199 diesel, +$0.01 for every $0.05 above that, capped at $1.28 from $7.50 up. The scale says it adjusts every Wednesday from the prior Monday's DOE price.
- **Accessorials:** the ticked items. Team driver is $100, or $0.10/mile over 1,000 miles.

### Checked so far

- `node test/run.mjs`: 13 tests pass, including the real rate and surcharge sheets.
- I loaded the extension into a separate test Chrome profile (Chrome 156, using `Extensions.loadUnpacked` over DevTools) and drove the panel against the live APIs on 2026-10-23. Diesel came back as $6.276 for the week of 10/19, which gives a $1.03/mile fuel surcharge.
  - Real email 1 (3011526620-23K, MEI, Fort Worth) is 20 miles. It's billed at the $500 minimum plus the 10% temporary surcharge, for **$550**. With fuel on minimum lanes turned on, it's $570.60.
  - Real email 2 (3010759748-41K/42K/43K/44K, RDI, Itasca IL) is 934 miles. That's $1,335.62 linehaul + $267.12 (20% temporary surcharge) + $962.02 fuel, for **$2,564.76**.
  - The sheets, the diesel price and the miles survive a reload.

## Next steps, with rough estimates

| # | Work | Estimate | Blocked on |
|---|---|---|---|
| 1 | Try "Read open email" on a live Gmail inbox and tune the selectors | 1–2 h | Gmail access |
| 2 | Tune the parser with 5–10 more real emails (different senders and layouts) | 3–5 h | More sample emails |
| 3 | Truck miles: switch to PC*Miler or a similar service if car-route miles (OSRM) aren't close enough. Also host our own routing, because OSRM's public server is only meant for light use | 4–8 h | Whether car miles are acceptable |
| 4 | Outlook web support | 1–2 h | After Gmail |
| 5 | Copy the quote to the clipboard and draft the reply to the customer | 2–3 h | What the reply should say |
| 6 | Read the sheets from Google Workspace instead of loading .xlsx files (Sheets API + OAuth) | 6–10 h | Where the sheets live, plus access |
| 7 | Specialized equipment and cross-border lanes from the Landstar sheet (Conestoga, lowboy, hotshot and more, 4,300 lanes) | 2–3 h | Whether it's needed |
| 8 | Optional: move parsing to a local API in Docker (from the meeting) | 4–6 h | Only if the parsing grows beyond the browser |
| 9 | Package and share: an icon, a private Chrome Web Store listing or a zip | 2 h | Who installs it |

## Decided (Rodrigo, 2026-10-23)

- Gmail first, Outlook later.
- Pickup is always the sender's Grand Prairie address, and the address block in the email is the delivery.
- The $ amount in the email is the value of the goods.
- Miles and diesel come from free public APIs.

## Open questions

1. **Fuel on minimum-charge lanes:** does the fuel surcharge apply when a lane is billed at its minimum? It's off by default with a toggle (ask Aidan or the client).
2. **Car vs truck miles:** are OSRM car-route miles close enough, or does the client bill on PC*Miler miles?
3. **Equipment words:** I read "Van Load…" in the subject as dry van. What do flatbed, step deck and reefer subjects say?
4. **Rate sheet:** is "Siemens FTL Final Bid 2026" (3,197 lanes) the 3,100-row sheet? Should the Landstar specialized sheet be used too?
5. **More samples:** a handful more real emails would make the parser much more reliable.
