# Gas Prices Quote Sidebar

Chrome extension (Manifest V3, `chrome.sidePanel`). It reads a shipping email as plain text, finds the lane rate in the Siemens bid sheet, and adds the temporary surcharge, the weekly fuel surcharge and accessorials. See [PLAN.md](PLAN.md) for the full plan and open questions.

## Build

The sidebar and settings page are React + MUI, built with Vite into `dist/`.

```bash
npm install
```

```bash
npm run build
```

`npm run watch` rebuilds on every save while you work.

## Install in Chrome

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the **`dist`** folder (not the repo root).
3. Pin the extension and click its icon to open the sidebar.
4. The Final Bid, Accepted Surcharge and fuel surcharge scale sheets are built-in defaults, copied from `private/` at build time (the same files as in the project library). To override either one, click the gear icon in the sidebar and pick a different file. **Back to default** undoes it.
5. Diesel prices and lane miles fill in automatically from free public services (EIA, US Census geocoder, OSRM), with no keys needed.

After `npm run build`, click the reload arrow on the extension's card in `chrome://extensions`.

## Use it

Open a shipping email in Gmail or Outlook on the web (work accounts on outlook.office.com / outlook.office365.com / outlook.cloud.microsoft, personal ones on outlook.live.com) with the sidebar open. It reads the email by itself, including when you switch to another email. Only Gmail and Outlook tabs are read: switching to any other tab keeps the current quote, and closing and reopening the sidebar brings it back with your edits. Miles, diesel and accessorials fill in automatically, and the total sits at the top with anything still missing listed under it. Every field can still be edited.

**Additional surcharge:** off until you switch it on. Switched on, it adds the percentage the Accepted Surcharge sheet has for the lane and equipment to the linehaul. Type a percentage to use a different one (or when the sheet has nothing for the lane).

The sun/moon button switches between system, light and dark mode.

## Fuel surcharge scale

The client sends the fuel surcharge scale as a PDF. Turn it into the .xlsx the extension reads:

```bash
pip install pypdf openpyxl
python scripts/fuel-scale-pdf-to-xlsx.py "private/Siemens FTL Fuel Surcharge Scale 2026.pdf"
```

It writes `private/Siemens FTL Fuel Surcharge Scale 2026.xlsx` (the default), and refuses a PDF whose brackets don't run back to back. A new scale can also be picked in the settings page.

## Development mode

Set `ENV = "development"` in [config.js](config.js) to get a sample email button and a paste box in the sidebar, then rebuild.

## Tests

```bash
npm test
```

213 unit tests (Node's built-in test runner, no installs), one file per part of the extension:

| File | Covers |
|---|---|
| `email.test.mjs` | Email parsing: the Siemens layout, labeled emails, lane sentences, every field, junk and huge input |
| `dates.test.mjs` | Date and time formats |
| `rates.test.mjs` | Rate sheet parsing, lane matching (city/state tiers), linehaul, temporary surcharges |
| `fuel.test.mjs` | Reading the fuel scale sheet, every bracket of it, the EIA page, the Wednesday rule, staleness |
| `miles.test.mjs` | Geocoding and routing, fallbacks and failures (network mocked) |
| `accessorials.test.mjs` | Every accessorial's detection, holidays, transit estimate, amounts |
| `quote.test.mjs` | The whole quote: totals, the additional surcharge switch, every "incomplete" message, notes, broker overrides |
| `xlsx.test.mjs` | The .xlsx reader on generated workbooks |
| `sheets.test.mjs` | Default sheets, overrides, Back to default (chrome.storage mocked) |
| `capture.test.mjs` | Reading Gmail/Outlook/selection text from the page (DOM mocked) |
| `background.test.mjs` | Toolbar button |
| `manifest.test.mjs` | Manifest, permissions for every host called, files, imports and MUI icons exist, the dist/ build |
| `real-data.test.mjs` | The real Siemens sheets, the fuel scale .xlsx checked against the PDF, and both real emails (skipped without `private/`) |

End to end: builds, then drives the real sidebar in a throwaway Chrome profile with mock Gmail and Outlook (work and personal) pages, including the surcharge switch, dark mode and the settings page (needs internet and `private/`):

```bash
npm run test:e2e
```
