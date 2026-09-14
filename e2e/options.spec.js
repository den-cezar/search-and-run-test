import { test, expect, mockGitHub, seedStorage, readStorage, openOptions } from "./fixtures.js";

const TOKEN = "gho_e2e_token";


async function fillRepoRow(page, index, values) {
  for (const [field, value] of Object.entries(values)) {
    await page.fill(`#repo-${index}-${field}`, value);
  }
}

test("saves a repository and reloads it from sync storage", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  await expect(page.locator("#saveReposBtn")).toBeDisabled();
  await page.click("#addRepoBtn");
  await expect(page.locator("#saveReposBtn")).toBeEnabled();

  await fillRepoRow(page, 0, {
    name: "Core",
    owner: "acme",
    repo: "core",
    workflow: "run-tests.yml",
    branch: "main",
    pathBase: "tests/"
  });
  await page.click("#saveReposBtn");

  await expect(page.locator("#message")).toContainText("Saved 1 repository");
  await expect(page.locator("#saveReposBtn")).toBeDisabled();

  const stored = await readStorage(context, "sync", "repos_config");
  expect(stored.repos_config).toMatchObject([
    { name: "Core", owner: "acme", repo: "core", workflow: "run-tests.yml", pathBase: "tests/" }
  ]);

  await page.reload();
  await expect(page.locator("#repo-0-owner")).toHaveValue("acme");
  await expect(page.locator("#repo-0-workflow")).toHaveValue("run-tests.yml");
});

test("refuses to save an incomplete repository", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  await page.click("#addRepoBtn");
  await fillRepoRow(page, 0, { name: "Broken", owner: "acme" });
  await page.click("#saveReposBtn");

  await expect(page.locator("#message")).toHaveClass(/error/);
  const stored = await readStorage(context, "sync", "repos_config");
  expect(stored.repos_config).toBeUndefined();
});

test("removes a repository and persists the removal", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await seedStorage(context, {
    sync: {
      repos_config: [
        { name: "Core", owner: "acme", repo: "core", workflow: "run.yml", branch: "main", pathBase: "", inputs: [] }
      ]
    }
  });

  const page = await openOptions(context, extensionId);
  await expect(page.locator("#repo-0-name")).toHaveValue("Core");

  await page.click(".remove-repo");
  await page.click("#saveReposBtn");

  await expect(page.locator("#message")).toContainText("Saved 0 repository");
  const stored = await readStorage(context, "sync", "repos_config");
  expect(stored.repos_config).toEqual([]);
});

test("saves the log level", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  await expect(page.locator("#saveLogLevelBtn")).toBeDisabled();
  await page.selectOption("#logLevel", "debug");
  await page.click("#saveLogLevelBtn");

  await expect(page.locator("#message")).toContainText("Log level set to debug");
  const stored = await readStorage(context, "sync", "log_level");
  expect(stored.log_level).toBe("debug");

  await page.reload();
  await expect(page.locator("#logLevel")).toHaveValue("debug");
});

test("shows the connected user and clears the token on disconnect", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await seedStorage(context, { local: { gh_access_token: TOKEN } });

  const page = await openOptions(context, extensionId);

  await expect(page.locator("#connStatus")).toContainText("@octocat");

  await page.click("#disconnectBtn");
  await expect(page.locator("#connStatus")).toContainText("Not connected");

  const stored = await readStorage(context, "local", "gh_access_token");
  expect(stored.gh_access_token).toBeUndefined();
});

test("stores the OAuth client id when the field changes", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  await page.fill("#clientId", "Iv1.e2eclientid");
  await page.locator("#clientId").blur();

  await expect
    .poll(async () => (await readStorage(context, "sync", "oauth_client_id")).oauth_client_id)
    .toBe("Iv1.e2eclientid");
});

// --- import / export ---------------------------------------------------------

const IMPORTABLE = [
  {
    name: "Imported",
    owner: "acme",
    repo: "imported",
    workflow: "ci.yml",
    branch: "release",
    pathBase: "qa/",
    inputs: [
      { key: "test_path", label: "Test path", type: "text", isTestPath: true },
      { key: "environment", label: "Env", type: "select", options: "DEV, QA", default: "QA" }
    ]
  }
];

const upload = (page, name, contents) =>
  page.setInputFiles("#importReposFile", {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(contents)
  });

test("imports a repository config and saves it", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  await upload(page, "repos.json", JSON.stringify(IMPORTABLE));

  await expect(page.locator("#message")).toContainText("Imported 1 repository");
  await expect(page.locator("#repo-0-owner")).toHaveValue("acme");
  await expect(page.locator("#repo-0-branch")).toHaveValue("release");
  await expect(page.locator("#saveReposBtn")).toBeEnabled();

  await page.click("#saveReposBtn");

  const stored = await readStorage(context, "sync", "repos_config");
  expect(stored.repos_config).toMatchObject([
    {
      name: "Imported",
      owner: "acme",
      repo: "imported",
      workflow: "ci.yml",
      branch: "release",
      pathBase: "qa/"
    }
  ]);
  // Options arrive as a comma string and must be normalized to an array.
  expect(stored.repos_config[0].inputs[1].options).toEqual(["DEV", "QA"]);
  expect(stored.repos_config[0].inputs[0].isTestPath).toBe(true);
});

test("imports a wrapped { repos: [...] } document", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  await upload(page, "repos.json", JSON.stringify({ repos: IMPORTABLE }));

  await expect(page.locator("#message")).toContainText("Imported 1 repository");
  await expect(page.locator("#repo-0-repo")).toHaveValue("imported");
});

const BAD_IMPORTS = [
  ["malformed JSON", "{ not json"],
  ["a document that is not a repo list", JSON.stringify({ unexpected: true })],
  ["a bare string", JSON.stringify("nope")]
];

for (const [name, contents] of BAD_IMPORTS) {
  test(`rejects ${name} without touching the saved config`, async ({ context, extensionId }) => {
    await mockGitHub(context);
    await seedStorage(context, {
      sync: {
        repos_config: [
          { name: "Core", owner: "acme", repo: "core", workflow: "run.yml", branch: "main", pathBase: "", inputs: [] }
        ]
      }
    });

    const page = await openOptions(context, extensionId);
    await upload(page, "broken.json", contents);

    await expect(page.locator("#message")).toContainText("Import failed");
    await expect(page.locator("#repo-0-name")).toHaveValue("Core");
    const stored = await readStorage(context, "sync", "repos_config");
    expect(stored.repos_config).toHaveLength(1);
  });
}

test("re-importing the same file after a failure still works", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  await upload(page, "repos.json", "{ not json");
  await expect(page.locator("#message")).toContainText("Import failed");

  await upload(page, "repos.json", JSON.stringify(IMPORTABLE));
  await expect(page.locator("#message")).toContainText("Imported 1 repository");
});

test("exports the saved repositories as JSON", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await seedStorage(context, { sync: { repos_config: IMPORTABLE } });

  const page = await openOptions(context, extensionId);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#exportReposBtn")
  ]);

  expect(download.suggestedFilename()).toBe("search-and-run-repos.json");
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString());

  expect(exported).toMatchObject([{ name: "Imported", owner: "acme", repo: "imported" }]);
});

test("an exported config can be imported back unchanged", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await seedStorage(context, { sync: { repos_config: IMPORTABLE } });

  const page = await openOptions(context, extensionId);

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#exportReposBtn")
  ]);
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const exported = Buffer.concat(chunks).toString();

  await upload(page, "round-trip.json", exported);
  await page.click("#saveReposBtn");

  await expect(page.locator("#message")).toContainText("Saved 1 repository");
  const stored = await readStorage(context, "sync", "repos_config");
  expect(stored.repos_config[0].owner).toBe("acme");
});

test("escapes hostile values in an imported config", async ({ context, extensionId }) => {
  await mockGitHub(context);
  const page = await openOptions(context, extensionId);

  // Pre-encoded entities must not be decoded back into live markup.
  await upload(
    page,
    "hostile.json",
    JSON.stringify([
      {
        name: '&lt;img src=x onerror="window.__pwned=1"&gt;',
        owner: '"><img src=y onerror="window.__pwned=1">',
        repo: "core",
        workflow: "run.yml"
      }
    ])
  );

  await expect(page.locator(".repo-row")).toHaveCount(1);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(await page.locator(".repo-row img").count()).toBe(0);
  await expect(page.locator("#repo-0-owner")).toHaveValue('"><img src=y onerror="window.__pwned=1">');
});
