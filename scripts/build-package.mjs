#!/usr/bin/env node
/**
 * Assembles the files that ship in the release zip into build/, so the same
 * tree can be linted, run in Firefox, and compared against the release
 * workflow's zip list.
 */
import { cpSync, rmSync, mkdirSync } from "node:fs";
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "build");

export function buildPackage() {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const entry of PACKAGED) {
    cpSync(path.join(ROOT, entry), path.join(OUT, entry), {
      recursive: true,
      filter: (src) => !src.endsWith(".DS_Store")
    });
  }
  return OUT;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(buildPackage());
}
