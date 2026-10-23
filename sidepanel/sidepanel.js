import { parseEmail } from "../lib/email.js";
import { captureEmailText } from "../lib/capture.js";
import { readFirstSheet } from "../lib/xlsx.js";
import { parseRateSheet, findLane, matchEquipment, linehaul, parseTempSurcharges, findTempSurcharge } from "../lib/rates.js";
import { fscPerMile, fetchDieselPrice, isStale } from "../lib/fuel.js";
import { ACCESSORIALS, detectAccessorials, accessorialAmount } from "../lib/accessorials.js";

const $ = (id) => document.getElementById(id);
const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const store = chrome.storage.local;

const state = {
  rateSheet: null, // { equipmentTypes, lanes, fileName, loadedAt }
  tempSurcharges: null, // { list, fileName }
  eiaKey: "",
  fuel: null, // { price, week, source }
  details: null,
  checked: new Set(),
};

// ---------- rendering helpers ----------

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

const placeText = (p) => (p ? `${p.city}, ${p.state}` : "");
function parsePlace(s) {
  const m = String(s).match(/^\s*(.+?),?\s+([A-Za-z]{2})\s*(\d{5})?\s*$/);
  return m ? { city: m[1].trim(), state: m[2].toUpperCase() } : null;
}
function setStatus(el, text, cls = "muted") {
  el.textContent = text;
  el.className = cls;
}

// ---------- step 1: email ----------

function useEmail(text, source) {
  $("email").value = text;
  state.details = parseEmail(text);
  const d = state.details;
  $("origin").value = placeText(d.origin);
  $("destination").value = placeText(d.destination);
  if (d.miles) $("miles").value = d.miles;
  else $("miles").value = "";
  const types = state.rateSheet?.equipmentTypes || [];
  $("equipment").value = matchEquipment(types, d.equipment) || types[0] || "";
  state.checked = detectAccessorials(d);
  setStatus($("captureNote"), source ? `Read from: ${source}.` : "");

  const fmtDT = (x) => x && [x.date?.toLocaleDateString(), x.minutes != null ? `${String(Math.floor(x.minutes / 60)).padStart(2, "0")}:${String(x.minutes % 60).padStart(2, "0")}` : null].filter(Boolean).join(" ");
  renderList($("details"), [
    ["Reference", d.reference],
    ["Pickup", d.origin ? `${placeText(d.origin)} ${d.origin.zip || ""}${d.originGuessed ? " (from sender's signature)" : ""}` : null],
    ["Delivery", d.destination ? `${placeText(d.destination)} ${d.destination.zip || ""}` : null],
    ["Consignee", d.consignee ? [d.consignee.name, d.consignee.street].filter(Boolean).join(", ") : null],
    ["Contact", d.consignee?.contact ?? null],
    ["Weight", d.weight ? `${d.weight.toLocaleString()} lbs` : null],
    ["Pieces", d.pieces],
    ["Value", d.value != null ? money(d.value) : null],
    ["Equipment", d.equipment ?? "not in email, pick below"],
    ["Ready", d.readyNow ? "Ready now" : null],
    ["Pickup date", fmtDT(d.pickup) || null],
    ["Delivery date", fmtDT(d.delivery) || null],
    ["Sender", d.sender],
  ].filter(([label, value]) => value != null || ["Reference", "Pickup", "Delivery", "Weight"].includes(label)));
  render();
}

$("readTab").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureEmailText });
    useEmail(result.text, result.source);
  } catch (err) {
    setStatus($("captureNote"), `Couldn't read this tab (${err.message}). Select the email text and right-click, or paste it.`, "muted warn");
  }
});

$("loadSample").addEventListener("click", async () => {
  const text = await (await fetch(chrome.runtime.getURL("sample/email-sample.txt"))).text();
  useEmail(text, "sample email");
});

let typing;
$("email").addEventListener("input", () => {
  clearTimeout(typing);
  typing = setTimeout(() => useEmail($("email").value, "pasted text"), 400);
});

async function takePending() {
  const { pendingEmail } = await chrome.storage.session.get("pendingEmail");
  if (!pendingEmail) return;
  await chrome.storage.session.remove("pendingEmail");
  useEmail(pendingEmail.text, "right-click selection");
}
chrome.storage.session.onChanged.addListener((changes) => {
  if (changes.pendingEmail?.newValue) takePending();
});

// ---------- settings: sheets and EIA key ----------

$("openSettings").addEventListener("click", () => {
  const open = $("settings").hidden;
  $("settings").hidden = !open;
  $("openSettings").setAttribute("aria-expanded", String(open));
});

async function readXlsx(input) {
  const file = input.files[0];
  input.value = "";
  return file ? { rows: await readFirstSheet(await file.arrayBuffer()), name: file.name } : null;
}

$("rateFile").addEventListener("change", async (e) => {
  try {
    const x = await readXlsx(e.target);
    if (!x) return;
    state.rateSheet = { ...parseRateSheet(x.rows), fileName: x.name, loadedAt: new Date().toISOString() };
    await store.set({ rateSheet: state.rateSheet });
    fillEquipment();
    render();
  } catch (err) {
    setStatus($("rateStatus"), err.message, "muted warn");
  }
});

$("tempFile").addEventListener("change", async (e) => {
  try {
    const x = await readXlsx(e.target);
    if (!x) return;
    state.tempSurcharges = { list: parseTempSurcharges(x.rows), fileName: x.name };
    await store.set({ tempSurcharges: state.tempSurcharges });
    render();
  } catch (err) {
    setStatus($("tempStatus"), err.message, "muted warn");
  }
});

$("saveKey").addEventListener("click", async () => {
  state.eiaKey = $("eiaKey").value.trim();
  await store.set({ eiaKey: state.eiaKey });
  refreshDiesel();
});

// ---------- step 3: fuel ----------

async function refreshDiesel() {
  if (!state.eiaKey) {
    setStatus($("fuelResult"), "Add an EIA API key under Data & settings, or type this week's diesel price.", "muted warn");
    return;
  }
  setStatus($("fuelResult"), "Getting the latest diesel price from EIA…");
  try {
    state.fuel = await fetchDieselPrice(state.eiaKey);
    await store.set({ fuel: state.fuel });
    $("diesel").value = state.fuel.price;
  } catch (err) {
    setStatus($("fuelResult"), err.message, "muted warn");
    return;
  }
  render();
}
$("refreshDiesel").addEventListener("click", refreshDiesel);

$("diesel").addEventListener("input", async () => {
  const price = Number($("diesel").value);
  if (!price) return;
  const today = new Date().toISOString().slice(0, 10);
  state.fuel = { price, week: today, source: "typed in" };
  await store.set({ fuel: state.fuel });
  render();
});

// ---------- accessorials ----------

function renderAccessorials(miles) {
  const box = $("accessorials");
  box.replaceChildren();
  const auto = state.details ? detectAccessorials(state.details) : new Set();
  for (const item of ACCESSORIALS) {
    const row = document.createElement("label");
    row.className = "acc";
    const left = document.createElement("span");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = state.checked.has(item.id);
    cb.addEventListener("change", () => {
      cb.checked ? state.checked.add(item.id) : state.checked.delete(item.id);
      render();
    });
    left.append(cb, " " + item.label);
    if (auto.has(item.id)) {
      const tag = document.createElement("span");
      tag.className = "auto";
      tag.textContent = " from email";
      left.append(tag);
    }
    const right = document.createElement("span");
    right.textContent = money(accessorialAmount(item, { miles }));
    row.append(left, right);
    box.append(row);
  }
}

// ---------- step 2 + quote ----------

function fillEquipment() {
  const sel = $("equipment");
  const current = sel.value;
  sel.replaceChildren(...(state.rateSheet?.equipmentTypes || []).map((t) => new Option(t, t)));
  if (current) sel.value = current;
}

for (const id of ["origin", "destination", "equipment", "miles"]) $(id).addEventListener("input", render);

function render() {
  const rs = state.rateSheet;
  setStatus($("rateStatus"), rs
    ? `${rs.fileName}: ${rs.lanes.length.toLocaleString()} lanes, loaded ${new Date(rs.loadedAt).toLocaleDateString()}.`
    : "No rate sheet loaded yet. Load the Final Bid .xlsx.", rs ? "muted" : "muted warn");
  setStatus($("tempStatus"), state.tempSurcharges
    ? `${state.tempSurcharges.fileName}: ${state.tempSurcharges.list.length} surcharges.`
    : "Not loaded. Quotes will leave out temporary surcharges.", state.tempSurcharges ? "muted" : "muted warn");
  $("eiaKey").value = state.eiaKey;

  const miles = Number($("miles").value) || null;
  const origin = parsePlace($("origin").value);
  const dest = parsePlace($("destination").value);
  const equipment = $("equipment").value;
  const lines = [];
  const notes = [];
  let total = 0;
  let complete = true;

  // Lane and linehaul
  let lh = null;
  if (!rs) {
    setStatus($("laneResult"), "Load the rate sheet first (Data & settings).", "warn");
    complete = false;
  } else if (!origin || !dest) {
    setStatus($("laneResult"), "Enter pickup and delivery as City, ST.", "warn");
    complete = false;
  } else {
    const hit = findLane(rs.lanes, origin, dest);
    const rate = hit?.lane.rates[equipment];
    if (!hit) setStatus($("laneResult"), `No lane in the sheet for ${placeText(origin)} → ${placeText(dest)}.`, "warn");
    else if (!rate) setStatus($("laneResult"), `Lane found (${hit.match}), but no ${equipment} rate on it.`, "warn");
    else {
      const parts = [rate.perMile != null ? `${money(rate.perMile)}/mile` : null, rate.min != null ? `minimum ${money(rate.min)}` : null].filter(Boolean);
      setStatus($("laneResult"), `Matched ${hit.match}: ${parts.join(", ")}.`, "ok");
      lh = linehaul(rate, miles);
      if (!lh) notes.push("This lane is priced per mile. Enter the miles to get a linehaul.");
      else if (rate.perMile != null && !miles) notes.push("Using the lane minimum. Enter miles to check the per-mile price.");
    }
  }
  if (lh) {
    lines.push([`Linehaul (${lh.basis})`, money(lh.amount)]);
    total += lh.amount;
    const temp = state.tempSurcharges && origin && dest ? findTempSurcharge(state.tempSurcharges.list, origin, dest, equipment) : null;
    if (temp?.pct) {
      const amt = lh.amount * temp.pct;
      lines.push([`Temporary surcharge ${Math.round(temp.pct * 100)}%`, money(amt)]);
      total += amt;
    }
  } else complete = false;

  // Fuel
  const diesel = Number($("diesel").value) || state.fuel?.price || null;
  if (diesel) {
    if (!$("diesel").value) $("diesel").value = diesel;
    const perMile = fscPerMile(diesel);
    const stale = isStale(state.fuel);
    setStatus($("fuelResult"),
      `Diesel ${money(diesel)}/gal → ${money(perMile)}/mile surcharge. ` +
      (state.fuel ? `Source: ${state.fuel.source}, week of ${state.fuel.week}.` : "") +
      (stale ? " This is over a week old." : ""), stale ? "muted warn" : "muted");
    if (miles) {
      lines.push([`Fuel (${miles} mi × ${money(perMile)})`, money(perMile * miles)]);
      total += perMile * miles;
    } else notes.push("Fuel surcharge needs miles.");
  } else {
    complete = false;
    if (!$("fuelResult").textContent) setStatus($("fuelResult"), "Enter this week's diesel price, or add an EIA key.", "muted warn");
  }

  // Accessorials
  renderAccessorials(miles);
  for (const item of ACCESSORIALS) {
    if (!state.checked.has(item.id)) continue;
    const amt = accessorialAmount(item, { miles });
    lines.push([item.label.replace(/\s*\(.*\)$/, ""), money(amt)]);
    total += amt;
  }

  lines.push(["Total", money(total), "total"]);
  renderList($("quoteDetails"), lines);
  setStatus($("quoteNote"), [complete ? "" : "Quote is incomplete.", ...notes].filter(Boolean).join(" "), complete && !notes.length ? "muted" : "muted warn");
}

// ---------- start ----------

const saved = await store.get(["rateSheet", "tempSurcharges", "eiaKey", "fuel"]);
Object.assign(state, {
  rateSheet: saved.rateSheet || null,
  tempSurcharges: saved.tempSurcharges || null,
  eiaKey: saved.eiaKey || "",
  fuel: saved.fuel || null,
});
fillEquipment();
if (state.fuel) $("diesel").value = state.fuel.price;
if (!state.rateSheet) $("settings").hidden = false;
render();
takePending();
if (state.eiaKey && isStale(state.fuel)) refreshDiesel();
