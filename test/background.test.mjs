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

test("install: the toolbar icon opens the panel", async () => {
  const { calls, listeners } = await loadBackground();
  listeners.installed();
  assert.deepEqual(calls, [["behavior", { openPanelOnActionClick: true }]]);
});
