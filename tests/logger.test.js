import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  LEVELS,
  createLogger,
  setLogLevel,
  initLogLevelFromStorage
} from "../lib/logger.js";
import { createFakeBrowser, installFakeBrowser } from "./helpers/fake-browser.js";

const METHODS = ["debug", "info", "warn", "error"];
let captured;
let originals;

beforeEach(() => {
  captured = [];
  originals = {};
  for (const m of METHODS) {
    originals[m] = console[m];
    console[m] = (...args) => captured.push({ level: m, args });
  }
  setLogLevel("info");
});

afterEach(() => {
  for (const m of METHODS) {
    console[m] = originals[m];
  }
  setLogLevel("info");
});

// --- level filtering ---------------------------------------------------------

test("createLogger: debug is suppressed at the default info level", () => {
  const log = createLogger("popup");
  log.debug("hidden");
  log.info("shown");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].level, "info");
});

test("createLogger: debug is emitted once the level is lowered", () => {
  setLogLevel("debug");
  createLogger("popup").debug("shown");
  assert.equal(captured.length, 1);
  assert.equal(captured[0].level, "debug");
});

test("createLogger: silent suppresses every level", () => {
  setLogLevel("silent");
  const log = createLogger("popup");
  METHODS.forEach((m) => log[m]("nope"));
  assert.equal(captured.length, 0);
});

test("createLogger: tags output with the scope", () => {
  createLogger("github").error("boom", { code: 500 });
  assert.match(captured[0].args[0], /\[S&R:github\]/);
  assert.deepEqual(captured[0].args[1], "boom");
});

test("setLogLevel: accepts numeric levels and ignores unknown strings", () => {
  setLogLevel(LEVELS.error);
  const log = createLogger("popup");
  log.warn("hidden");
  log.error("shown");
  assert.equal(captured.length, 1);

  setLogLevel("not-a-level");
  log.warn("still hidden");
  assert.equal(captured.length, 1);
});

// --- storage-backed initialisation ------------------------------------------

test("initLogLevelFromStorage: applies the stored level", async () => {
  const fake = installFakeBrowser({ sync: { log_level: "debug" } });
  try {
    await initLogLevelFromStorage();
    createLogger("popup").debug("shown");
    assert.equal(captured.length, 1);
  } finally {
    fake.restore();
  }
});

test("initLogLevelFromStorage: falls back to info when the key is absent", async () => {
  const fake = installFakeBrowser();
  try {
    setLogLevel("debug");
    await initLogLevelFromStorage();
    const log = createLogger("popup");
    log.debug("hidden");
    log.info("shown");
    assert.equal(captured.length, 1);
    assert.equal(captured[0].level, "info");
  } finally {
    fake.restore();
  }
});

test("initLogLevelFromStorage: is a no-op outside an extension context", async () => {
  const previousChrome = globalThis.chrome;
  const previousBrowser = globalThis.browser;
  globalThis.chrome = undefined;
  globalThis.browser = undefined;
  try {
    await initLogLevelFromStorage();
    createLogger("popup").info("shown");
    assert.equal(captured.length, 1);
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.browser = previousBrowser;
  }
});

test("initLogLevelFromStorage: swallows storage failures", async () => {
  const previous = globalThis.browser;
  const api = createFakeBrowser();
  api.storage.sync.get = async () => {
    throw new Error("storage exploded");
  };
  globalThis.browser = api;
  try {
    await initLogLevelFromStorage();
    createLogger("popup").info("shown");
    assert.equal(captured.length, 1);
  } finally {
    globalThis.browser = previous;
  }
});
