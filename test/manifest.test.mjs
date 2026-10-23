// The extension's wiring: manifest, files it points to, and permissions for every host we call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const at = (p) => new URL(p, root);
// Vite builds the pages from src/ into dist/: "sidepanel/index.html" comes from "src/sidepanel/index.html".
const source = (p) => (p.endsWith(".html") ? at(`src/${p}`) : at(p));
const manifest = JSON.parse(readFileSync(at("manifest.json"), "utf8"));
const libSources = readdirSync(at("lib/")).map((f) => readFileSync(at(`lib/${f}`), "utf8")).join("\n");

test("Manifest V3 with the side panel, options page, background worker and icons", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  for (const p of [manifest.side_panel.default_path, manifest.options_ui.page, manifest.background.service_worker]) {
    assert.ok(existsSync(source(p)), `${p} exists`);
  }
  for (const p of [...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon)]) assert.ok(existsSync(at(p)), p);
  assert.ok(Number(manifest.minimum_chrome_version) >= 114, "sidePanel needs Chrome 114+");
});

test("permissions it uses, and nothing broader", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "contextMenus", "scripting", "sidePanel", "storage"]);
  for (const h of manifest.host_permissions) assert.doesNotMatch(h, /<all_urls>|^\*:\/\/\*\//);
});

test("every https host the code calls is in host_permissions", () => {
  const hosts = new Set([...libSources.matchAll(/https:\/\/([a-z0-9.-]+)\//g)].map((m) => m[1]));
  assert.ok(hosts.size >= 4);
  for (const h of hosts) assert.ok(manifest.host_permissions.includes(`https://${h}/*`), `${h} missing from host_permissions`);
});

test("Gmail and Outlook web are readable", () => {
  for (const h of ["mail.google.com", "outlook.office.com", "outlook.live.com"]) assert.ok(manifest.host_permissions.includes(`https://${h}/*`), h);
});

test("each page's entry script exists", () => {
  for (const page of [manifest.side_panel.default_path, manifest.options_ui.page]) {
    const html = readFileSync(source(page), "utf8");
    const scripts = [...html.matchAll(/src="([^"]+\.jsx?)"/g)].map((m) => m[1]);
    assert.ok(scripts.length, page);
    for (const s of scripts) assert.ok(existsSync(new URL(s, source(page))), `${page} -> ${s}`);
  }
});

test("every relative import resolves", () => {
  const files = ["background.js", "config.js", "vite.config.js", ...readdirSync(at("lib/")).map((f) => `lib/${f}`),
    ...["sidepanel", "options", "shared"].flatMap((d) => readdirSync(at(`src/${d}/`)).filter((f) => /\.jsx?$/.test(f)).map((f) => `src/${d}/${f}`))];
  for (const f of files) {
    for (const [, spec] of readFileSync(at(f), "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(spec, at(f))), `${f} imports ${spec}`);
    }
  }
});

test("every MUI icon imported exists", () => {
  const jsx = ["sidepanel/App.jsx", "options/App.jsx", "shared/theme.jsx"].map((f) => readFileSync(at(`src/${f}`), "utf8")).join("\n");
  const icons = [...jsx.matchAll(/from "@mui\/icons-material\/([A-Za-z]+)"/g)].map((m) => m[1]);
  assert.ok(icons.length > 10);
  for (const i of icons) assert.ok(existsSync(at(`node_modules/@mui/icons-material/${i}.js`)), i);
});

test("config ships in production mode", async () => {
  const { ENV, FEATURES } = await import("../config.js");
  assert.equal(ENV, "production");
  assert.deepEqual(FEATURES, { sampleEmail: false, emailTextBox: false });
});

test("client data and build output stay out of git", () => {
  const ignore = readFileSync(at(".gitignore"), "utf8").split(/\r?\n/);
  for (const p of ["private/", "*.xlsx", "*.pdf", "dist/", "node_modules/"]) assert.ok(ignore.includes(p), p);
});

test("the build puts everything the manifest needs in dist/", { skip: existsSync(at("dist/manifest.json")) ? false : "run npm run build first" }, () => {
  const built = JSON.parse(readFileSync(at("dist/manifest.json"), "utf8"));
  assert.deepEqual(built, manifest);
  for (const p of [built.side_panel.default_path, built.options_ui.page, built.background.service_worker, ...Object.values(built.icons), "sample/email-sample.txt"]) {
    assert.ok(existsSync(at(`dist/${p}`)), `dist/${p}`);
  }
  for (const page of [built.side_panel.default_path, built.options_ui.page]) {
    const html = readFileSync(at(`dist/${page}`), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
    assert.ok(refs.length, page);
    for (const s of refs) {
      assert.doesNotMatch(s, /^\/|^https?:/, "paths must be relative inside an extension");
      assert.ok(existsSync(new URL(s, at(`dist/${page}`))), `${page} -> ${s}`);
    }
  }
});
