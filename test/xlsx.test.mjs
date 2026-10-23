import { test } from "node:test";
import assert from "node:assert/strict";
import { readFirstSheet } from "../lib/xlsx.js";
import { makeXlsx, makeZip, arrayBuffer } from "./helpers.mjs";

const sheet = (rows, opts) => readFirstSheet(arrayBuffer(makeXlsx(rows, opts)));

test("shared strings and numbers", async () => {
  assert.deepEqual(await sheet([["Origin City", "Rate"], ["Dallas", 1.43]]), [["Origin City", "Rate"], ["Dallas", "1.43"]]);
});

test("inline strings", async () => {
  assert.deepEqual(await sheet([["a", "b"]], { inline: true }), [["a", "b"]]);
});

test("stored (uncompressed) entries", async () => {
  assert.deepEqual(await sheet([["x", 1]], { deflate: false }), [["x", "1"]]);
});

test("gaps between cells keep their column positions", async () => {
  assert.deepEqual(await sheet([["A", null, "C"], [null, null, null, "D"]]), [["A", "", "C"], ["", "", "", "D"]]);
});

test("columns past Z (AA, AB, ...)", async () => {
  const row = Array.from({ length: 30 }, (_, i) => `c${i}`);
  const [out] = await sheet([row]);
  assert.equal(out.length, 30);
  assert.equal(out[26], "c26");
  assert.equal(out[29], "c29");
});

test("XML entities and special characters come back as text", async () => {
  assert.deepEqual(await sheet([["Flatbed 48' & 53'", "<tag>", 'say "hi"', "naïve café"]]), [["Flatbed 48' & 53'", "<tag>", 'say "hi"', "naïve café"]]);
});

test("follows the workbook to the first sheet, whatever its file name", async () => {
  assert.deepEqual(await sheet([["real data"]], { dataSheetFile: "sheet7.xml" }), [["real data"]]);
});

test("rich text runs in shared strings are joined", async () => {
  const zip = makeZip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst><si><r><t>Grand </t></r><r><rPr><b/></rPr><t xml:space="preserve">Prairie</t></r></si></sst>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
  });
  assert.deepEqual(await readFirstSheet(arrayBuffer(zip)), [["Grand Prairie"]]);
});

test("formula cells give their cached value; empty and self-closing cells are blank", async () => {
  const zip = makeZip({
    "xl/workbook.xml": `<workbook xmlns:r="r"><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1"><f>1+1</f><v>2</v></c><c r="B1" s="3"/><c r="C1" t="str"><v>txt</v></c></row><row r="2"/></sheetData></worksheet>`,
  });
  assert.deepEqual(await readFirstSheet(arrayBuffer(zip)), [["2", "", "txt"]]);
});

test("a workbook without relationships falls back to sheet1.xml", async () => {
  const zip = makeZip({ "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>ok</t></is></c></row></sheetData></worksheet>` });
  assert.deepEqual(await readFirstSheet(arrayBuffer(zip)), [["ok"]]);
});

test("not an .xlsx file", async () => {
  await assert.rejects(readFirstSheet(arrayBuffer(new TextEncoder().encode("just a csv,file\n1,2"))), /Not an \.xlsx file/);
  await assert.rejects(readFirstSheet(new ArrayBuffer(0)), /Not an \.xlsx file/);
});

test("a big sheet (5,000 rows) reads quickly", async () => {
  const rows = [["Origin City", "Origin State", "Destination City", "Destination State", "Unit Rate - Van"]];
  for (let i = 0; i < 5000; i++) rows.push([`City${i}`, "TX", `Dest${i}`, "IL", 1 + i / 1000]);
  const t = performance.now();
  const out = await sheet(rows);
  assert.equal(out.length, 5001);
  assert.equal(out[5000][0], "City4999");
  assert.ok(performance.now() - t < 3000);
});
