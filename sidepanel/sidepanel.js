import { FEATURES } from "../config.js";
import { parseEmail } from "../lib/email.js";
import { captureEmailText } from "../lib/capture.js";
import { loadSheets } from "../lib/sheets.js";
import { findLane, matchEquipment, linehaul, findTempSurcharge } from "../lib/rates.js";
import { fscPerMile, fetchDieselPricePublic, isStale } from "../lib/fuel.js";
import { laneMiles, addressText } from "../lib/miles.js";
import { ACCESSORIALS, detectAccessorials, accessorialAmount } from "../lib/accessorials.js";

const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const store = chrome.storage.local;

const state = {
  rateSheet: null, // { equipmentTypes, lanes, fileName, isDefault }
  tempSurcharges: null, // { list, fileName, isDefault }
  fuel: null, // { price, week, source }
  fuelError: null,
  milesCache: {}, // "from|to" -> { miles, precision }
  milesError: null,
  milesBusy: false,
  details: null,
  emailText: null,
  equipmentFromEmail: false,
  overrides: new Map(), // accessorial id -> checked, set by the broker for this email
};

// ---------- helpers ----------

function renderList(el, pairs) {
  el.replaceChildren();
  for (const [label, value, cls] of pairs) {
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = label;
    dd.textContent = value ?? "not found";
    dd.className = cls || (value == null ? "missing" : "");
    el.append(dt, dd);
  }
}

// Items are [boldPart, rest] so the section name stands out.
function renderItems(el, items) {
  el.replaceChildren(...items.map(([where, what]) => {
    const li = document.createElement("li");
    const b = document.createElement("b");
    b.textContent = where + ": ";
    li.append(b, what);
    return li;
  }));
}

const placeText = (p) => (p ? `${p.city}, ${p.state}` : "");
function parsePlace(s) {
  const m = String(s).match(/^\s*(.+?),?\s+([A-Za-z]{2})\s*(\d{5})?\s*$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : null;
}
function setStatus(el, text, cls = "muted") {
  el.textContent = text;
  el.className = cls;
}

// ---------- step 1: read the email ----------

function useEmail(text, source) {
  if (text === state.emailText) return; // same email, keep the broker's edits
  state.emailText = text;
  if (FEATURES.emailTextBox) $("email").value = text;
  state.details = parseEmail(text);
  state.overrides = new Map();
  const d = state.details;
  $("origin").value = placeText(d.origin);
  $("destination").value = placeText(d.destination);
  $("miles").value = d.miles || "";
  state.milesError = null;
  setStatus($("milesNote"), d.miles ? "Miles from the email." : "");
  const types = state.rateSheet?.equipmentTypes || [];
  const matched = matchEquipment(types, d.equipment);
  state.equipmentFromEmail = !!matched;
  $("equipment").value = matched || types[0] || "";
  setStatus($("captureNote"), `Read from: ${source}.`);

  const fmtDT = (x) => x && [x.date?.toLocaleDateString(), x.minutes != null ? `${String(Math.floor(x.minutes / 60)).padStart(2, "0")}:${String(x.minutes % 60).padStart(2, "0")}` : null].filter(Boolean).join(" ");
  renderList($("details"), [
    ["Reference", d.reference],
    ["Pickup", d.origin ? `${placeText(d.origin)} ${d.origin.zip || ""}${d.originFromSignature ? " (sender's address)" : ""}` : null],
    ["Delivery", d.destination ? `${placeText(d.destination)} ${d.destination.zip || ""}` : null],
    ["Consignee", d.consignee ? [d.consignee.name, d.consignee.street].filter(Boolean).join(", ") : null],
    ["Contact", d.consignee?.contact ?? null],
    ["Weight", d.weight ? `${d.weight.toLocaleString()} lbs` : null],
    ["Pieces", d.pieces],
    ["Value of goods", d.value != null ? money(d.value) : null],
    ["Equipment", d.equipment],
    ["Ready", d.readyNow ? "Ready now" : null],
    ["Pickup date", fmtDT(d.pickup) || null],
    ["Delivery date", fmtDT(d.delivery) || null],
    ["Sender", d.sender],
  ].filter(([label, value]) => value != null || ["Reference", "Pickup", "Delivery", "Weight", "Equipment"].includes(label)));
  render();
  if (!d.miles) getMiles();
}

// Reads the open email in the active tab. Gmail fills in the message after the URL changes,
// so an empty read is retried a few times.
let readRun = 0;
async function readActiveTab(attempt = 0) {
  const run = attempt === 0 ? ++readRun : readRun;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureEmailText });
    if (run !== readRun) return;
    if (result?.text) return useEmail(result.text, result.source);
    if (result?.source === "no open email" && attempt < 4) return setTimeout(() => readActiveTab(attempt + 1), 700);
    if (!state.emailText) setStatus($("captureNote"), "Open a shipping email in Gmail. You can also select an email's text, right-click, and pick “Quote this shipment”.", "muted warn");
  } catch {
    // Pages Chrome won't let extensions read (new tab, chrome://, the Web Store).
    if (run === readRun && !state.emailText) setStatus($("captureNote"), "Open a shipping email in Gmail to quote it.", "muted warn");
  }
}

let tabTimer;
const readSoon = () => {
  clearTimeout(tabTimer);
  tabTimer = setTimeout(() => readActiveTab(), 400);
};
chrome.tabs.onActivated.addListener(readSoon);
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (tab.active && (info.url || info.status === "complete")) readSoon();
});

async function takePending() {
  const { pendingEmail } = await chrome.storage.session.get("pendingEmail");
  if (!pendingEmail) return false;
  await chrome.storage.session.remove("pendingEmail");
  useEmail(pendingEmail.text, "right-click selection");
  return true;
}
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingEmail?.newValue) takePending();
});

// Development only: a sample email and a paste box.
if (FEATURES.sampleEmail) {
  $("devTools").hidden = false;
  $("loadSample").addEventListener("click", async () => {
    useEmail(await (await fetch(chrome.runtime.getURL("sample/email-sample.txt"))).text(), "sample email");
  });
}
if (FEATURES.emailTextBox) {
  $("email").hidden = false;
  let typing;
  $("email").addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => useEmail($("email").value, "pasted text"), 400);
  });
}

// ---------- miles, recalculated whenever pickup or delivery changes ----------

// Use the street from the email while the City, ST fields still match it; a street geocodes
// more precisely than a city center.
function laneEnds() {
  const withStreet = (field, parsed) => {
    const p = parsePlace($(field).value);
    if (!p) return null;
    return parsed && placeText(parsed).toLowerCase() === placeText(p).toLowerCase() ? { ...parsed } : p;
  };
  return [withStreet("origin", state.details?.origin), withStreet("destination", state.details?.destination)];
}

let milesRun = 0;
async function getMiles() {
  const [o, d] = laneEnds();
  if (!o || !d) return;
  const key = `${addressText(o)}|${addressText(d)}`.toLowerCase();
  const run = ++milesRun;
  state.milesError = null;
  const show = (r) => {
    $("miles").value = r.miles;
    setStatus($("milesNote"), `Driving miles from the ${r.precision}.`);
    state.milesBusy = false;
    render();
  };
  if (state.milesCache[key]) return show(state.milesCache[key]);
  state.milesBusy = true;
  setStatus($("milesNote"), "Working out the route…");
  render();
  try {
    const r = await laneMiles(o, d);
    if (run !== milesRun) return; // a newer lookup started
    state.milesCache[key] = r;
    await store.set({ milesCache: state.milesCache });
    show(r);
  } catch (err) {
    if (run !== milesRun) return;
    state.milesBusy = false;
    state.milesError = err.message;
    setStatus($("milesNote"), "");
    render();
  }
}

let placeTimer;
for (const id of ["origin", "destination"]) {
  $(id).addEventListener("input", () => {
    render();
    clearTimeout(placeTimer);
    placeTimer = setTimeout(getMiles, 800);
  });
}
for (const id of ["equipment", "miles"]) $(id).addEventListener("input", render);

// ---------- fuel, fetched automatically ----------

async function refreshDiesel() {
  setStatus($("fuelResult"), "Getting this week's diesel price from EIA…");
  try {
    state.fuel = await fetchDieselPricePublic();
    state.fuelError = null;
    await store.set({ fuel: state.fuel });
    $("diesel").value = state.fuel.price;
  } catch (err) {
    state.fuelError = err.message;
  }
  render();
}

$("diesel").addEventListener("input", async () => {
  const price = Number($("diesel").value);
  if (!price) return;
  state.fuel = { price, week: new Date().toISOString().slice(0, 10), source: "typed in" };
  state.fuelError = null;
  await store.set({ fuel: state.fuel });
  render();
});

// True once a newer Monday price has taken effect (that Monday's Wednesday has passed).
function newerWeekOut(fuel) {
  const [y, m, d] = fuel.week.split("-").map(Number);
  return Date.now() >= new Date(y, m - 1, d + 9).getTime();
}

// ---------- settings live on the options page ----------

$("openSettings").addEventListener("click", () => chrome.runtime.openOptionsPage());

function fillEquipment() {
  const sel = $("equipment");
  const current = sel.value;
  sel.replaceChildren(...(state.rateSheet?.equipmentTypes || []).map((t) => new Option(t, t)));
  if (current) sel.value = current;
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if ("rateSheet" in changes) {
    state.rateSheet = changes.rateSheet.newValue || null;
    fillEquipment();
  }
  if ("tempSurcharges" in changes) state.tempSurcharges = changes.tempSurcharges.newValue || null;
  if ("rateSheet" in changes || "tempSurcharges" in changes) render();
});

// ---------- accessorials ----------

function renderAccessorials(auto, miles) {
  const box = $("accessorials");
  box.replaceChildren();
  for (const item of ACCESSORIALS) {
    const found = auto.get(item.id);
    const checked = state.overrides.has(item.id) ? state.overrides.get(item.id) : !!found?.checked;
    const row = document.createElement("label");
    row.className = "acc";
    row.title = `Detected from: ${item.how}`;
    const left = document.createElement("span");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", () => {
      state.overrides.set(item.id, cb.checked);
      render();
    });
    left.append(cb, " " + item.label);
    if (found) {
      const tag = document.createElement("span");
      tag.className = found.checked ? "auto" : "hint";
      tag.textContent = ` (${found.reason})`;
      left.append(tag);
    }
    const right = document.createElement("span");
    right.textContent = money(accessorialAmount(item, { miles, stops: state.details?.stops }));
    row.append(left, right);
    box.append(row);
  }
}

// ---------- quote ----------

function render() {
  const rs = state.rateSheet;
  const d = state.details;
  const miles = Number($("miles").value) || null;
  const origin = parsePlace($("origin").value);
  const dest = parsePlace($("destination").value);
  const equipment = $("equipment").value;
  const lines = [];
  const problems = []; // [where, what] that stop the quote from being complete
  const notes = []; // [where, what] worth knowing
  let total = 0;

  if (!d) problems.push(["Email", "no shipping email read yet. Open one in Gmail, or select its text, right-click, and pick “Quote this shipment”."]);
  if (d && !d.origin && !origin) problems.push(["Pickup", "no pickup address found (no sender signature address in the email). Type it in under Lane as City, ST."]);
  if (d && !d.destination && !dest) problems.push(["Delivery", "no delivery address found in the email. Type it in under Lane as City, ST."]);
  else if ((d?.destination || $("destination").value) && !dest) problems.push(["Delivery", `“${$("destination").value}” isn't City, ST.`]);
  if ((d?.origin || $("origin").value) && !origin) problems.push(["Pickup", `“${$("origin").value}” isn't City, ST.`]);
  if (d && !state.equipmentFromEmail && equipment) notes.push(["Equipment", `not in the email, so ${equipment} is assumed. Change it under Lane if needed.`]);

  // Miles
  const milesProblem = () => {
    if (state.milesBusy) return "still working out the route.";
    if (state.milesError) return `couldn't work out the route (${state.milesError}). Type the miles in under Lane.`;
    return "unknown. Type them in under Lane.";
  };

  // Lane and linehaul
  let lh = null;
  if (!rs) {
    setStatus($("laneResult"), "");
    problems.push(["Rate sheet", "none loaded. Pick the Final Bid sheet in Data & settings."]);
  } else if (origin && dest) {
    const hit = findLane(rs.lanes, origin, dest);
    const rate = hit?.lane.rates[equipment];
    if (!hit) {
      setStatus($("laneResult"), "");
      problems.push(["Rate sheet", `no lane for ${placeText(origin)} → ${placeText(dest)}, not even a ${origin.state} → ${dest.state} state lane.`]);
    } else if (!rate) {
      setStatus($("laneResult"), "");
      const others = Object.keys(hit.lane.rates);
      problems.push(["Rate sheet", `the ${placeText(origin)} → ${placeText(dest)} lane (${hit.match}) has no ${equipment} rate.` +
        (others.length ? ` It has: ${others.join(", ")}.` : " It has no rates at all.")]);
    } else {
      const parts = [rate.perMile != null ? `${money(rate.perMile)}/mile` : null, rate.min != null ? `minimum ${money(rate.min)}` : null].filter(Boolean);
      setStatus($("laneResult"), `Lane matched ${hit.match}: ${parts.join(", ")}.`, "ok");
      lh = linehaul(rate, miles);
      if (!lh) problems.push(["Miles", `needed: this lane is priced per mile. Miles are ${milesProblem()}`]);
      else if (rate.perMile != null && !miles) notes.push(["Linehaul", "using the lane minimum until the miles are known."]);
    }
  } else setStatus($("laneResult"), "");

  if (lh) {
    lines.push([`Linehaul (${lh.basis})`, money(lh.amount)]);
    total += lh.amount;
    if (!state.tempSurcharges) notes.push(["Temporary surcharge", "no surcharge sheet loaded, so none is added."]);
    const temp = state.tempSurcharges ? findTempSurcharge(state.tempSurcharges.list, origin, dest, equipment) : null;
    if (temp?.pct) {
      const amt = lh.amount * temp.pct;
      lines.push([`Temporary surcharge ${Math.round(temp.pct * 100)}%`, money(amt)]);
      total += amt;
    }
  }

  // Fuel (applies on minimum-charge lanes too, confirmed with Aidan 2026-10-23)
  const diesel = Number($("diesel").value) || state.fuel?.price || null;
  if (diesel) {
    if (!$("diesel").value) $("diesel").value = diesel;
    const perMile = fscPerMile(diesel);
    const stale = isStale(state.fuel);
    setStatus($("fuelResult"),
      `${money(perMile)}/mile surcharge. ` + (state.fuel ? `Source: ${state.fuel.source}, week of ${state.fuel.week}.` : ""),
      stale ? "muted warn" : "muted");
    if (stale) notes.push(["Fuel", `the diesel price is from the week of ${state.fuel?.week}, over a week old.`]);
    if (miles) {
      lines.push([`Fuel (${miles} mi × ${money(perMile)})`, money(perMile * miles)]);
      total += perMile * miles;
    } else if (lh) problems.push(["Fuel", `needs miles. Miles are ${milesProblem()}`]);
  } else {
    setStatus($("fuelResult"), state.fuelError ? "" : "Getting this week's diesel price from EIA…");
    if (state.fuelError) problems.push(["Fuel", `couldn't get the diesel price from EIA (${state.fuelError}). Type this week's price in under Fuel surcharge.`]);
  }
  if (miles && $("milesNote").textContent.startsWith("Driving")) notes.push(["Miles", "car-route miles; truck miles can run a few percent longer."]);

  // Accessorials
  const auto = detectAccessorials(d, { miles, equipment });
  renderAccessorials(auto, miles);
  for (const item of ACCESSORIALS) {
    const checked = state.overrides.has(item.id) ? state.overrides.get(item.id) : !!auto.get(item.id)?.checked;
    if (!checked) continue;
    const amt = accessorialAmount(item, { miles, stops: d?.stops });
    lines.push([item.label.replace(/\s*\(.*\)$/, ""), money(amt)]);
    total += amt;
  }
  for (const [id, found] of auto) {
    if (!found.checked && !state.overrides.has(id)) notes.push(["Accessorials", `${ACCESSORIALS.find((a) => a.id === id).label}: ${found.reason}.`]);
  }

  lines.push(["Total", money(total), "total"]);
  renderList($("quoteDetails"), lines);
  $("problems").hidden = !problems.length;
  renderItems($("problemList"), problems);
  renderItems($("notes"), notes);
}

// ---------- start ----------

const saved = await store.get(["fuel", "milesCache"]);
state.fuel = saved.fuel || null;
state.milesCache = saved.milesCache || {};
Object.assign(state, await loadSheets());
fillEquipment();
if (state.fuel) $("diesel").value = state.fuel.price;
render();
if (!(await takePending())) readActiveTab();
// A typed-in price stays until it's a week old; an EIA price refreshes when the next week is out.
if (!state.fuel || isStale(state.fuel) || (state.fuel.source !== "typed in" && newerWeekOut(state.fuel))) refreshDiesel();
