# Gas Prices Quote Sidebar

Chrome extension (Manifest V3, `chrome.sidePanel`). It reads a shipping email as plain text, finds the lane rate in the Siemens bid sheet, and adds the temporary surcharge, the weekly fuel surcharge and accessorials. See [PLAN.md](PLAN.md) for the full plan and open questions.

## Install in Chrome

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick this folder.
3. Pin the extension and click its icon to open the sidebar.
4. The Final Bid and Accepted Surcharge sheets load automatically from `private/` (the same files as in the project library). To use newer versions, load them under **Data & settings**.
5. Diesel prices and lane miles fill in automatically from free public services (EIA, US Census geocoder, OSRM), with no keys needed.

## Use it

- Open an email and click **Read open email**, or
- select the email text, right-click, and pick **Quote this shipment**, or
- paste the text into the box.

Every field can be edited, and the quote updates as you type.

## Tests

```bash
node test/run.mjs
```

Tests against the real sheets run when they're in `private/`. That folder is git-ignored so client data stays out of the repo.
