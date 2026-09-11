import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GitHubClient } from "../api/github-client.js";
import { KEYS } from "../config/config.js";
import { installFakeBrowser } from "./helpers/fake-browser.js";
import { routeFetch, json, networkError } from "./helpers/fake-fetch.js";

let fake;
let originalFetch;

function newClient() {
  const client = new GitHubClient();
  client._sleep = async () => {};
  return client;
}

async function setClientId(id) {
  await fake.api.storage.sync.set({ [KEYS.clientId]: id });
}

beforeEach(() => {
  fake = installFakeBrowser();
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fake.restore();
});

// --- startDeviceFlow ---------------------------------------------------------

test("startDeviceFlow: refuses to start without a configured client ID", async () => {
  const calls = routeFetch([]);
  await assert.rejects(() => newClient().startDeviceFlow(), (e) => {
    assert.equal(e.kind, "auth");
    assert.match(e.message, /No OAuth client ID/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("startDeviceFlow: refuses a placeholder client ID", async () => {
  await setClientId("REPLACE_WITH_YOUR_CLIENT_ID");
  const calls = routeFetch([]);
  await assert.rejects(() => newClient().startDeviceFlow(), /No OAuth client ID/);
  assert.equal(calls.length, 0);
});

test("startDeviceFlow: posts the client ID and scopes, returns the device codes", async () => {
  await setClientId("Iv1.abc");
  const calls = routeFetch([
    [
      "login/device/code",
      json(200, {
        device_code: "dev-1",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 900,
        interval: 5
      })
    ]
  ]);

  const device = await newClient().startDeviceFlow();

  assert.equal(device.user_code, "ABCD-1234");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.client_id, "Iv1.abc");
  assert.equal(body.scope, "repo workflow");
});

test("startDeviceFlow: explains a 404 as a client ID / device flow problem", async () => {
  await setClientId("Iv1.wrong");
  routeFetch([["login/device/code", json(404, {})]]);
  await assert.rejects(() => newClient().startDeviceFlow(), (e) => {
    assert.equal(e.status, 404);
    assert.match(e.message, /Device Flow is enabled/);
    return true;
  });
});

test("startDeviceFlow: surfaces a non-2xx status", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/device/code", json(500, {})]]);
  await assert.rejects(() => newClient().startDeviceFlow(), (e) => {
    assert.equal(e.kind, "http");
    assert.equal(e.status, 500);
    return true;
  });
});

test("startDeviceFlow: surfaces an error payload returned with 200", async () => {
  await setClientId("Iv1.abc");
  routeFetch([
    ["login/device/code", json(200, { error: "unsupported_grant_type", error_description: "Device flow is off" })]
  ]);
  await assert.rejects(() => newClient().startDeviceFlow(), /Device flow is off/);
});

test("startDeviceFlow: falls back to the error code when there is no description", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/device/code", json(200, { error: "device_flow_disabled" })]]);
  await assert.rejects(() => newClient().startDeviceFlow(), /device_flow_disabled/);
});

test("startDeviceFlow: maps a transport failure to a network error", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/device/code", networkError()]]);
  await assert.rejects(() => newClient().startDeviceFlow(), (e) => {
    assert.equal(e.kind, "network");
    return true;
  });
});

// --- pollForToken ------------------------------------------------------------

test("pollForToken: stores the token once authorization completes", async () => {
  await setClientId("Iv1.abc");
  let attempt = 0;
  routeFetch([
    [
      "login/oauth/access_token",
      () => {
        attempt++;
        return attempt === 1
          ? new Response(JSON.stringify({ error: "authorization_pending" }), { status: 200 })
          : new Response(JSON.stringify({ access_token: "gho_new" }), { status: 200 });
      }
    ]
  ]);

  const statuses = [];
  const token = await newClient().pollForToken("dev-1", 1, 900, (s) => statuses.push(s));

  assert.equal(token, "gho_new");
  assert.equal(fake.api.storage.local.data[KEYS.token], "gho_new");
  assert.deepEqual(statuses, ["Waiting for authorization…"]);
});

test("pollForToken: backs off when GitHub asks it to slow down", async () => {
  await setClientId("Iv1.abc");
  let attempt = 0;
  routeFetch([
    [
      "login/oauth/access_token",
      () => {
        attempt++;
        return attempt === 1
          ? new Response(JSON.stringify({ error: "slow_down" }), { status: 200 })
          : new Response(JSON.stringify({ access_token: "gho_new" }), { status: 200 });
      }
    ]
  ]);

  const statuses = [];
  await newClient().pollForToken("dev-1", 1, 900, (s) => statuses.push(s));
  assert.deepEqual(statuses, ["Slowing down…"]);
});

test("pollForToken: rejects on an expired device code", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/oauth/access_token", json(200, { error: "expired_token" })]]);
  await assert.rejects(() => newClient().pollForToken("dev-1", 1, 900), /expired/);
  assert.equal(KEYS.token in fake.api.storage.local.data, false);
});

test("pollForToken: rejects when the user denies access", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/oauth/access_token", json(200, { error: "access_denied" })]]);
  await assert.rejects(() => newClient().pollForToken("dev-1", 1, 900), /denied/);
});

test("pollForToken: rejects on an unexpected error code", async () => {
  await setClientId("Iv1.abc");
  routeFetch([
    ["login/oauth/access_token", json(200, { error: "bad_verification_code", error_description: "Bad code" })]
  ]);
  await assert.rejects(() => newClient().pollForToken("dev-1", 1, 900), /Bad code/);
});

test("pollForToken: falls back to the error code when there is no description", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/oauth/access_token", json(200, { error: "incorrect_client_credentials" })]]);
  await assert.rejects(() => newClient().pollForToken("dev-1", 1, 900), /incorrect_client_credentials/);
});

test("pollForToken: defaults to a five second interval when none is given", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/oauth/access_token", json(200, { access_token: "gho_new" })]]);
  const client = new GitHubClient();
  const waits = [];
  client._sleep = async (ms) => waits.push(ms);

  assert.equal(await client.pollForToken("dev-1"), "gho_new");
  assert.deepEqual(waits, [5000]);
});

test("pollForToken: keeps polling through a transport failure", async () => {
  await setClientId("Iv1.abc");
  let attempt = 0;
  routeFetch([
    [
      "login/oauth/access_token",
      () => {
        attempt++;
        if (attempt === 1) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ access_token: "gho_new" }), { status: 200 });
      }
    ]
  ]);

  const statuses = [];
  const token = await newClient().pollForToken("dev-1", 1, 900, (s) => statuses.push(s));
  assert.equal(token, "gho_new");
  assert.deepEqual(statuses, ["Network hiccup, retrying…"]);
});

test("pollForToken: gives up once the device code window closes", async () => {
  await setClientId("Iv1.abc");
  routeFetch([["login/oauth/access_token", json(200, { error: "authorization_pending" })]]);
  const client = newClient();
  client._sleep = () => new Promise((resolve) => setTimeout(resolve, 5));
  await assert.rejects(() => client.pollForToken("dev-1", 1, 0.05), /Timed out/);
});

// --- checkRepo ---------------------------------------------------------------

const REPO = { owner: "acme", repo: "core", workflow: "run-tests.yml" };

test("checkRepo: reports ok when the repo and workflow both resolve", async () => {
  await fake.api.storage.local.set({ [KEYS.token]: "gho_x" });
  routeFetch([
    ["/actions/workflows/", json(200, { id: 1 })],
    ["/repos/acme/core", json(200, { full_name: "acme/core" })]
  ]);

  assert.deepEqual(await newClient().checkRepo(REPO), { ok: true, message: "ok" });
});

test("checkRepo: reports the repo failure when the repo is unreachable", async () => {
  await fake.api.storage.local.set({ [KEYS.token]: "gho_x" });
  routeFetch([["/repos/acme/core", json(404, { message: "Not Found" })]]);

  const result = await newClient().checkRepo(REPO);
  assert.equal(result.ok, false);
  assert.match(result.message, /404/);
});

test("checkRepo: prefixes a workflow failure so the cause is obvious", async () => {
  await fake.api.storage.local.set({ [KEYS.token]: "gho_x" });
  routeFetch([
    ["/actions/workflows/", json(404, { message: "Not Found" })],
    ["/repos/acme/core", json(200, { full_name: "acme/core" })]
  ]);

  const result = await newClient().checkRepo(REPO);
  assert.equal(result.ok, false);
  assert.match(result.message, /^workflow: /);
});

test("checkRepo: reports the auth failure instead of throwing", async () => {
  routeFetch([]);
  const result = await newClient().checkRepo(REPO);
  assert.equal(result.ok, false);
  assert.match(result.message, /Not connected/);
});
