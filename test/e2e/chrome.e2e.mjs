// End-to-end: loads the extension into a throwaway Chrome profile (your own Chrome profile is
// not touched) and drives the real sidebar, including the automatic Gmail read. Requests to
// mail.google.com are answered with a mock Gmail page, so no account is needed. Miles and
// diesel come from the live public services, so this needs internet.
//
//   npm run test:e2e            (builds dist/ first; set CHROME=path/to/chrome to pick a browser)
//
// Needs the real emails and sheets in private/. Screenshots go to test/e2e/screenshots/.
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const extDir = path.join(repo, "dist"); // the built extension (npm run build)
const outDir = fileURLToPath(new URL("./screenshots/", import.meta.url));
const chrome = process.env.CHROME || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find(existsSync);
if (!chrome) { console.log("SKIP: Chrome not found (set CHROME)."); process.exit(0); }
if (!existsSync(path.join(extDir, "manifest.json"))) { console.log("Build first: npm run build"); process.exit(1); }
if (!existsSync(path.join(repo, "private", "email-real-2.txt"))) { console.log("SKIP: real emails not in private/."); process.exit(0); }
mkdirSync(outDir, { recursive: true });
const profile = mkdtempSync(path.join(tmpdir(), "quote-e2e-"));

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log("ok  ", name);
  } catch (err) {
    failures++;
    console.log("FAIL", name, "\n     " + err.message.split("\n").slice(0, 6).join("\n     "));
  }
};

// ---------- DevTools over a pipe ----------

const proc = spawn(chrome, [
  `--user-data-dir=${profile}`, "--remote-debugging-pipe", "--enable-unsafe-extension-debugging",
  "--no-first-run", "--no-default-browser-check", "about:blank",
], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
const toChrome = proc.stdio[3], fromChrome = proc.stdio[4];
let buf = "", nextId = 1;
const pending = new Map();
const listeners = [];
fromChrome.on("data", (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf("\0")) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  toChrome.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(url) {
  const { targetId } = await send("Target.createTarget", { url });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Runtime.enable", {}, sessionId);
  await send("Page.enable", {}, sessionId);
  return { targetId, sessionId };
}
async function evalIn(sessionId, expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(sessionId, name) {
  await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 1500, deviceScaleFactor: 1, mobile: false }, sessionId);
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, sessionId);
  writeFileSync(path.join(outDir, name), Buffer.from(data, "base64"));
}
// Wait until a condition on the sidebar holds (network lookups take a few seconds).
async function waitFor(fn, what, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(300);
  }
  console.log(`     (timed out waiting for ${what})`);
}

// ---------- mock Gmail ----------

const emails = {
  one: readFileSync(path.join(repo, "private", "email-real-1.txt"), "utf8"),
  two: readFileSync(path.join(repo, "private", "email-real-2.txt"), "utf8"),
};
const subjects = { one: "Van Load for 10/14 READY NOW 3011526620-23K", two: "Van Load for 10/14 @ READY NOW 3010759748-41K/42K/43K/44K" };
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const gmailPage = (which) => `<!doctype html><title>Gmail</title><div role="navigation">Inbox (12)</div>
<h2 class="hP">${esc(subjects[which])}</h2>
<div class="a3s">${esc(emails[which].replace(/^Subject:.*\n/, "")).split("\n").map((l) => `<div>${l || "<br>"}</div>`).join("")}</div>`;

// ---------- run ----------

try {
  const { id: extId } = await send("Extensions.loadUnpacked", { path: extDir });
  const base = `chrome-extension://${extId}`;

  // Any uncaught error on a page fails the run.
  const pageErrors = [];
  listeners.push((msg) => {
    if (msg.method === "Runtime.exceptionThrown") pageErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") pageErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(" "));
  });

  const panel = await open(`${base}/sidepanel/index.html`);
  const P = (e) => evalIn(panel.sessionId, e);
  await waitFor(async () => P(`!!document.getElementById("captureNote")`).catch(() => false), "the sidebar to render");
  if (pageErrors.length) console.log("page errors:\n  " + pageErrors.join("\n  "));
  const dump = () => P(`({
    capture: document.getElementById("captureNote").textContent,
    devToolsShown: !document.getElementById("devTools").hidden,
    textBoxShown: !!document.getElementById("email")?.offsetParent,
    sampleShown: !!document.getElementById("loadSample")?.offsetParent,
    settingsButton: !!document.getElementById("openSettings")?.offsetParent,
    themeButton: document.querySelector("[data-mode]")?.dataset.mode,
    background: getComputedStyle(document.body).backgroundColor,
    accessorialRowsShown: [...document.querySelectorAll(".acc")].filter(r => getComputedStyle(r).visibility !== "hidden" && r.closest(".MuiCollapse-root")?.getBoundingClientRect().height !== 0).length,
    accessorialToggle: !!document.getElementById("toggleAccessorials"),
    details: [...document.querySelectorAll("#details dt")].map(dt => dt.textContent + ": " + dt.nextElementSibling.textContent).join(" | "),
    miles: document.getElementById("miles").value,
    milesNote: document.getElementById("milesNote").textContent,
    lane: document.getElementById("laneResult").textContent,
    fuel: document.getElementById("fuelResult").textContent,
    accessorials: [...document.querySelectorAll(".acc")].filter(r => r.querySelector("input").checked || r.dataset.reason).map(r => r.querySelector(".acc-label").textContent + " (" + r.dataset.reason + ")"),
    quote: [...document.querySelectorAll("#quoteDetails dt")].map(dt => dt.textContent + ": " + dt.nextElementSibling.textContent).join(" | "),
    problems: document.getElementById("problems").hidden ? [] : [...document.querySelectorAll("#problemList li")].map(li => li.textContent),
  })`);

  await waitFor(async () => /EIA weekly page/.test((await dump()).fuel), "diesel price");
  let s = await dump();
  check("production: no sample button or paste box; settings and theme buttons", () => {
    assert.equal(s.devToolsShown, false);
    assert.equal(s.sampleShown, false);
    assert.equal(s.textBoxShown, false);
    assert.equal(s.settingsButton, true);
    assert.equal(s.themeButton, "system");
  });
  check("no email yet: says so", () => {
    assert.match(s.capture, /Open a shipping email in Gmail/);
    assert.match(s.problems[0], /^Email: no shipping email read yet/);
  });
  check("diesel fetched from EIA by itself", () => assert.match(s.fuel, /\/mile surcharge\. Source: EIA weekly page, week of \d{4}-\d{2}-\d{2}/));
  await shot(panel.sessionId, "empty.png");

  // Gmail tab: every mail.google.com request gets the mock page.
  const { targetId: gTarget } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId: g } = await send("Target.attachToTarget", { targetId: gTarget, flatten: true });
  await send("Fetch.enable", { patterns: [{ urlPattern: "https://mail.google.com/*" }] }, g);
  listeners.push(async (msg) => {
    if (msg.method !== "Fetch.requestPaused" || msg.sessionId !== g) return;
    await send("Fetch.fulfillRequest", {
      requestId: msg.params.requestId, responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
      body: Buffer.from(gmailPage("one")).toString("base64"),
    }, g);
  });
  await send("Page.enable", {}, g);
  await send("Page.navigate", { url: "https://mail.google.com/mail/u/0/#inbox/one" }, g);
  await sleep(1500);
  await send("Target.activateTarget", { targetId: gTarget });
  await waitFor(async () => /Driving/.test((await dump()).milesNote), "email 1 miles");
  s = await dump();
  check("switching to Gmail reads email 1 by itself", () => {
    assert.equal(s.capture, "Read from: Gmail message.");
    assert.match(s.details, /Reference: 3011526620-23K/);
    assert.match(s.details, /Pickup: Grand Prairie, TX 75050 \(sender's address\)/);
    assert.match(s.details, /Delivery: Fort Worth, TX 76111/);
    assert.match(s.details, /Equipment: Dry van\/tractor trailer/);
  });
  check("email 1: miles from the route and a complete quote", () => {
    assert.match(s.milesNote, /^Driving miles from the street address\.$/);
    assert.equal(s.lane, "Lane matched city to city: minimum $500.00.");
    assert.match(s.quote, /^Linehaul \(minimum charge\): \$500\.00 \| Temporary surcharge 10%: \$50\.00 \| Fuel \(\d+ mi × \$\d\.\d\d\): \$[\d.,]+ \| Total: \$[\d.,]+$/);
    assert.deepEqual(s.problems, []);
  });
  check("nothing detected: all 15 accessorials are listed, no Show all button", () => {
    assert.equal(s.accessorialRowsShown, 15);
    assert.equal(s.accessorialToggle, false);
  });
  await shot(panel.sessionId, "email-1.png");

  // Click another email the way Gmail does: swap the DOM and change the hash.
  await evalIn(g, `
    const doc = new DOMParser().parseFromString(${JSON.stringify(gmailPage("two"))}, "text/html");
    document.querySelector("h2.hP").replaceWith(doc.querySelector("h2.hP"));
    document.querySelector("div.a3s").replaceWith(doc.querySelector("div.a3s"));
    location.hash = "#inbox/two";`);
  await waitFor(async () => { const x = await dump(); return /Itasca/.test(x.details) && /Driving/.test(x.milesNote); }, "email 2 miles");
  s = await dump();
  check("clicking another email in Gmail re-reads it", () => {
    assert.match(s.details, /Reference: 3010759748-41K\/42K\/43K\/44K/);
    assert.match(s.details, /Delivery: Itasca, IL 60143/);
  });
  check("email 2: per-mile lane with the 20% surcharge", () => {
    assert.equal(s.lane, "Lane matched city to city: $1.43/mile.");
    assert.match(s.quote, /^Linehaul \(per mile\): \$[\d,.]+ \| Temporary surcharge 20%: \$[\d,.]+ \| Fuel \(\d+ mi/);
    assert.ok(Number(s.miles) > 850 && Number(s.miles) < 1050, `miles ${s.miles}`);
    assert.deepEqual(s.problems, []);
  });
  await shot(panel.sessionId, "email-2.png");

  // Right-click: what the context menu hands the panel.
  await P(`chrome.storage.session.set({ pendingEmail: { text: "Flatbed load, needs tarps.\\nPickup: Laredo, TX 78040\\nDeliver to: Fort Worth, TX 76111\\nPickup date: 10/31/2026 5:00 AM\\nhazmat UN1993", at: Date.now() } })`);
  await waitFor(async () => { const x = await dump(); return /Laredo/.test(x.details) && /Driving/.test(x.milesNote); }, "right-click miles");
  s = await dump();
  check("right-click selection is quoted", () => assert.equal(s.capture, "Read from: right-click selection."));
  check("accessorials detected from the email", () => {
    const on = s.accessorials.join(" | ");
    for (const want of ["Weekend pickup (pickup Saturday, 10/31)", "After-hours pickup", "Tarp (flatbed", "Hazmat (email mentions hazmat)"]) assert.ok(on.includes(want), want);
    assert.match(s.quote, /Weekend pickup: \$200\.00 \| After-hours pickup: \$250\.00 \| Tarp: \$100\.00 \| Hazmat: \$50\.00/);
  });
  check("something detected: only those show, the rest behind Show all", () => {
    assert.equal(s.accessorialRowsShown, 5);
    assert.equal(s.accessorialToggle, true);
  });
  await shot(panel.sessionId, "right-click.png");

  // Typing a lane with no match spells out the problem.
  // (React inputs need the native value setter for a typed value to register.)
  await P(`(() => {
    const d = document.getElementById("destination");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(d, "Honolulu, HI");
    d.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);
  await sleep(800);
  s = await dump();
  check("a lane that isn't in the sheet is named in the problems", () => assert.ok(s.problems.some((p) => /^Rate sheet: no lane for Laredo, TX → Honolulu, HI/.test(p)), s.problems.join(" / ")));

  // A wide sidebar: the cards stretch to its full width instead of centering.
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }, panel.sessionId);
  await sleep(300);
  const widths = await P(`[document.body.clientWidth, document.getElementById("quote").getBoundingClientRect().width]`);
  check("cards fill the sidebar's width when it's wide", () => assert.ok(widths[0] - widths[1] <= 32, `body ${widths[0]}px, card ${widths[1]}px`));

  // Theme: system -> light -> dark, remembered for the settings page too.
  await P(`document.querySelector("[data-mode]").click()`);
  await sleep(300);
  const lightBg = (await dump()).background;
  await shot(panel.sessionId, "light.png");
  await P(`document.querySelector("[data-mode]").click()`);
  await sleep(400);
  s = await dump();
  check("theme button switches to dark mode", () => {
    assert.equal(s.themeButton, "dark");
    assert.notEqual(s.background, lightBg);
    const [r, g, b] = s.background.match(/\d+/g).map(Number);
    assert.ok(r + g + b < 120, `dark background, got ${s.background}`);
  });
  await shot(panel.sessionId, "dark.png");

  // Settings page.
  const opts = await open(`${base}/options/index.html`);
  await waitFor(async () => evalIn(opts.sessionId, `!!document.querySelector("[data-mode]") && !!document.getElementById("rateSheetStatus")`).catch(() => false), "the settings page to render");
  const optsMode = await evalIn(opts.sessionId, `document.querySelector("[data-mode]").dataset.mode`);
  check("settings page picks up the dark mode setting", () => assert.equal(optsMode, "dark"));
  const o = await evalIn(opts.sessionId, `[document.getElementById("rateSheetStatus").textContent, document.getElementById("tempSurchargesStatus").textContent, document.getElementById("rateSheetDefault").hidden, document.getElementById("tempSurchargesDefault").hidden]`);
  check("settings page: both sheets on their defaults", () => {
    assert.equal(o[0], "Default: Siemens FTL Final Bid 2026.xlsx, 3,197 lanes.");
    assert.equal(o[1], "Default: Siemens Accepted Surcharge.xlsx, 116 surcharges.");
    assert.equal(o[2], true);
    assert.equal(o[3], true);
  });
  await shot(opts.sessionId, "settings.png");
  check("no errors on any page", () => assert.deepEqual(pageErrors, []));
} catch (err) {
  failures++;
  console.error("FAILED:", err.message);
} finally {
  try { await send("Browser.close"); } catch {}
  setTimeout(() => {
    proc.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
    console.log(failures ? `\n${failures} e2e check(s) failed.` : "\nAll e2e checks passed.");
    process.exit(failures ? 1 : 0);
  }, 1000);
}
