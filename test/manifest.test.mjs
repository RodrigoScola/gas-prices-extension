// The extension's wiring: manifest, files it points to, and permissions for every host we call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const root = new URL("../", import.meta.url);
const at = (p) => new URL(p, root);
const manifest = JSON.parse(readFileSync(at("manifest.json"), "utf8"));
const libSources = readdirSync(at("lib/")).map((f) => readFileSync(at(`lib/${f}`), "utf8")).join("\n");

test("Manifest V3 with the side panel, options page and background worker", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  for (const p of [manifest.side_panel.default_path, manifest.options_ui.page, manifest.background.service_worker]) {
    assert.ok(existsSync(at(p)), `${p} exists`);
  }
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

test("every script and stylesheet the pages load exists", () => {
  for (const page of [manifest.side_panel.default_path, manifest.options_ui.page]) {
    const html = readFileSync(at(page), "utf8");
    for (const [, src] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      assert.ok(existsSync(new URL(src, at(page))), `${page} -> ${src}`);
    }
  }
});

test("every relative import in the extension resolves", () => {
  const files = ["background.js", "config.js", "sidepanel/sidepanel.js", "options/options.js", ...readdirSync(at("lib/")).map((f) => `lib/${f}`)];
  for (const f of files) {
    for (const [, spec] of readFileSync(at(f), "utf8").matchAll(/from\s+"(\.{1,2}\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(spec, at(f))), `${f} imports ${spec}`);
    }
  }
});

test("config ships in production mode", async () => {
  const { ENV, FEATURES } = await import("../config.js");
  assert.equal(ENV, "production");
  assert.deepEqual(FEATURES, { sampleEmail: false, emailTextBox: false });
});

test("client data stays out of git", () => {
  const ignore = readFileSync(at(".gitignore"), "utf8");
  for (const p of ["private/", "*.xlsx", "*.pdf"]) assert.ok(ignore.split(/\r?\n/).includes(p), p);
});
