import { loadSheets, useDefault, useFile } from "../lib/sheets.js";

const $ = (id) => document.getElementById(id);
const sheets = await loadSheets();

function describe(key) {
  const x = sheets[key];
  const el = $(`${key}Status`);
  el.className = x ? "muted" : "muted warn";
  if (!x) {
    el.textContent = key === "rateSheet" ? "No rate sheet. Pick the Final Bid .xlsx." : "None. Quotes will leave out temporary surcharges.";
  } else {
    const count = key === "rateSheet" ? `${x.lanes.length.toLocaleString()} lanes` : `${x.list.length} surcharges`;
    el.textContent = `${x.isDefault ? "Default" : "Your file"}: ${x.fileName}, ${count}` +
      (x.isDefault ? "." : `, loaded ${new Date(x.loadedAt).toLocaleDateString()}.`);
  }
  $(`${key}Default`).hidden = !x || x.isDefault;
}

for (const key of ["rateSheet", "tempSurcharges"]) {
  $(`${key}File`).addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      sheets[key] = await useFile(key, file);
      describe(key);
    } catch (err) {
      $(`${key}Status`).textContent = err.message;
      $(`${key}Status`).className = "muted warn";
    }
  });
  $(`${key}Default`).addEventListener("click", async () => {
    sheets[key] = await useDefault(key);
    describe(key);
  });
  describe(key);
}
