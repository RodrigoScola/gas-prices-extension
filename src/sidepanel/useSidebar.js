// Everything the sidebar does, as one hook: reads the open email, keeps the lane fields,
// looks up miles and diesel, and computes the quote. The page components only render it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEmail } from "../../lib/email.js";
import { captureEmailText } from "../../lib/capture.js";
import { loadSheets } from "../../lib/sheets.js";
import { matchEquipment } from "../../lib/rates.js";
import { fetchDieselPricePublic, isStale } from "../../lib/fuel.js";
import { laneMiles, addressText } from "../../lib/miles.js";
import { computeQuote, parsePlace, placeText } from "../../lib/quote.js";

const store = chrome.storage.local;

// True once a newer Monday price has taken effect (that Monday's Wednesday has passed).
function newerWeekOut(fuel) {
  const [y, m, d] = fuel.week.split("-").map(Number);
  return Date.now() >= new Date(y, m - 1, d + 9).getTime();
}

export function useSidebar() {
  const [sheets, setSheets] = useState({ rateSheet: null, tempSurcharges: null, loaded: false });
  const [email, setEmail] = useState({ text: null, source: null, details: null, note: null });
  const [lane, setLane] = useState({ origin: "", destination: "", equipment: "", equipmentFromEmail: false });
  const [miles, setMiles] = useState({ value: "", source: null, precision: null, busy: false, error: null });
  const [diesel, setDiesel] = useState({ value: "", fuel: null, error: null, busy: false });
  const [overrides, setOverrides] = useState(new Map());
  const milesCache = useRef({});
  const emailText = useRef(null);
  const sheetsRef = useRef(sheets);
  sheetsRef.current = sheets;

  // ---------- email ----------

  const applyEmail = useCallback((text, source) => {
    if (!text || text === emailText.current) return; // same email: keep the broker's edits
    emailText.current = text;
    const details = parseEmail(text);
    const types = sheetsRef.current.rateSheet?.equipmentTypes || [];
    const matched = matchEquipment(types, details.equipment);
    setEmail({ text, source, details, note: null });
    setLane({
      origin: placeText(details.origin),
      destination: placeText(details.destination),
      equipment: matched || types[0] || "",
      equipmentFromEmail: !!matched,
    });
    setMiles(details.miles ? { value: String(details.miles), source: "email", busy: false, error: null } : { value: "", source: null, busy: false, error: null });
    setOverrides(new Map());
  }, []);

  const readRun = useRef(0);
  const readActiveTab = useCallback(async (attempt = 0) => {
    const run = attempt === 0 ? ++readRun.current : readRun.current;
    const noEmail = (note) => !emailText.current && setEmail((e) => ({ ...e, note }));
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureEmailText });
      if (run !== readRun.current) return;
      if (result?.text) return applyEmail(result.text, result.source);
      // Gmail fills the message in after the URL changes, so retry an empty read a few times.
      if (result?.source === "no open email" && attempt < 4) return setTimeout(() => readActiveTab(attempt + 1), 700);
      noEmail("Open a shipping email in Gmail. You can also select an email's text, right-click, and pick “Quote this shipment”.");
    } catch {
      // Pages Chrome won't let extensions read (new tab, chrome://, the Web Store).
      if (run === readRun.current) noEmail("Open a shipping email in Gmail to quote it.");
    }
  }, [applyEmail]);

  const takePending = useCallback(async () => {
    const { pendingEmail } = await chrome.storage.session.get("pendingEmail");
    if (!pendingEmail) return false;
    await chrome.storage.session.remove("pendingEmail");
    applyEmail(pendingEmail.text, "right-click selection");
    return true;
  }, [applyEmail]);

  // ---------- diesel ----------

  const refreshDiesel = useCallback(async () => {
    setDiesel((d) => ({ ...d, busy: true }));
    try {
      const fuel = await fetchDieselPricePublic();
      await store.set({ fuel });
      setDiesel({ value: String(fuel.price), fuel, error: null, busy: false });
    } catch (err) {
      setDiesel((d) => ({ ...d, error: err.message, busy: false }));
    }
  }, []);

  const typeDiesel = useCallback((value) => {
    const price = Number(value);
    if (!price) return setDiesel((d) => ({ ...d, value }));
    const fuel = { price, week: new Date().toISOString().slice(0, 10), source: "typed in" };
    store.set({ fuel });
    setDiesel({ value, fuel, error: null, busy: false });
  }, []);

  // ---------- start-up and listeners ----------

  useEffect(() => {
    let readSoonTimer;
    const readSoon = () => {
      clearTimeout(readSoonTimer);
      readSoonTimer = setTimeout(() => readActiveTab(), 400);
    };
    const onUpdated = (_id, info, tab) => {
      if (tab.active && (info.url || info.status === "complete")) readSoon();
    };
    const onSession = (changes) => changes.pendingEmail?.newValue && takePending();
    const onLocal = (changes, area) => {
      if (area !== "local") return;
      if ("rateSheet" in changes || "tempSurcharges" in changes) {
        setSheets((s) => ({
          ...s,
          ...("rateSheet" in changes ? { rateSheet: changes.rateSheet.newValue || null } : {}),
          ...("tempSurcharges" in changes ? { tempSurcharges: changes.tempSurcharges.newValue || null } : {}),
        }));
      }
    };
    chrome.tabs.onActivated.addListener(readSoon);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.storage.session.onChanged.addListener(onSession);
    chrome.storage.onChanged.addListener(onLocal);

    (async () => {
      const saved = await store.get(["fuel", "milesCache"]);
      milesCache.current = saved.milesCache || {};
      if (saved.fuel) setDiesel({ value: String(saved.fuel.price), fuel: saved.fuel, error: null, busy: false });
      const loaded = await loadSheets();
      setSheets({ ...loaded, loaded: true });
      sheetsRef.current = { ...loaded, loaded: true };
      if (!(await takePending())) readActiveTab();
      // A typed-in price stays until it's a week old; an EIA price refreshes when the next week is out.
      if (!saved.fuel || isStale(saved.fuel) || (saved.fuel.source !== "typed in" && newerWeekOut(saved.fuel))) refreshDiesel();
    })();

    return () => {
      chrome.tabs.onActivated.removeListener(readSoon);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.storage.session.onChanged.removeListener(onSession);
      chrome.storage.onChanged.removeListener(onLocal);
    };
  }, [readActiveTab, takePending, refreshDiesel]);

  // The equipment list can arrive after the email (sheets still loading).
  useEffect(() => {
    const types = sheets.rateSheet?.equipmentTypes || [];
    if (!types.length || types.includes(lane.equipment)) return;
    const matched = matchEquipment(types, email.details?.equipment);
    setLane((l) => ({ ...l, equipment: matched || types[0], equipmentFromEmail: !!matched }));
  }, [sheets.rateSheet, email.details, lane.equipment]);

  // ---------- miles: recalculated whenever pickup or delivery changes ----------

  const milesRun = useRef(0);
  useEffect(() => {
    if (miles.source === "email" || miles.source === "typed") return;
    const withStreet = (text, parsed) => {
      const p = parsePlace(text);
      if (!p) return null;
      // Keep the street from the email while the field still matches it (more precise).
      return parsed && placeText(parsed).toLowerCase() === placeText(p).toLowerCase() ? { ...parsed } : p;
    };
    const o = withStreet(lane.origin, email.details?.origin);
    const d = withStreet(lane.destination, email.details?.destination);
    if (!o || !d) return;
    const key = `${addressText(o)}|${addressText(d)}`.toLowerCase();
    const run = ++milesRun.current;
    if (milesCache.current[key]) {
      const r = milesCache.current[key];
      setMiles({ value: String(r.miles), source: "route", precision: r.precision, busy: false, error: null });
      return;
    }
    const timer = setTimeout(async () => {
      setMiles((m) => ({ ...m, busy: true, error: null }));
      try {
        const r = await laneMiles(o, d);
        if (run !== milesRun.current) return; // a newer lookup started
        milesCache.current[key] = r;
        store.set({ milesCache: milesCache.current });
        setMiles({ value: String(r.miles), source: "route", precision: r.precision, busy: false, error: null });
      } catch (err) {
        if (run === milesRun.current) setMiles((m) => ({ ...m, busy: false, error: err.message }));
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [lane.origin, lane.destination, email.details, miles.source]);

  const setLaneField = useCallback((field, value) => {
    setLane((l) => ({ ...l, [field]: value }));
    // Editing pickup or delivery means the old miles no longer apply.
    if (field === "origin" || field === "destination") setMiles((m) => (m.source === "typed" || m.source === "email" ? { ...m, source: null } : m));
  }, []);

  const typeMiles = useCallback((value) => setMiles({ value, source: value ? "typed" : null, busy: false, error: null }), []);

  const toggleAccessorial = useCallback((id, checked) => setOverrides((o) => new Map(o).set(id, checked)), []);

  const loadSample = useCallback(async () => {
    applyEmail(await (await fetch(chrome.runtime.getURL("sample/email-sample.txt"))).text(), "sample email");
  }, [applyEmail]);

  // ---------- quote ----------

  const quote = useMemo(() => computeQuote({
    rateSheet: sheets.rateSheet,
    tempSurcharges: sheets.tempSurcharges,
    details: email.details,
    originText: lane.origin,
    destText: lane.destination,
    equipment: lane.equipment,
    equipmentFromEmail: lane.equipmentFromEmail,
    miles: Number(miles.value) || null,
    milesStatus: { busy: miles.busy, error: miles.error, fromRoute: miles.source === "route" },
    diesel: Number(diesel.value) || null,
    fuel: diesel.fuel,
    fuelError: diesel.error,
    overrides,
  }), [sheets, email.details, lane, miles, diesel, overrides]);

  return {
    sheets, email, lane, miles, diesel, quote,
    setLaneField, typeMiles, typeDiesel, toggleAccessorial, loadSample, applyEmail,
    equipmentTypes: sheets.rateSheet?.equipmentTypes || [],
  };
}
