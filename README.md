# Gas Prices Quote Sidebar

Chrome extension (Manifest V3, `chrome.sidePanel`). It reads a shipping email as plain text, finds the lane rate in the Siemens bid sheet, and adds the temporary surcharge, the weekly fuel surcharge and accessorials. See [PLAN.md](PLAN.md) for the full plan and open questions.

## Install in Chrome

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder.
3. Pin the extension and click its icon to open the sidebar.
4. The Final Bid and Accepted Surcharge sheets are built-in defaults, loaded from `private/` (the same files as in the project library). To override either one, click **Data & settings** in the sidebar (it opens the extension's options page) and pick a different file. **Back to default** undoes it.
5. Diesel prices and lane miles fill in automatically from free public services (EIA, US Census geocoder, OSRM), with no keys needed.

## Use it

Open a shipping email in Gmail with the sidebar open. It reads the email by itself, including when you switch to another email. Miles, diesel and accessorials fill in automatically. Every field can still be edited, and the quote updates as you type. For text outside Gmail, select it, right-click, and pick **Quote this shipment**.

## Development mode

Set `ENV = "development"` in [config.js](config.js) to get a sample email button and a paste box in the sidebar. Reload the extension after changing it.

## Tests

```bash
npm test
```

188 unit tests (Node's built-in test runner, no installs), one file per part of the extension:

| File | Covers |
|---|---|
| `email.test.mjs` | Email parsing: the Siemens layout, labeled emails, lane sentences, every field, junk and huge input |
| `dates.test.mjs` | Date and time formats |
| `rates.test.mjs` | Rate sheet parsing, lane matching (city/state tiers), linehaul, temporary surcharges |
| `fuel.test.mjs` | Every bracket of the fuel surcharge scale, the EIA page, the Wednesday rule, staleness |
| `miles.test.mjs` | Geocoding and routing, fallbacks and failures (network mocked) |
| `accessorials.test.mjs` | Every accessorial's detection, holidays, transit estimate, amounts |
| `quote.test.mjs` | The whole quote: totals, every "incomplete" message, notes, broker overrides |
| `xlsx.test.mjs` | The .xlsx reader on generated workbooks |
| `sheets.test.mjs` | Default sheets, overrides, Back to default (chrome.storage mocked) |
| `capture.test.mjs` | Reading Gmail/Outlook/selection text from the page (DOM mocked) |
| `background.test.mjs` | Toolbar button and right-click menu |
| `manifest.test.mjs` | Manifest, permissions for every host called, files and imports exist |
| `real-data.test.mjs` | The real Siemens sheets, fuel PDF and both real emails (skipped without `private/`) |

End to end, in a throwaway Chrome profile with a mock Gmail page (needs internet and `private/`):

```bash
npm run test:e2e
```
