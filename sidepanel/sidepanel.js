import { FEATURES } from "../config.js";
import { parseEmail } from "../lib/email.js";
import { captureEmailText } from "../lib/capture.js";
import { loadSheets } from "../lib/sheets.js";
import { matchEquipment } from "../lib/rates.js";
import { fetchDieselPricePublic, isStale } from "../lib/fuel.js";
import { laneMiles, addressText } from "../lib/miles.js";
import { computeQuote, parsePlace, placeText, money } from "../lib/quote.js";

const $ = (id) => document.getElementById(id);
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

// ---------- render ----------

function renderAccessorials(accessorials) {
  $("accessorials").replaceChildren(...accessorials.map(({ item, found, checked, amount }) => {
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
    right.textContent = money(amount);
    row.append(left, right);
    return row;
  }));
}

function render() {
  const q = computeQuote({
    rateSheet: state.rateSheet,
    tempSurcharges: state.tempSurcharges,
    details: state.details,
    originText: $("origin").value,
    destText: $("destination").value,
    equipment: $("equipment").value,
    equipmentFromEmail: state.equipmentFromEmail,
    miles: Number($("miles").value) || null,
    milesStatus: { busy: state.milesBusy, error: state.milesError, fromRoute: $("milesNote").textContent.startsWith("Driving") },
    diesel: Number($("diesel").value) || null,
    fuel: state.fuel,
    fuelError: state.fuelError,
    overrides: state.overrides,
  });
  setStatus($("laneResult"), q.lane?.text || "", "ok");
  if (q.fuel) {
    if (!$("diesel").value && state.fuel) $("diesel").value = state.fuel.price;
    setStatus($("fuelResult"), q.fuel.text, q.fuel.stale ? "muted warn" : "muted");
  } else setStatus($("fuelResult"), state.fuelError ? "" : "Getting this week's diesel price from EIA…");
  renderAccessorials(q.accessorials);
  renderList($("quoteDetails"), q.lines);
  $("problems").hidden = q.complete;
  renderItems($("problemList"), q.problems);
  renderItems($("notes"), q.notes);
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
