import { test } from "node:test";
import assert from "node:assert/strict";
import { fakeChrome } from "./helpers.mjs";

// background.js registers listeners when it loads; capture them with a fake chrome.
async function loadBackground() {
  const { chrome } = fakeChrome();
  const calls = [];
  const listeners = {};
  const on = (name) => ({ addListener: (fn) => { listeners[name] = fn; } });
  chrome.runtime.onInstalled = on("installed");
  chrome.contextMenus = { create: (x) => calls.push(["menu", x]), onClicked: on("clicked") };
  chrome.sidePanel = {
    setPanelBehavior: (x) => calls.push(["behavior", x]),
    open: (x) => calls.push(["open", x]),
  };
  const set = chrome.storage.session.set;
  chrome.storage.session.set = async (x) => { calls.push(["store", x]); return set(x); };
  globalThis.chrome = chrome;
  await import(`../background.js?case=${Math.random()}`);
  return { chrome, calls, listeners };
}

test("install: the toolbar icon opens the panel, and the right-click item is added", async () => {
  const { calls, listeners } = await loadBackground();
  listeners.installed();
  assert.deepEqual(calls, [
    ["behavior", { openPanelOnActionClick: true }],
    ["menu", { id: "quote-selection", title: "Quote this shipment", contexts: ["selection"] }],
  ]);
});

test("right-click: opens the panel first (needs the click), then hands it the text", async () => {
  const { calls, listeners, chrome } = await loadBackground();
  listeners.clicked({ menuItemId: "quote-selection", selectionText: "Pickup: Dallas, TX" }, { windowId: 7 });
  assert.deepEqual(calls[0], ["open", { windowId: 7 }]);
  assert.equal(calls[1][0], "store");
  const { pendingEmail } = await chrome.storage.session.get("pendingEmail");
  assert.equal(pendingEmail.text, "Pickup: Dallas, TX");
  assert.ok(Date.now() - pendingEmail.at < 5000);
});

test("other menu items are ignored", async () => {
  const { calls, listeners } = await loadBackground();
  listeners.clicked({ menuItemId: "something-else", selectionText: "x" }, { windowId: 1 });
  assert.deepEqual(calls, []);
});
