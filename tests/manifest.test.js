import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PACKAGED, TARGETS, manifestFor } from "../scripts/build-package.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

/** Every extension file the manifest points at, across all targets. */
function manifestEntryPoints() {
  const files = TARGETS.flatMap((target) => {
    const built = manifestFor(target, manifest);
    return [built.background.service_worker, ...(built.background.scripts || [])];
  });
  files.push(
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  );
  return [...new Set(files.filter(Boolean))];
}

/** Follow relative ESM imports from a JS entry point. */
function importGraph(entry, seen = new Set()) {
  if (seen.has(entry) || !entry.endsWith(".js")) return seen;
  seen.add(entry);
  const source = read(entry);
  const pattern = /(?:^|\n)\s*(?:import|export)[^"']*["'](\.[^"']+)["']/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(entry), match[1]));
    importGraph(resolved, seen);
  }
  return seen;
}

test("manifest version matches package.json", () => {
  assert.equal(manifest.version, pkg.version);
});

test("manifest declares Manifest V3 with a module service worker", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
});

// The Edge Add-ons validator rejects background.scripts in a V3 manifest, so
// the base manifest stays Chromium-shaped and the Firefox build rewrites it.
test("base manifest keeps the Chromium background shape", () => {
  assert.equal(manifest.background.service_worker, "background.js");
  assert.equal("scripts" in manifest.background, false);
});

test("firefox build swaps the service worker for an event page", () => {
  const firefox = manifestFor("firefox", manifest);
  assert.deepEqual(firefox.background.scripts, ["background.js"]);
  assert.equal("service_worker" in firefox.background, false);
  assert.equal(firefox.background.type, "module");
  assert.equal("minimum_chrome_version" in firefox, false);
  assert.ok(firefox.browser_specific_settings.gecko.id);
});

test("chromium build drops the Firefox-only settings", () => {
  const chromium = manifestFor("chromium", manifest);
  assert.equal("browser_specific_settings" in chromium, false);
  assert.equal(chromium.background.service_worker, "background.js");
  assert.equal("scripts" in chromium.background, false);
  assert.equal(chromium.minimum_chrome_version, "121");
});

test("every target produces a manifest with exactly one background entry point", () => {
  for (const target of TARGETS) {
    const built = manifestFor(target, manifest);
    const keys = ["service_worker", "scripts"].filter((k) => k in built.background);
    assert.deepEqual(keys.length, 1, `${target} declares ${keys.join(" and ")}`);
  }
});

test("building a manifest never mutates the source", () => {
  const before = JSON.stringify(manifest);
  TARGETS.forEach((target) => manifestFor(target, manifest));
  assert.equal(JSON.stringify(manifest), before);
});

test("manifest pins the minimum versions each engine needs", () => {
  assert.equal(manifest.minimum_chrome_version, "121");
  assert.equal(manifest.browser_specific_settings.gecko.strict_min_version, "121.0");
});

test("manifest carries a stable Firefox add-on id", () => {
  assert.match(manifest.browser_specific_settings.gecko.id, /^[^@\s]+@[^@\s]+$/);
});

// Mandatory on AMO since 2025-11-03, and only enforced server-side: the linter
// bundled with web-ext does not flag it.
test("manifest declares its data collection", () => {
  const declared = manifest.browser_specific_settings.gecko.data_collection_permissions;
  assert.ok(declared, "data_collection_permissions is required by AMO");
  assert.ok(Array.isArray(declared.required) && declared.required.length);

  // Anything beyond "none" requires Firefox 140+ or a custom consent screen.
  if (!declared.required.includes("none")) {
    assert.ok(
      parseFloat(manifest.browser_specific_settings.gecko.strict_min_version) >= 140,
      "declaring data collection requires strict_min_version 140.0 or a custom consent flow"
    );
  }
});

test("manifest uses options_ui, which both engines understand", () => {
  assert.equal(manifest.options_ui.page, "ui/options.html");
  assert.equal(manifest.options_ui.open_in_tab, true);
  assert.equal("options_page" in manifest, false);
});

test("manifest requests only the permissions the code uses", () => {
  assert.deepEqual(manifest.permissions.sort(), ["activeTab", "contextMenus", "storage"]);
  for (const host of manifest.host_permissions) {
    assert.match(host, /^(https|\*):\/\//);
  }
});

test("every file referenced by the manifest exists", () => {
  for (const file of manifestEntryPoints()) {
    assert.ok(existsSync(path.join(ROOT, file)), `${file} is referenced by the manifest but missing`);
  }
});

test("every module reachable from an entry point exists on disk", () => {
  const entries = manifestEntryPoints().filter((f) => f.endsWith(".js"));
  const modules = new Set();
  for (const entry of entries) {
    importGraph(entry).forEach((m) => modules.add(m));
  }
  assert.ok(modules.has("lib/browser-api.js"), "expected the browser API shim in the graph");
  for (const module of modules) {
    assert.ok(existsSync(path.join(ROOT, module)), `${module} is imported but missing`);
  }
});

test("every packaged file the extension loads is in the build list", () => {
  const modules = new Set(manifestEntryPoints());
  for (const entry of manifestEntryPoints()) {
    if (entry.endsWith(".js")) importGraph(entry).forEach((m) => modules.add(m));
  }
  modules.add("manifest.json");

  for (const file of modules) {
    const top = file.split("/")[0];
    assert.ok(
      PACKAGED.includes(top) || PACKAGED.includes(file),
      `${file} would not be packaged: neither "${top}" nor "${file}" is in PACKAGED`
    );
  }
});

test("the release workflow builds every target through the script", () => {
  const workflow = read(".github/workflows/release-please.yml");
  for (const target of TARGETS) {
    assert.match(workflow, new RegExp(`${target}`), `release workflow does not build ${target}`);
  }
  assert.match(workflow, /scripts\/build-package\.mjs/);
});

test("each store job downloads its own package", () => {
  const workflow = read(".github/workflows/publish-stores.yml");
  const patterns = [...workflow.matchAll(/--pattern '([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(patterns, [
    "*-chromium.zip",
    "*-chromium.zip",
    "*-firefox.zip"
  ]);
});
