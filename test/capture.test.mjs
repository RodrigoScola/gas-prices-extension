import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { captureEmailText, isGmail, isMailTab, mailApp } from "../lib/capture.js";

test("Gmail and Outlook (work and personal) tabs are read automatically, nothing else", () => {
  const yes = {
    "https://mail.google.com/mail/u/0/#inbox/FMfcgz": "Gmail",
    "https://mail.google.com/mail/u/1/": "Gmail",
    "https://outlook.office.com/mail/inbox/id/AAQk": "Outlook", // work (Microsoft 365)
    "https://outlook.office365.com/mail/": "Outlook", // work
    "https://outlook.cloud.microsoft/mail/": "Outlook", // work, newer address
    "https://outlook.live.com/mail/0/inbox": "Outlook", // personal (outlook.com, hotmail)
  };
  for (const [u, app] of Object.entries(yes)) {
    assert.equal(mailApp(u), app, u);
    assert.equal(isMailTab(u), true, u);
  }
  for (const u of ["https://example.com/?q=https://mail.google.com/", "http://mail.google.com/", "https://mail.google.com.evil.com/",
    "https://outlook.office.com.evil.com/", "https://evil.com/outlook.live.com/", "https://www.microsoft.com/outlook/", "chrome://newtab/", "", undefined]) {
    assert.equal(isMailTab(u), false, String(u));
  }
  assert.equal(isGmail("https://mail.google.com/mail/u/0/"), true);
  assert.equal(isGmail("https://outlook.live.com/mail/0/"), false);
});

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

test("Outlook web, work and personal: message body, with the heading as subject", () => {
  for (const host of ["outlook.office.com", "outlook.office365.com", "outlook.cloud.microsoft", "outlook.live.com"]) {
    page({ host, all: { '[aria-label="Message body"]': [el("Outlook body")] }, one: { '[role="main"] [role="heading"][aria-level="2"]': el("Van Load for 10/14") } });
    assert.deepEqual(captureEmailText(), { text: "Subject: Van Load for 10/14\n\nOutlook body", source: "Outlook message" }, host);
  }
});

test("Outlook subject: falls back through the heading selectors", () => {
  page({ host: "outlook.live.com", all: { '[aria-label="Message body"]': [el("b")] }, one: { '#ReadingPaneContainerId [role="heading"]': el("From the reading pane") } });
  assert.equal(captureEmailText().text, "Subject: From the reading pane\n\nb");
  page({ host: "outlook.live.com", all: { '[aria-label="Message body"]': [el("b")] }, one: { '[role="main"] [role="heading"][aria-level="2"]': el("  "), '[role="main"] [role="heading"]': el("Any heading") } });
  assert.equal(captureEmailText().text, "Subject: Any heading\n\nb", "an empty heading is skipped");
});

test("Outlook conversation: the first visible message is the newest", () => {
  page({ host: "outlook.office.com", all: { '[aria-label="Message body"]': [el("collapsed", false), el("newest"), el("older")] } });
  assert.equal(captureEmailText().text, "newest");
});

test("Outlook falls back to the document role inside the main area", () => {
  page({ host: "outlook.office.com", all: { '[role="main"] [role="document"]': [el("doc body")] } });
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
