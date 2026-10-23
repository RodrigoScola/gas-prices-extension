import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { captureEmailText } from "../lib/capture.js";

// captureEmailText runs inside the page, so give it a small fake page.
const el = (innerText, visible = true) => ({ innerText, offsetParent: visible ? {} : null });
function page({ host, selection = "", body = "whole page text", all = {}, one = {} }) {
  globalThis.location = { hostname: host };
  globalThis.window = { getSelection: () => ({ toString: () => selection }) };
  globalThis.document = {
    body: { innerText: body },
    querySelectorAll: (sel) => all[sel] || [],
    querySelector: (sel) => one[sel] || null,
  };
}
afterEach(() => { delete globalThis.location; delete globalThis.window; delete globalThis.document; });

test("selected text wins everywhere", () => {
  page({ host: "mail.google.com", selection: "  Pickup: Dallas, TX  ", all: { "div.a3s": [el("body")] } });
  assert.deepEqual(captureEmailText(), { text: "Pickup: Dallas, TX", source: "selection" });
});

test("Gmail: the open message body with its subject in front", () => {
  page({ host: "mail.google.com", all: { "div.a3s": [el("MEI\nFORT WORTH TX 76111")] }, one: { "h2.hP": el(" Van Load for 10/14 READY NOW 3011526620-23K ") } });
  assert.deepEqual(captureEmailText(), { text: "Subject: Van Load for 10/14 READY NOW 3011526620-23K\n\nMEI\nFORT WORTH TX 76111", source: "Gmail message" });
});

test("Gmail thread: the last visible message, not hidden or empty ones", () => {
  page({ host: "mail.google.com", all: { "div.a3s": [el("first message"), el("latest message"), el("collapsed", false), el("   ")] } });
  assert.equal(captureEmailText().text, "latest message");
});

test("Gmail with no subject element", () => {
  page({ host: "mail.google.com", all: { "div.a3s": [el("body only")] } });
  assert.equal(captureEmailText().text, "body only");
});

test("Gmail inbox with no message open: nothing to quote (not the inbox list)", () => {
  page({ host: "mail.google.com", body: "Inbox 12 Starred Sent ..." });
  assert.deepEqual(captureEmailText(), { text: null, source: "no open email" });
});

test("Outlook web: message body, with the heading as subject", () => {
  for (const host of ["outlook.office.com", "outlook.office365.com", "outlook.live.com"]) {
    page({ host, all: { '[aria-label="Message body"]': [el("Outlook body")] }, one: { '[role="main"] [role="heading"]': el("Load 123") } });
    assert.deepEqual(captureEmailText(), { text: "Subject: Load 123\n\nOutlook body", source: "Outlook message" }, host);
  }
});

test("Outlook falls back to the document role", () => {
  page({ host: "outlook.office.com", all: { '[role="document"]': [el("doc body")] } });
  assert.equal(captureEmailText().text, "doc body");
});

test("Outlook with nothing open", () => {
  page({ host: "outlook.office.com" });
  assert.deepEqual(captureEmailText(), { text: null, source: "no open email" });
});

test("any other site: the whole page's text", () => {
  page({ host: "example.com", body: "Pickup: Dallas, TX" });
  assert.deepEqual(captureEmailText(), { text: "Pickup: Dallas, TX", source: "whole page" });
});

test("returns text, never HTML", () => {
  page({ host: "mail.google.com", all: { "div.a3s": [{ innerText: "plain", innerHTML: "<b>plain</b>", offsetParent: {} }] } });
  assert.doesNotMatch(captureEmailText().text, /</);
});

test("the function is self-contained (Chrome serializes it into the page)", () => {
  const src = captureEmailText.toString();
  assert.doesNotMatch(src, /\bimport\b|\brequire\(/);
  // Rebuild it from its source alone, the way executeScript does, and run it.
  const rebuilt = new Function(`return (${src})`)();
  page({ host: "example.com", body: "ok" });
  assert.equal(rebuilt().text, "ok");
});
