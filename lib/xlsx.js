// Minimal .xlsx reader: unzips with the built-in DecompressionStream and reads cell values.
// Good enough for plain data sheets; formulas come back as their cached values.

async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Returns { "xl/workbook.xml": Uint8Array, ... } for the entries we ask for.
async function unzip(buffer, wanted) {
  const data = new Uint8Array(buffer);
  const view = new DataView(buffer);
  // End of central directory record is in the last 64KB.
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("Not an .xlsx file (zip directory not found).");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const out = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(data.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = data.subarray(start, start + size);
    out[name] = method === 0 ? raw : await inflate(raw);
  }
  return out;
}

const decodeXml = (s) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n)).replace(/&amp;/g, "&");

function colIndex(letters) {
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

// Reads the first sheet into an array of rows, each an array of cell strings (sparse cells are "").
export async function readFirstSheet(buffer) {
  const files = await unzip(buffer, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n) || n === "xl/workbook.xml" || n === "xl/_rels/workbook.xml.rels");
  const text = (name) => (files[name] ? new TextDecoder().decode(files[name]) : "");

  // Find the first sheet's file through the workbook relationships.
  const firstRid = (text("xl/workbook.xml").match(/<sheet [^>]*r:id="([^"]+)"/) || [])[1];
  const target = (text("xl/_rels/workbook.xml.rels").match(new RegExp(`Id="${firstRid}"[^>]*Target="([^"]+)"`)) ||
    text("xl/_rels/workbook.xml.rels").match(new RegExp(`Target="([^"]+)"[^>]*Id="${firstRid}"`)) || [])[1];
  const sheetName = target ? "xl/" + target.replace(/^\/?xl\//, "") : "xl/worksheets/sheet1.xml";

  const strings = [...text("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) =>
    decodeXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(""))
  );

  const rows = [];
  for (const [, body] of text(sheetName).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const [, col, attrs, inner = ""] of body.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const type = (attrs.match(/t="(\w+)"/) || [])[1];
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let value;
      if (type === "s") value = strings[Number(v)];
      else if (type === "inlineStr") value = decodeXml((inner.match(/<t[^>]*>([\s\S]*?)<\/t>/) || [])[1] || "");
      else value = v == null ? "" : decodeXml(v);
      row[colIndex(col)] = value ?? "";
    }
    rows.push(Array.from(row, (c) => c ?? ""));
  }
  return rows;
}
