// Everything the sidebar does, as one hook: reads the open email, keeps the lane fields,
// looks up miles and diesel, and computes the quote. The page components only render it.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { parseEmail } from "../../lib/email.js";
import { captureEmailText, isGmail } from "../../lib/capture.js";
import { loadSheets } from "../../lib/sheets.js";
import { matchEquipment } from "../../lib/rates.js";
import { fetchDieselPricePublic, isStale } from "../../lib/fuel.js";
import { laneMiles, addressText } from "../../lib/miles.js";
import { computeQuote, parsePlace, placeText } from "../../lib/quote.js";
import { addToHistory, emailKey } from "../../lib/history.js";

const MILES_CACHE_MAX = 300;
const DIESEL_CHECK_MS = 60 * 60 * 1000; // a sidebar left open for days still picks up Wednesday's price

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
  const [history, setHistory] = useState([]);
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
      if (!isGmail(tab.url)) return noEmail("Open a shipping email in Gmail to quote it.");
      const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: captureEmailText });
      if (run !== readRun.current) return;
      if (result?.text) return applyEmail(result.text, result.source);
      // Gmail fills the message in after the URL changes, so retry an empty read a few times.
      if (result?.source === "no open email" && attempt < 6) return setTimeout(() => readActiveTab(attempt + 1), 700);
      noEmail("Open a shipping email in Gmail. You can also select an email's text, right-click, and pick “Quote this shipment”.");
    } catch {
      // Pages Chrome won't let extensions read (new tab, chrome://, the Web Store).
      if (run === readRun.current) noEmail("Open a shipping email in Gmail to quote it.");
    }
  }, [applyEmail]);

  // The last quote, edits included, survives the sidebar closing or reloading (until Chrome
  // restarts: storage.session).
  const applySnapshot = useCallback((q) => {
    emailText.current = q.text;
    setEmail({ text: q.text, source: q.source, details: parseEmail(q.text), note: null });
    setLane(q.lane);
    setMiles({ ...q.miles, busy: false, error: null });
    setOverrides(new Map(q.overrides));
  }, []);

  const restoreLastQuote = useCallback(async () => {
    const { lastQuote: q } = await chrome.storage.session.get("lastQuote");
    if (q?.text) applySnapshot(q);
  }, [applySnapshot]);

  // Start over: forget the current quote. The open Gmail email is read again from scratch.
  const startOver = useCallback(async () => {
    emailText.current = null;
    setEmail({ text: null, source: null, details: null, note: null });
    setLane((l) => ({ origin: "", destination: "", equipment: l.equipment, equipmentFromEmail: false }));
    setMiles({ value: "", source: null, precision: null, busy: false, error: null });
    setOverrides(new Map());
    await chrome.storage.session.remove("lastQuote");
    readActiveTab();
  }, [readActiveTab]);

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
      const saved = await store.get(["fuel", "milesCache", "history"]);
      milesCache.current = saved.milesCache || {};
      setHistory(saved.history || []);
      if (saved.fuel) setDiesel({ value: String(saved.fuel.price), fuel: saved.fuel, error: null, busy: false });
      const loaded = await loadSheets();
      setSheets({ ...loaded, loaded: true });
      sheetsRef.current = { ...loaded, loaded: true };
      await restoreLastQuote();
      if (!(await takePending())) readActiveTab();
      // A typed-in price stays until it's a week old; an EIA price refreshes when the next week is out.
      if (!saved.fuel || isStale(saved.fuel) || (saved.fuel.source !== "typed in" && newerWeekOut(saved.fuel))) refreshDiesel();
    })();

    const dieselTimer = setInterval(async () => {
      const { fuel } = await store.get("fuel");
      if (!fuel || isStale(fuel) || (fuel.source !== "typed in" && newerWeekOut(fuel))) refreshDiesel();
    }, DIESEL_CHECK_MS);

    return () => {
      clearInterval(dieselTimer);
      chrome.tabs.onActivated.removeListener(readSoon);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.storage.session.onChanged.removeListener(onSession);
      chrome.storage.onChanged.removeListener(onLocal);
    };
  }, [readActiveTab, takePending, refreshDiesel, restoreLastQuote]);

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
        const keys = Object.keys(milesCache.current);
        for (const k of keys.slice(0, Math.max(0, keys.length - MILES_CACHE_MAX))) delete milesCache.current[k]; // oldest first
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

  useEffect(() => {
    if (!email.text) return;
    chrome.storage.session.set({
      lastQuote: {
        text: email.text,
        source: email.source,
        lane,
        miles: { value: miles.value, source: miles.source, precision: miles.precision ?? null },
        overrides: [...overrides],
      },
    });
  }, [email.text, email.source, lane, miles.value, miles.source, miles.precision, overrides]);

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

  // Every complete quote goes into the history (one entry per email, updated as it changes).
  useEffect(() => {
    if (!quote.complete || !email.text) return;
    let saved = false;
    const save = async () => {
      saved = true;
      const entry = {
        key: emailKey(email.text),
        reference: email.details?.reference || null,
        origin: lane.origin,
        destination: lane.destination,
        equipment: lane.equipment,
        total: quote.total,
        at: new Date().toISOString(),
        snapshot: { text: email.text, source: email.source, lane, miles: { value: miles.value, source: miles.source, precision: miles.precision ?? null }, overrides: [...overrides] },
      };
      const { history: list } = await store.get("history");
      const next = addToHistory(list, entry);
      await store.set({ history: next });
      setHistory(next);
    };
    // Wait for typing to settle, but if the broker moves to another email first, save right away.
    const text = email.text;
    const timer = setTimeout(save, 800);
    return () => {
      clearTimeout(timer);
      if (!saved && emailText.current !== text) save();
    };
  }, [quote.complete, quote.total, email.text, email.source, email.details, lane, miles.value, miles.source, miles.precision, overrides]);

  const openFromHistory = useCallback((entry) => applySnapshot(entry.snapshot), [applySnapshot]);
  const clearHistory = useCallback(async () => {
    await store.remove("history");
    setHistory([]);
  }, []);

  return {
    sheets, email, lane, miles, diesel, quote, history,
    setLaneField, typeMiles, typeDiesel, toggleAccessorial, loadSample, applyEmail,
    startOver, refreshDiesel, openFromHistory, clearHistory,
    equipmentTypes: sheets.rateSheet?.equipmentTypes || [],
  };
}
