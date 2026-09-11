import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GitHubClient } from "../api/github-client.js";
import { KEYS } from "../config/config.js";
import { installFakeBrowser } from "./helpers/fake-browser.js";

const TOKEN = "ghu_test_token";

let fake;
let originalFetch;
let calls;

/** Queue responses (or handler functions) for successive fetch calls. */
function stubFetch(queue) {
  calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    const next = queue.shift();
    if (next === undefined) throw new Error(`Unexpected fetch call: ${url}`);
    return typeof next === "function" ? next(url, options) : next;
  };
  return calls;
}

function json(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

/** Client with real timers replaced so retry tests stay fast. */
function newClient() {
  const client = new GitHubClient();
  client._sleep = async () => {};
  return client;
}

beforeEach(() => {
  fake = installFakeBrowser({ local: { [KEYS.token]: TOKEN } });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fake.restore();
});

// --- auth headers ------------------------------------------------------------

test("_request: fails without a stored token and never calls the network", async () => {
  await fake.api.storage.local.clear();
  stubFetch([]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "auth");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("_request: sends the bearer token and API version headers", async () => {
  stubFetch([json(200, { login: "octocat" })]);
  const user = await newClient().getUser();
  assert.equal(user.login, "octocat");
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].options.headers["X-GitHub-Api-Version"], "2022-11-28");
});

// --- error mapping -----------------------------------------------------------

test("_explainError: 401 maps to an auth error", async () => {
  stubFetch([json(401, { message: "Bad credentials" })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "auth");
    assert.equal(e.status, 401);
    return true;
  });
});

test("_explainError: an SSO header maps to an sso error", async () => {
  stubFetch([json(403, {}, { "x-github-sso": "required; url=https://github.com/orgs/acme/sso" })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "sso");
    return true;
  });
});

test("_explainError: exhausted rate limit maps to rate-limit", async () => {
  stubFetch([
    json(403, {}, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1700000000" })
  ]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "rate-limit");
    assert.match(e.message, /rate limit/i);
    return true;
  });
});

test("_explainError: plain 403 maps to auth, not rate-limit", async () => {
  stubFetch([json(403, {}, { "x-ratelimit-remaining": "58" })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "auth");
    assert.equal(e.status, 403);
    return true;
  });
});

test("_explainError: 404 maps to not-found", async () => {
  stubFetch([json(404, { message: "Not Found" })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "not-found");
    return true;
  });
});

test("_explainError: other failures include the server message", async () => {
  stubFetch([json(422, { message: "Invalid request" }), json(422, { message: "Invalid request" })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "http");
    assert.match(e.message, /Invalid request/);
    return true;
  });
});

test("_explainError: falls back to the raw body when it is not JSON", async () => {
  stubFetch([new Response("<html>gateway down</html>", { status: 400 })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.status, 400);
    assert.match(e.message, /gateway down/);
    return true;
  });
});

test("_explainError: omits the detail when the body is empty", async () => {
  stubFetch([new Response("", { status: 418 })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.message, "GitHub request failed (418)");
    return true;
  });
});

test("_explainError: omits the detail when the JSON body has no message", async () => {
  stubFetch([json(400, { documentation_url: "https://docs.github.com" })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.message, "GitHub request failed (400)");
    return true;
  });
});

test("_explainError: survives a body that cannot be read", async () => {
  const broken = new ReadableStream({
    start(controller) {
      controller.error(new Error("connection reset"));
    }
  });
  stubFetch([new Response(broken, { status: 400 })]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.message, "GitHub request failed (400)");
    return true;
  });
});

// --- retries -----------------------------------------------------------------

test("_request: retries a 500 and succeeds on the next attempt", async () => {
  stubFetch([json(500, { message: "boom" }), json(200, { login: "octocat" })]);
  const user = await newClient().getUser();
  assert.equal(user.login, "octocat");
  assert.equal(calls.length, 2);
});

test("_request: honours a retry-after header", async () => {
  stubFetch([json(429, {}, { "retry-after": "3" }), json(200, { login: "octocat" })]);
  const client = newClient();
  const waits = [];
  client._sleep = async (ms) => waits.push(ms);
  await client.getUser();
  assert.deepEqual(waits, [3000]);
});

test("_request: backs off exponentially without a retry-after header", async () => {
  stubFetch([json(500, {}), json(500, {}), json(200, { login: "octocat" })]);
  const client = new GitHubClient();
  const waits = [];
  client._sleep = async (ms) => waits.push(ms);
  await client._request("https://api.github.com/user", {}, { retries: 2 });
  assert.deepEqual(waits, [1000, 2000]);
});

test("_sleep: actually waits", async () => {
  const started = Date.now();
  await new GitHubClient()._sleep(15);
  assert.ok(Date.now() - started >= 10);
});

test("_request: retries a network failure before giving up", async () => {
  stubFetch([
    () => {
      throw new TypeError("Failed to fetch");
    },
    () => {
      throw new TypeError("Failed to fetch");
    }
  ]);
  await assert.rejects(() => newClient().getUser(), (e) => {
    assert.equal(e.kind, "network");
    return true;
  });
  assert.equal(calls.length, 2);
});

// --- search guards -----------------------------------------------------------

test("searchTest: rejects an empty test name before hitting the network", async () => {
  stubFetch([]);
  await assert.rejects(() => newClient().searchTest("   "), (e) => {
    assert.equal(e.kind, "input");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("searchTest: rejects when no repositories are configured", async () => {
  stubFetch([]);
  await assert.rejects(() => newClient().searchTest("test_login"), (e) => {
    assert.equal(e.kind, "input");
    assert.match(e.message, /No repositories configured/);
    return true;
  });
  assert.equal(calls.length, 0);
});

test("searchTest: builds a scoped code-search query per repo", async () => {
  await fake.api.storage.sync.set({
    [KEYS.repos]: [
      {
        name: "Core",
        owner: "acme",
        repo: "core",
        workflow: "run.yml",
        pathBase: "tests/",
        branch: "main",
        inputs: []
      }
    ]
  });
  stubFetch([json(200, { items: [] })]);

  const { searchTerm, results } = await newClient().searchTest("test_login[chrome]");

  assert.equal(searchTerm, "test_login");
  assert.deepEqual(results, []);
  const query = decodeURIComponent(new URL(calls[0].url).searchParams.get("q"));
  assert.match(query, /^test_login in:file language:python repo:acme\/core path:tests$/);
});

// --- dispatch ----------------------------------------------------------------

const HIT = {
  owner: "acme",
  repo: "core",
  workflow: "run-tests.yml",
  branch: "main",
  testPath: "tests/test_login.py::test_login"
};

test("dispatchWorkflow: posts ref, inputs and run details to the workflow endpoint", async () => {
  stubFetch([json(200, { html_url: "https://github.com/acme/core/actions/runs/1" })]);

  const out = await newClient().dispatchWorkflow(HIT, {
    ref: "develop",
    inputs: { test_path: HIT.testPath, threads: "4" }
  });

  assert.equal(out.html_url, "https://github.com/acme/core/actions/runs/1");
  assert.equal(
    calls[0].url,
    "https://api.github.com/repos/acme/core/actions/workflows/run-tests.yml/dispatches"
  );
  assert.equal(calls[0].options.method, "POST");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.ref, "develop");
  assert.equal(body.return_run_details, true);
  assert.deepEqual(body.inputs, { test_path: HIT.testPath, threads: "4" });
});

test("dispatchWorkflow: falls back to the repo branch when no ref is given", async () => {
  stubFetch([new Response(null, { status: 204 })]);
  const out = await newClient().dispatchWorkflow(HIT, { inputs: {} });
  assert.equal(out.html_url, null);
  assert.equal(JSON.parse(calls[0].options.body).ref, "main");
});

test("dispatchWorkflow: defaults the ref and inputs for a hit with neither", async () => {
  stubFetch([new Response(null, { status: 204 })]);
  await newClient().dispatchWorkflow({ owner: "acme", repo: "core", workflow: "run.yml" }, {});
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.ref, "main");
  assert.deepEqual(body.inputs, {});
});

test("dispatchWorkflow: turns a 422 into an actionable message", async () => {
  stubFetch([json(422, { message: "No ref found" })]);
  await assert.rejects(
    () => newClient().dispatchWorkflow(HIT, { ref: "missing", inputs: {} }),
    (e) => {
      assert.equal(e.status, 422);
      assert.equal(e.kind, "input");
      assert.match(e.message, /missing/);
      return true;
    }
  );
});

test("dispatchWorkflow: rethrows failures that are not a 422", async () => {
  stubFetch([json(401, { message: "Bad credentials" })]);
  await assert.rejects(
    () => newClient().dispatchWorkflow(HIT, { inputs: {} }),
    (e) => {
      assert.equal(e.status, 401);
      assert.equal(e.kind, "auth");
      return true;
    }
  );
});

test("dispatchWorkflow: accepts run_url when html_url is absent", async () => {
  stubFetch([json(200, { run_url: "https://api.github.com/repos/acme/core/actions/runs/7" })]);
  const out = await newClient().dispatchWorkflow(HIT, { inputs: {} });
  assert.equal(out.html_url, "https://api.github.com/repos/acme/core/actions/runs/7");
});

test("dispatchWorkflow: survives a 200 with an unreadable body", async () => {
  stubFetch([new Response("not json", { status: 200 })]);
  const out = await newClient().dispatchWorkflow(HIT, { inputs: {} });
  assert.equal(out.html_url, null);
});

test("GitHubClient.parseTestName: exposes the shared parser", () => {
  assert.deepEqual(GitHubClient.parseTestName(" test_x[AP] "), {
    searchTerm: "test_x",
    paramSuffix: "[AP]",
    fullName: "test_x[AP]"
  });
});
