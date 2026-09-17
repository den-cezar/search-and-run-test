#!/usr/bin/env node
/**
 * Assembles the files that ship in a release into build/<target>/.
 *
 * Two targets are needed because the stores disagree about the background key:
 * the Edge Add-ons validator rejects background.scripts in Manifest V3, and
 * Firefox has no service worker support at all.
 */
import { cpSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGED = [
  "manifest.json",
  "background.js",
  "content.js",
  "api",
  "config",
  "lib",
  "ui",
  "icons",
  "LICENSE"
];

export const TARGETS = ["chromium", "firefox"];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Rewrite the manifest for a target; the shipped source is never modified. */
export function manifestFor(target, base) {
  const manifest = structuredClone(base);
  if (target === "firefox") {
    manifest.background = { scripts: [manifest.background.service_worker], type: "module" };
    delete manifest.minimum_chrome_version;
  } else {
    delete manifest.browser_specific_settings;
  }
  return manifest;
}

export function buildPackage(target = "chromium") {
  if (!TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}". Expected one of: ${TARGETS.join(", ")}`);
  }
  const out = path.join(ROOT, "build", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const entry of PACKAGED) {
    cpSync(path.join(ROOT, entry), path.join(out, entry), {
      recursive: true,
      filter: (src) => !src.endsWith(".DS_Store")
    });
  }

  const base = JSON.parse(readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
  writeFileSync(
    path.join(out, "manifest.json"),
    `${JSON.stringify(manifestFor(target, base), null, 2)}\n`
  );
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(buildPackage(process.argv[2] || "chromium"));
}
