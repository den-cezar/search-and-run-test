import { test, expect, mockGitHub, seedStorage, SAMPLE_REPO } from "./fixtures.js";

const TOKEN = "gho_e2e_token";

const popupUrl = (extensionId) => `chrome-extension://${extensionId}/ui/popup.html`;

/** Console output tagged by the extension logger. */
function captureExtensionLogs(page) {
  const lines = [];
  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[S&R:")) lines.push({ type: msg.type(), text });
  });
  return lines;
}

async function runSearch(page, extensionId) {
  await page.goto(popupUrl(extensionId));
  await page.fill("#testName", "test_login");
  await page.click("#searchBtn");
  await expect(page.locator("#resultsSection")).toBeVisible();
}

test("logs at info by default", async ({ context, extensionId }) => {
  await mockGitHub(context);
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO] }
  });

  const page = await context.newPage();
  const logs = captureExtensionLogs(page);
  await runSearch(page, extensionId);

  expect(logs.some((l) => l.type === "info" && l.text.includes("[S&R:popup]"))).toBe(true);
  expect(logs.some((l) => l.text.includes("searching"))).toBe(true);
});

test("silent suppresses every extension log", async ({ context, extensionId }) => {
  await mockGitHub(context, { dispatchStatus: 422, dispatchBody: { message: "No ref found" } });
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO], log_level: "silent" }
  });

  const page = await context.newPage();
  const logs = captureExtensionLogs(page);
  await runSearch(page, extensionId);
  await page.locator(".result-item").first().click();
  await page.click("#runBtn");
  await expect(page.locator("#message")).toBeVisible();

  expect(logs).toEqual([]);
});

test("error level keeps failures visible and drops the rest", async ({ context, extensionId }) => {
  await mockGitHub(context, { dispatchStatus: 422, dispatchBody: { message: "No ref found" } });
  await seedStorage(context, {
    local: { gh_access_token: TOKEN },
    sync: { repos_config: [SAMPLE_REPO], log_level: "error" }
  });

  const page = await context.newPage();
  const logs = captureExtensionLogs(page);
  await runSearch(page, extensionId);

  expect(logs.some((l) => l.text.includes("searching"))).toBe(false);

  await page.locator(".result-item").first().click();
  await page.click("#runBtn");
  await expect(page.locator("#message")).toBeVisible();

  expect(logs.some((l) => l.type === "error" && l.text.includes("dispatch failed"))).toBe(true);
});

test("the Options page applies a new level without a reload", async ({ context, extensionId }) => {
  await mockGitHub(context);

  const page = await context.newPage();
  const logs = captureExtensionLogs(page);
  await page.goto(`chrome-extension://${extensionId}/ui/options.html`);

  await page.selectOption("#logLevel", "silent");
  await page.click("#saveLogLevelBtn");
  await expect(page.locator("#message")).toContainText("Log level set to silent");

  const afterSave = logs.length;
  await page.click("#addRepoBtn");
  await page.fill("#repo-0-name", "Core");
  await page.fill("#repo-0-owner", "acme");
  await page.fill("#repo-0-repo", "core");
  await page.fill("#repo-0-workflow", "run.yml");
  await page.click("#saveReposBtn");
  await expect(page.locator("#message")).toContainText("Saved 1 repository");

  expect(logs.length).toBe(afterSave);
});
