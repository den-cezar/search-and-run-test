import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { requiredOrigins, hasHostAccess, requestHostAccess } from "../lib/host-access.js";
import { createFakeBrowser } from "./helpers/fake-browser.js";

const MANIFEST = {
  host_permissions: ["https://api.github.com/*", "https://github.com/login/*"],
  content_scripts: [{ matches: ["*://*.atlassian.net/*"] }]
};

let api;

beforeEach(() => {
  api = createFakeBrowser();
  api.runtime.getManifest = () => MANIFEST;
});

// --- requiredOrigins ---------------------------------------------------------

test("requiredOrigins: merges host permissions and content script matches", () => {
  assert.deepEqual(requiredOrigins(api), [
    "https://api.github.com/*",
    "https://github.com/login/*",
    "*://*.atlassian.net/*"
  ]);
});

test("requiredOrigins: de-duplicates overlapping entries", () => {
  api.runtime.getManifest = () => ({
    host_permissions: ["*://*.atlassian.net/*"],
    content_scripts: [{ matches: ["*://*.atlassian.net/*"] }]
  });
  assert.deepEqual(requiredOrigins(api), ["*://*.atlassian.net/*"]);
});

test("requiredOrigins: tolerates a manifest with neither key", () => {
  api.runtime.getManifest = () => ({});
  assert.deepEqual(requiredOrigins(api), []);
});

test("requiredOrigins: tolerates a content script entry with no matches", () => {
  api.runtime.getManifest = () => ({
    host_permissions: ["https://api.github.com/*"],
    content_scripts: [{ js: ["content.js"] }]
  });
  assert.deepEqual(requiredOrigins(api), ["https://api.github.com/*"]);
});

test("requiredOrigins: returns nothing without a runtime API", () => {
  assert.deepEqual(requiredOrigins(null), []);
  assert.deepEqual(requiredOrigins({}), []);
});

// --- hasHostAccess -----------------------------------------------------------

test("hasHostAccess: true when every origin is granted", async () => {
  let asked;
  api.permissions.contains = async (query) => {
    asked = query;
    return true;
  };
  assert.equal(await hasHostAccess(api), true);
  assert.deepEqual(asked, { origins: requiredOrigins(api) });
});

test("hasHostAccess: false when the browser reports a missing origin", async () => {
  api.permissions.contains = async () => false;
  assert.equal(await hasHostAccess(api), false);
});

test("hasHostAccess: assumes access when the permissions API is absent", async () => {
  delete api.permissions;
  assert.equal(await hasHostAccess(api), true);
  assert.equal(await hasHostAccess(null), true);
});

test("hasHostAccess: assumes access when the query throws", async () => {
  api.permissions.contains = async () => {
    throw new Error("not supported");
  };
  assert.equal(await hasHostAccess(api), true);
});

test("hasHostAccess: assumes access when the manifest declares no origins", async () => {
  api.runtime.getManifest = () => ({});
  api.permissions.contains = async () => {
    throw new Error("should not be called");
  };
  assert.equal(await hasHostAccess(api), true);
});

// --- requestHostAccess -------------------------------------------------------

test("requestHostAccess: asks for every required origin", async () => {
  let asked;
  api.permissions.request = async (query) => {
    asked = query;
    return true;
  };
  assert.equal(await requestHostAccess(api), true);
  assert.deepEqual(asked, { origins: requiredOrigins(api) });
});

test("requestHostAccess: false when the user declines", async () => {
  api.permissions.request = async () => false;
  assert.equal(await requestHostAccess(api), false);
});

test("requestHostAccess: false when the request throws", async () => {
  api.permissions.request = async () => {
    throw new Error("no user gesture");
  };
  assert.equal(await requestHostAccess(api), false);
});

test("requestHostAccess: true when the permissions API is absent", async () => {
  delete api.permissions;
  assert.equal(await requestHostAccess(api), true);
  assert.equal(await requestHostAccess(null), true);
});

test("requestHostAccess: true when there is nothing to request", async () => {
  api.runtime.getManifest = () => ({});
  assert.equal(await requestHostAccess(api), true);
});
