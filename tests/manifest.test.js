import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");

const manifest = JSON.parse(read("manifest.json"));
const pkg = JSON.parse(read("package.json"));

/** Every extension file the manifest points at. */
function manifestEntryPoints() {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_page,
    ...manifest.content_scripts.flatMap((cs) => cs.js),
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon)
  ];
  return files.filter(Boolean);
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

/** Top-level paths listed in the release zip step. */
function packagedPaths() {
  const workflow = read(".github/workflows/release-please.yml");
  const block = workflow.match(/zip -r "\$ZIP" \\\n([\s\S]*?)\n\s*-x /);
  assert.ok(block, "could not find the zip file list in release-please.yml");
  return block[1]
    .split("\n")
    .map((line) => line.replace(/\\$/, "").trim())
    .filter(Boolean);
}

test("manifest version matches package.json", () => {
  assert.equal(manifest.version, pkg.version);
});

test("manifest declares Manifest V3 with a module service worker", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
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

test("the release zip includes every packaged file the extension loads", () => {
  const listed = packagedPaths();
  const modules = new Set(manifestEntryPoints());
  for (const entry of manifestEntryPoints()) {
    if (entry.endsWith(".js")) importGraph(entry).forEach((m) => modules.add(m));
  }
  modules.add("manifest.json");

  for (const file of modules) {
    const top = file.split("/")[0];
    assert.ok(
      listed.includes(top) || listed.includes(file),
      `${file} would not be packaged: neither "${top}" nor "${file}" is in the release zip list`
    );
  }
});
