import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { StorageService } from "../api/storage-service.js";
import { KEYS, OAUTH_CLIENT_ID } from "../config/config.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";

let api;
let storage;

beforeEach(() => {
  api = createFakeBrowser();
  storage = new StorageService(api);
});

// --- token -------------------------------------------------------------------

test("getToken: returns null when nothing is stored", async () => {
  assert.equal(await storage.getToken(), null);
});

test("setToken/getToken: round-trips through local storage", async () => {
  await storage.setToken("ghu_abc123");
  assert.equal(await storage.getToken(), "ghu_abc123");
  assert.equal(api.storage.local.data[KEYS.token], "ghu_abc123");
});

test("clearToken: removes the stored token", async () => {
  await storage.setToken("ghu_abc123");
  await storage.clearToken();
  assert.equal(await storage.getToken(), null);
  assert.equal(KEYS.token in api.storage.local.data, false);
});

test("token is never written to sync storage", async () => {
  await storage.setToken("ghu_abc123");
  assert.deepEqual(api.storage.sync.data, {});
});

// --- client id ---------------------------------------------------------------

test("getClientId: falls back to the config default", async () => {
  assert.equal(await storage.getClientId(), OAUTH_CLIENT_ID);
});

test("setClientId/getClientId: round-trips through sync storage", async () => {
  await storage.setClientId("Iv1.deadbeef");
  assert.equal(await storage.getClientId(), "Iv1.deadbeef");
  assert.equal(api.storage.sync.data[KEYS.clientId], "Iv1.deadbeef");
});

// --- repos -------------------------------------------------------------------

test("getRepos: defaults to an empty array", async () => {
  assert.deepEqual(await storage.getRepos(), []);
});

test("setRepos/getRepos: round-trips the configured repos", async () => {
  const repos = [{ name: "Core", owner: "acme", repo: "core", workflow: "run.yml" }];
  await storage.setRepos(repos);
  assert.deepEqual(await storage.getRepos(), repos);
});

// --- pending selection -------------------------------------------------------

test("takePendingSelection: returns null when none is pending", async () => {
  assert.equal(await storage.takePendingSelection(), null);
});

test("setPendingSelection: stores the text with a timestamp", async () => {
  await storage.setPendingSelection("test_login");
  const item = api.storage.local.data[KEYS.pendingSelection];
  assert.equal(item.text, "test_login");
  assert.equal(typeof item.ts, "number");
});

test("takePendingSelection: returns the text once and then clears it", async () => {
  await storage.setPendingSelection("test_login");
  assert.equal(await storage.takePendingSelection(), "test_login");
  assert.equal(await storage.takePendingSelection(), null);
});

// --- API resolution ----------------------------------------------------------

test("resolves globalThis.browser when no namespace is injected", async () => {
  const previous = globalThis.browser;
  globalThis.browser = createFakeBrowser();
  try {
    const resolved = new StorageService();
    await resolved.setToken("from-global");
    assert.equal(await resolved.getToken(), "from-global");
  } finally {
    globalThis.browser = previous;
  }
});

test("throws a clear error when no extension storage API exists", async () => {
  const previousChrome = globalThis.chrome;
  const previousBrowser = globalThis.browser;
  globalThis.chrome = undefined;
  globalThis.browser = undefined;
  try {
    await assert.rejects(() => new StorageService().getToken(), /storage API is unavailable/);
  } finally {
    globalThis.chrome = previousChrome;
    globalThis.browser = previousBrowser;
  }
});
