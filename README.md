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
node test/run.mjs
```

Tests against the real sheets run when they're in `private/`. That folder is git-ignored so client data stays out of the repo.
