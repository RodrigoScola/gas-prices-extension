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
        api.eia.gov  ───── diesel ──▶ │        + fuel + accessorials   │
                                      └───────────────────────────────┘
   Rate sheets (.xlsx) are loaded once and kept in chrome.storage.local.
```

| Part | File | Status |
|---|---|---|
| Manifest V3 with side panel, toolbar button, right-click menu | `manifest.json`, `background.js` | Done |
| Read the open email as text (Gmail `div.a3s`, Outlook message body, selection, whole-page fallback) | `lib/capture.js` | Done. Not yet tried on a live Gmail or Outlook inbox |
| Email parser: reference #, pickup, delivery, consignee, contact, weight, pieces, value, equipment, miles, dates and times, hazmat, sender | `lib/email.js` | Done for the one real sample and for labeled emails. Needs more samples |
| .xlsx reader with no library (uses Chrome's built-in `DecompressionStream`) | `lib/xlsx.js` | Done |
| Rate lookup in "Siemens FTL Final Bid 2026" (3,197 lanes, 4 equipment types, min charge + rate per mile) | `lib/rates.js` | Done |
| Temporary surcharge % from "Siemens Accepted Surcharge" (city→city, city→state, "all outbound") | `lib/rates.js` | Done |
| Fuel surcharge from the "Siemens FTL Fuel Surcharge Scale 2026" PDF, turned into a formula | `lib/fuel.js` | Done |
| Weekly diesel price from the EIA API (series `EMD_EPD2D_PTE_NUS_DPG`), or typed in by hand | `lib/fuel.js` | Done. Needs an EIA API key |
| Accessorials from "FY 2025 Siemens FTL Accessorial Schedule", auto-ticked for weekend, holiday, after-hours and hazmat | `lib/accessorials.js` | Done |
| Sidebar UI with every field editable, so the broker can fix anything the parser got wrong | `sidepanel/` | Done |
| Tests | `test/run.mjs` | 10 passing, including tests against the real sheets |

### Quote math

- **Lane:** the most specific match wins: city→city, then city→state, then state→city, then state→state. The sheet has all four kinds.
- **Linehaul:** `max(min charge, miles × rate per mile)`. If a lane only has a minimum, the minimum is used.
- **Temporary surcharge:** linehaul × the % from the accepted surcharge sheet (most specific entry wins).
- **Fuel:** miles × the surcharge per mile from the scale. That's $0.01 at $1.150–$1.199 diesel, +$0.01 for every $0.05 above that, capped at $1.28 from $7.50 up. The scale says it adjusts every Wednesday from the prior Monday's DOE price.
- **Accessorials:** the ticked items. Team driver is $100, or $0.10/mile over 1,000 miles.

### Checked so far

- `node test/run.mjs`: 10 tests pass, including the real rate and surcharge sheets.
- I loaded the extension into a separate test Chrome profile (Chrome 156, using `Extensions.loadUnpacked` over DevTools) and drove the panel:
  - The real email (Albert Harbin, 3011526620-23K) parsed to Grand Prairie, TX → Fort Worth, TX. The lane matched city to city at a $500 minimum, plus a 10% temporary surcharge, for **$550**. No miles were in the email, so there's no fuel line.
  - A labeled sample with miles (Grand Prairie → Pomona, 1,420 mi, Saturday 7pm pickup) came out to $1,320.60 linehaul + $132.06 temporary surcharge + $752.60 fuel + $200 weekend + $250 after hours, for **$2,655.26**.
  - The sheets and the diesel price survive a reload.

## Next steps, with rough estimates

| # | Work | Estimate | Blocked on |
|---|---|---|---|
| 1 | Try "Read open email" on a live inbox and tune the Gmail/Outlook selectors | 1–2 h | Which email client |
| 2 | Tune the parser with 5–10 more real emails (different senders and layouts) | 3–5 h | More sample emails |
| 3 | Miles: look up the lane distance automatically (PC*Miler, Google Distance Matrix, or a miles column in the sheet) | 4–8 h | Which source, and an API key |
| 4 | EIA key setup and the Wednesday rule (use the price published for the prior Monday) | 1 h | EIA key |
| 5 | Copy the quote to the clipboard and draft the reply to the customer | 2–3 h | What the reply should say |
| 6 | Read the sheets from Google Workspace instead of loading .xlsx files (Sheets API + OAuth) | 6–10 h | Where the sheets live, plus access |
| 7 | Specialized equipment and cross-border lanes from the Landstar sheet (Conestoga, lowboy, hotshot and more, 4,300 lanes) | 2–3 h | Whether it's needed |
| 8 | Optional: move parsing to a local API in Docker (from the meeting) | 4–6 h | Only if the parsing grows beyond the browser |
| 9 | Package and share: an icon, a private Chrome Web Store listing or a zip | 2 h | Who installs it |

## Open questions

1. **Which address is pickup and which is delivery?** In the sample, I treat the address at the top (MEI, Fort Worth) as the delivery. I treat the sender's signature address (Siemens, Grand Prairie) as the pickup. Is that always right?
2. **Equipment:** the sample email doesn't say. I default to "Dry van/tractor trailer". Is that right for these emails?
3. **Miles:** the email has none, and per-mile lanes need them. Where should miles come from?
4. **Fuel on minimum-charge lanes:** should the fuel surcharge apply when the lane is billed at the minimum? Right now it's only added when miles are known.
5. **$185,690.00:** is this the declared value of the goods, or what we get paid? I label it "Value" for now.
6. **Email client:** Gmail or Outlook web?
7. **Rate sheet:** is "Siemens FTL Final Bid 2026" the 3,100-row sheet? It has 3,197 lanes. Should the Landstar specialized sheet be used too?
8. **More samples:** a handful more real emails would make the parser much more reliable.
