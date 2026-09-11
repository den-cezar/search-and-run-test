import {
  test,
  expect,
  mockGitHub,
  seedStorage,
  readStorage,
  SAMPLE_REPO
} from "./fixtures.js";

const TOKEN = "gho_e2e_token";

const popupUrl = (extensionId, query = "") =>
  `chrome-extension://${extensionId}/ui/popup.html${query}`;

test("shows the disconnected state when no token is stored", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));

  await expect(page.locator("#notConnected")).toBeVisible();
  await expect(page.locator("#connStatus")).toHaveText("Disconnected");
  await expect(page.locator("#searchSection")).toBeHidden();
});

test("shows the signed-in user once a token is stored", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await seedStorage(context, { local: { gh_access_token: TOKEN } });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));

  await expect(page.locator("#connStatus")).toHaveText("@octocat");
  await expect(page.locator("#searchSection")).toBeVisible();
  await expect(page.locator("#notConnected")).toBeHidden();
});

test("falls back to disconnected when the token is rejected", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await context.route(/api\.github\.com\/user$/, (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Bad credentials"}' })
  );
  await seedStorage(context, { local: { gh_access_token: "expired" } });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));

  await expect(page.locator("#connStatus")).toHaveText("Disconnected");
  await expect(page.locator("#notConnected")).toBeVisible();
});

test("rejects an invalid test name before searching", async ({ context, extensionId }) => {
  const recorded = await mockGitHub(context);
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "not a test name!");
  await page.click("#searchBtn");

  await expect(page.locator("#testNameError")).toBeVisible();
  expect(recorded.searchQueries).toHaveLength(0);
});

test("search → select → configure → dispatch produces a run link", async ({ context, extensionId }) => {
  const recorded = await mockGitHub(context);
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));

  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");

  await expect(page.locator("#resultsSection")).toBeVisible();
  await expect(page.locator("#resultsCount")).toHaveText("1 test");
  expect(recorded.searchQueries[0]).toContain("repo:acme/core");

  await page.locator(".result-item").first().click();

  await expect(page.locator("#paramsSection")).toBeVisible();
  await expect(page.locator("#setupNotice")).toBeHidden();
  await expect(page.locator('#inputsForm input[readonly]')).toHaveValue(
    "test_login.py::test_login"
  );

  await page.selectOption("#inp-1", "QA");
  await page.fill("#inp-2", "4");
  await page.check("#inp-3");
  await page.click("#runBtn");

  await expect(page.locator("#outputSection")).toBeVisible();
  await expect(page.locator("#openRunLink")).toHaveAttribute(
    "href",
    "https://github.com/acme/core/actions/runs/42"
  );

  expect(recorded.dispatches).toHaveLength(1);
  expect(recorded.dispatches[0]).toMatchObject({
    ref: "main",
    inputs: {
      test_path: "test_login.py::test_login",
      environment: "QA",
      threads: "4",
      upload_report: "true"
    }
  });
});

test("dispatches the configured defaults when nothing is changed", async ({ context, extensionId }) => {
  const recorded = await mockGitHub(context);
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");
  await page.locator(".result-item").first().click();
  await page.click("#runBtn");

  expect(recorded.dispatches[0].inputs).toEqual({
    test_path: "test_login.py::test_login",
    environment: "DEV",
    threads: "2",
    upload_report: "false"
  });
});

test("blocks the run when the repo has no workflow inputs configured", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [{ ...SAMPLE_REPO, inputs: [] }] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");
  await page.locator(".result-item").first().click();

  await expect(page.locator("#setupNotice")).toBeVisible();
  await expect(page.locator("#runBtn")).toBeDisabled();
});

test("surfaces a dispatch failure instead of a run link", async ({ context, extensionId }) => {
  await mockGitHub(context, {
    dispatchStatus: 422,
    dispatchBody: { message: "No ref found for: nope" }
  });
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");
  await page.locator(".result-item").first().click();
  await page.fill("#runBranch", "nope");
  await page.click("#runBtn");

  await expect(page.locator("#message")).toBeVisible();
  await expect(page.locator("#message")).toContainText("422");
  await expect(page.locator("#outputSection")).toBeHidden();
});

test("consumes a context-menu selection and searches immediately", async ({ context, extensionId }) => {
  const recorded = await mockGitHub(context);
  await seedStorage(context, {
    local: {
      gh_access_token: TOKEN,
      pending_selection: { text: "test_login", ts: Date.now() }
    },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId, "?source=context"));

  await expect(page.locator("#testName")).toHaveValue("test_login");
  await expect(page.locator("#resultsSection")).toBeVisible();
  expect(recorded.searchQueries).toHaveLength(1);

  // The handoff is one-shot: reopening must not re-run the same search.
  const left = await readStorage(context, "local", "pending_selection");
  expect(left.pending_selection).toBeUndefined();
});

test("reports when the search finds nothing", async ({ context, extensionId }) => {
  await mockGitHub(context, { searchItems: [] });
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_missing");
  await page.click("#searchBtn");

  await expect(page.locator("#message")).toContainText("No test matching");
  await expect(page.locator("#resultsSection")).toBeHidden();
});

test("surfaces a search failure without leaving the search step", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await context.route(/\/search\/code\?/, (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"message":"Bad credentials"}' })
  );
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");

  await expect(page.locator("#message")).toContainText("Reconnect in Options");
  await expect(page.locator("#searchSection")).toBeVisible();
});

test("filters a long result list and navigates back and forth", async ({ context, extensionId }) => {
  const source = Array.from({ length: 6 }, (_, i) => `def test_login_case_${i}():\n    pass\n`).join("\n");
  await mockGitHub(context, { fileContent: source });
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");

  await expect(page.locator("#resultsCount")).toHaveText("6 tests");
  await expect(page.locator("#resultsFilter")).toBeVisible();

  await page.fill("#resultsFilter", "case_3");
  await expect(page.locator(".result-item")).toHaveCount(1);

  await page.fill("#resultsFilter", "nothing-matches");
  await expect(page.locator(".result-item")).toHaveCount(0);
  await expect(page.locator("#resultsList")).toContainText("No results match");

  await page.fill("#resultsFilter", "");
  await page.locator(".result-item").first().click();
  await expect(page.locator("#paramsSection")).toBeVisible();

  await page.click("#backBtn");
  await expect(page.locator("#resultsSection")).toBeVisible();
  await expect(page.locator(".result-item")).toHaveCount(6);

  await page.click("#newSearchBtn");
  await expect(page.locator("#searchSection")).toBeVisible();
});

test("escapes hostile repository data instead of executing it", async ({ context, extensionId }) => {
  const hostilePath = 'tests/"><img src=x onerror="window.__pwned=1">.py';
  await mockGitHub(context, {
    searchItems: [{ path: hostilePath, html_url: "https://example.invalid" }],
    fileContent: "def test_login():\n    pass\n"
  });
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [{ ...SAMPLE_REPO, name: '<img src=x onerror="window.__pwned=1">' }] }
  });

  const page = await context.newPage();
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");

  await expect(page.locator(".result-item")).toHaveCount(1);
  await page.locator(".result-item").first().click();

  await expect(page.locator("#inputsForm input[readonly]")).toHaveValue(
    '"><img src=x onerror="window.__pwned=1">.py::test_login'
  );
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator("#resultsList img, #selectedHit img").count()).toBe(0);
});
