import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { GitHubClient } from "../api/github-client.js";
import { KEYS } from "../config/config.js";
import { installFakeBrowser } from "./helpers/fake-browser.js";
import { routeFetch, json, text, networkError, callsTo } from "./helpers/fake-fetch.js";

const SOURCE = [
  "def test_login():",
  "    pass",
  "",
  "def test_login_invalid():",
  "    pass",
  "",
  "def test_logout():",
  "    pass"
].join("\n");

const repoCfg = (over = {}) => ({
  name: "Core",
  owner: "acme",
  repo: "core",
  workflow: "run-tests.yml",
  branch: "main",
  pathBase: "tests/",
  inputs: [{ key: "test_path", type: "text", options: [], default: "", isTestPath: true }],
  ...over
});

const searchHit = (path = "tests/test_login.py") => ({
  path,
  html_url: `https://github.com/acme/core/blob/main/${path}`
});

let fake;
let originalFetch;

function newClient() {
  const client = new GitHubClient();
  client._sleep = async () => {};
  return client;
}

async function setRepos(...repos) {
  await fake.api.storage.sync.set({ [KEYS.repos]: repos });
}

beforeEach(async () => {
  fake = installFakeBrowser({ local: { [KEYS.token]: "gho_x" } });
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  fake.restore();
});

// --- hit construction --------------------------------------------------------

test("searchTest: builds one hit per matching function in the file", async () => {
  await setRepos(repoCfg());
  routeFetch([
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, SOURCE)]
  ]);

  const { results } = await newClient().searchTest("test_login");

  assert.deepEqual(
    results.map((r) => r.funcName),
    ["test_login", "test_login_invalid"]
  );
  assert.deepEqual(
    results.map((r) => r.testPath),
    ["test_login.py::test_login", "test_login.py::test_login_invalid"]
  );
});

test("searchTest: carries the repo config onto every hit", async () => {
  await setRepos(repoCfg());
  routeFetch([
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, "def test_login():\n    pass\n")]
  ]);

  const [hit] = (await newClient().searchTest("test_login")).results;

  assert.deepEqual(hit, {
    repoName: "Core",
    owner: "acme",
    repo: "core",
    workflow: "run-tests.yml",
    branch: "main",
    inputs: repoCfg().inputs,
    filePath: "tests/test_login.py",
    funcName: "test_login",
    testPath: "test_login.py::test_login",
    htmlUrl: "https://github.com/acme/core/blob/main/tests/test_login.py"
  });
});

test("searchTest: keeps the parameter suffix only on the exact match", async () => {
  await setRepos(repoCfg());
  routeFetch([
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, SOURCE)]
  ]);

  const { searchTerm, results } = await newClient().searchTest("test_login[QA-chrome]");

  assert.equal(searchTerm, "test_login");
  assert.deepEqual(
    results.map((r) => r.funcName),
    ["test_login[QA-chrome]", "test_login_invalid"]
  );
  assert.equal(results[0].testPath, "test_login.py::test_login[QA-chrome]");
});

test("searchTest: falls back to the bare term when the file cannot be read", async () => {
  await setRepos(repoCfg());
  routeFetch([
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", json(404, { message: "Not Found" })]
  ]);

  const { results } = await newClient().searchTest("test_login");

  assert.equal(results.length, 1);
  assert.equal(results[0].funcName, "test_login");
  assert.equal(results[0].testPath, "test_login.py::test_login");
});

test("searchTest: reads the file on the configured branch", async () => {
  await setRepos(repoCfg({ branch: "develop" }));
  const calls = routeFetch([
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, SOURCE)]
  ]);

  await newClient().searchTest("test_login");

  const [read] = callsTo(calls, "/contents/");
  assert.match(read.url, /\?ref=develop$/);
  assert.equal(read.options.headers.Accept, "application/vnd.github.raw+json");
});

test("searchTest: omits the path qualifier when no path base is configured", async () => {
  await setRepos(repoCfg({ pathBase: "" }));
  const calls = routeFetch([
    ["/search/code", json(200, { items: [] })]
  ]);

  await newClient().searchTest("test_login");

  const q = decodeURIComponent(new URL(calls[0].url).searchParams.get("q"));
  assert.equal(q, "test_login in:file language:python repo:acme/core");
});

test("searchTest: leaves the file path untouched when it does not start with the path base", async () => {
  await setRepos(repoCfg({ pathBase: "other/" }));
  routeFetch([
    ["/search/code", json(200, { items: [searchHit("tests/test_login.py")] })],
    ["/contents/", text(200, "def test_login():\n    pass\n")]
  ]);

  const [hit] = (await newClient().searchTest("test_login")).results;
  assert.equal(hit.testPath, "tests/test_login.py::test_login");
});

test("searchTest: returns nothing when the code search has no items", async () => {
  await setRepos(repoCfg());
  routeFetch([["/search/code", json(200, { items: [] })]]);

  const { results } = await newClient().searchTest("test_missing");
  assert.deepEqual(results, []);
});

test("searchTest: tolerates a search response with no items field", async () => {
  await setRepos(repoCfg());
  routeFetch([["/search/code", json(200, {})]]);

  const { results } = await newClient().searchTest("test_missing");
  assert.deepEqual(results, []);
});

test("searchTest: fills in defaults for a repo config missing optional fields", async () => {
  await setRepos({ name: "Legacy", owner: "acme", repo: "core", workflow: "run.yml" });
  const calls = routeFetch([
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, "def test_login():\n    pass\n")]
  ]);

  const [hit] = (await newClient().searchTest("test_login")).results;

  assert.equal(hit.branch, "main");
  assert.deepEqual(hit.inputs, []);
  assert.equal(hit.testPath, "tests/test_login.py::test_login");
  assert.match(callsTo(calls, "/contents/")[0].url, /\?ref=main$/);
});

// --- multi-repo aggregation --------------------------------------------------

test("searchTest: merges hits from every configured repo", async () => {
  await setRepos(repoCfg(), repoCfg({ name: "Api", repo: "api" }));
  routeFetch([
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, "def test_login():\n    pass\n")]
  ]);

  const { results } = await newClient().searchTest("test_login");

  assert.deepEqual(results.map((r) => r.repoName).sort(), ["Api", "Core"]);
});

test("searchTest: tolerates a repo whose search fails with a non-fatal error", async () => {
  await setRepos(repoCfg(), repoCfg({ name: "Api", repo: "api" }));
  routeFetch([
    ["acme%2Fapi", json(404, { message: "Not Found" })],
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, "def test_login():\n    pass\n")]
  ]);

  const { results } = await newClient().searchTest("test_login");

  assert.deepEqual(
    results.map((r) => r.repoName),
    ["Core"]
  );
});

test("searchTest: tolerates a repo that fails with a server error after retries", async () => {
  await setRepos(repoCfg(), repoCfg({ name: "Api", repo: "api" }));
  const calls = routeFetch([
    ["acme%2Fapi", json(500, { message: "boom" })],
    ["/search/code", json(200, { items: [searchHit()] })],
    ["/contents/", text(200, "def test_login():\n    pass\n")]
  ]);

  const { results } = await newClient().searchTest("test_login");

  assert.equal(results.length, 1);
  assert.equal(callsTo(calls, "acme%2Fapi").length, 3);
});

const FATAL_CASES = [
  ["an expired token", json(401, { message: "Bad credentials" }), "auth"],
  ["an SSO challenge", json(403, {}, { "x-github-sso": "required" }), "sso"],
  ["an exhausted rate limit", json(403, {}, { "x-ratelimit-remaining": "0" }), "rate-limit"],
  ["a dead connection", networkError(), "network"]
];

for (const [name, respond, kind] of FATAL_CASES) {
  test(`searchTest: ${name} in one repo fails the whole search`, async () => {
    await setRepos(repoCfg(), repoCfg({ name: "Api", repo: "api" }));
    routeFetch([
      ["acme%2Fapi", respond],
      ["/search/code", json(200, { items: [] })]
    ]);

    await assert.rejects(() => newClient().searchTest("test_login"), (e) => {
      assert.equal(e.kind, kind);
      return true;
    });
  });
}

// --- guards ------------------------------------------------------------------

test("searchTest: a name that is only a parameter suffix is rejected", async () => {
  await setRepos(repoCfg());
  const calls = routeFetch([]);
  await assert.rejects(() => newClient().searchTest("[QA]"), (e) => {
    assert.equal(e.kind, "input");
    return true;
  });
  assert.equal(calls.length, 0);
});

test("getUser: returns the authenticated login", async () => {
  routeFetch([["/user", json(200, { login: "octocat" })]]);
  assert.equal((await newClient().getUser()).login, "octocat");
});
