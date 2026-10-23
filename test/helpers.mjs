// Shared test helpers: fixtures, a tiny .xlsx builder, a fake chrome.* and a fake fetch.
import { readFileSync, existsSync } from "node:fs";
import { deflateRawSync } from "node:zlib";

export const file = (p) => new URL(`./${p}`, import.meta.url);
export const read = (p) => readFileSync(file(p), "utf8");
export const exists = (p) => existsSync(file(p));
export const arrayBuffer = (bytes) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
export const readBuffer = (p) => arrayBuffer(readFileSync(file(p)));

// Real client data lives in ../private (git-ignored). Tests that need it skip without it.
export const PRIVATE = {
  rateSheet: "../private/Siemens FTL Final Bid 2026.xlsx",
  tempSheet: "../private/Siemens Accepted Surcharge.xlsx",
  email1: "../private/email-real-1.txt",
  email1Subject: "../private/email-real-1-with-subject.txt",
  email2: "../private/email-real-2.txt",
  fscScale: "../private/fsc-scale.txt",
};
export const skipUnless = (...paths) => (paths.every(exists) ? false : "client data not in private/");

// ---------- .xlsx builder ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// files: { "name": string | Uint8Array }. deflate=false stores entries uncompressed.
export function makeZip(files, { deflate = true } = {}) {
  const enc = new TextEncoder();
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const packed = deflate ? new Uint8Array(deflateRawSync(data)) : data;
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, packed.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, packed.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    locals.push(local, packed);
    centrals.push(central);
    offset += local.length + packed.length;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, centrals.length, true); ev.setUint16(10, centrals.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}

const xmlEsc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

// rows: arrays of cell values (null/undefined = no cell). Strings go to shared strings unless
// inline=true; numbers are plain <v> cells. sheets: extra sheets placed before the data sheet
// in the zip, to check the reader follows workbook order rather than file names.
export function makeXlsx(rows, { inline = false, deflate = true, dataSheetFile = "sheet1.xml" } = {}) {
  const strings = [];
  const sheetRows = rows.map((row, r) => {
    const cells = row.map((v, c) => {
      if (v == null) return "";
      const ref = `${colName(c)}${r + 1}`;
      if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
      if (inline) return `<c r="${ref}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>`;
      strings.push(v);
      return `<c r="${ref}" t="s"><v>${strings.length - 1}</v></c>`;
    }).join("");
    return `<row r="${r + 1}">${cells}</row>`;
  }).join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    "xl/workbook.xml": `<?xml version="1.0"?><workbook xmlns:r="r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/${dataSheetFile}"/><Relationship Id="rId2" Type="worksheet" Target="worksheets/other.xml"/></Relationships>`,
    "xl/worksheets/other.xml": `<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>WRONG SHEET</t></is></c></row></sheetData></worksheet>`,
    [`xl/worksheets/${dataSheetFile}`]: `<?xml version="1.0"?><worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  if (!inline) files["xl/sharedStrings.xml"] = `<?xml version="1.0"?><sst>${strings.map((s) => `<si><t>${xmlEsc(s)}</t></si>`).join("")}</sst>`;
  return makeZip(files, { deflate });
}

// ---------- fake chrome.* ----------

export function fakeChrome({ files = {} } = {}) {
  const data = {};
  const area = () => ({
    async get(keys) {
      const list = keys == null ? Object.keys(data) : Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
    async remove(keys) { for (const k of [].concat(keys)) delete data[k]; },
  });
  const chrome = {
    _data: data,
    storage: { local: area(), session: area() },
    runtime: { getURL: (p) => `chrome-extension://test/${p}` },
  };
  // fetch() for chrome-extension:// URLs serves `files` (keyed by decoded path).
  const fetch = async (url) => {
    const path = decodeURIComponent(String(url).replace("chrome-extension://test/", ""));
    if (!(path in files)) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0), text: async () => "" };
    const body = files[path];
    return { ok: true, status: 200, arrayBuffer: async () => (body instanceof Uint8Array ? arrayBuffer(body) : body), text: async () => String(body) };
  };
  return { chrome, fetch };
}

// fetch that answers by URL substring; records every URL it was asked for.
export function routeFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    for (const [match, respond] of routes) {
      if (String(url).includes(match)) return typeof respond === "function" ? respond(String(url)) : respond;
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  fn.calls = calls;
  return fn;
}
export const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) });
export const textResponse = (body, ok = true, status = 200) => ({ ok, status, text: async () => body, json: async () => JSON.parse(body) });
