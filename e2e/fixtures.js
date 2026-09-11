import path from "node:path";
import { fileURLToPath } from "node:url";

import { test as base, chromium, expect } from "@playwright/test";

const EXTENSION_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Loads the unpacked extension into a persistent context and exposes its id.
 * `browserChannel` selects the build under test (see the projects in
 * playwright.config.js).
 */
export const test = base.extend({
  browserChannel: ["chromium", { option: true }],

  context: async ({ browserChannel }, use, testInfo) => {
    let context;
    try {
      context = await chromium.launchPersistentContext("", {
        channel: browserChannel,
        args: [
          `--disable-extensions-except=${EXTENSION_ROOT}`,
          `--load-extension=${EXTENSION_ROOT}`
        ]
      });
    } catch (error) {
      testInfo.skip(true, `Browser channel "${browserChannel}" is unavailable: ${error.message}`);
      return;
    }
    await settleFirstRun(context);
    await use(context);
    await context.close();
  },

  extensionId: async ({ context }, use) => {
    const worker = await background(context);
    await use(new URL(worker.url()).host);
  },

  // Any uncaught exception or unhandled rejection in an extension page fails
  // the test, not just the assertions that happen to notice.
  pageErrors: [
    async ({ context }, use) => {
      const errors = [];
      const watch = (page) =>
        page.on("pageerror", (error) => errors.push(`${page.url()} → ${error.message}`));
      context.pages().forEach(watch);
      context.on("page", watch);

      await use(errors);

      if (errors.length) {
        throw new Error(`Uncaught page errors:\n  ${errors.join("\n  ")}`);
      }
    },
    { auto: true }
  ]
});

export { expect } from "@playwright/test";

export const popupUrl = (extensionId, query = "") =>
  `chrome-extension://${extensionId}/ui/popup.html${query}`;

export const optionsUrl = (extensionId) =>
  `chrome-extension://${extensionId}/ui/options.html`;

/**
 * Both pages attach their listeners partway through an async init(), so a click
 * sent before that lands on nothing. Each page writes its connection status
 * last, which makes it a reliable readiness signal.
 */
export async function waitForPopupReady(page) {
  await expect(page.locator("#connStatus")).not.toHaveText("…");
}

export async function waitForOptionsReady(page) {
  await expect(page.locator("#connStatus")).not.toBeEmpty();
}

export async function openPopup(context, extensionId, query = "") {
  const page = await context.newPage();
  await page.goto(popupUrl(extensionId, query));
  await waitForPopupReady(page);
  return page;
}

export async function openOptions(context, extensionId) {
  const page = await context.newPage();
  await page.goto(optionsUrl(extensionId));
  await waitForOptionsReady(page);
  return page;
}

/** The extension's MV3 service worker, waited for if it has not started yet. */
export async function background(context) {
  return context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
}

/**
 * A fresh profile fires onInstalled, which opens the Options page in the active
 * tab. Let that land before a spec navigates, otherwise it interrupts goto().
 */
async function settleFirstRun(context, timeoutMs = 10_000) {
  await background(context);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (context.pages().some((p) => p.url().includes("/ui/options.html"))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Write directly into extension storage, as the extension itself would. */
export async function seedStorage(context, { local = {}, sync = {} } = {}) {
  const worker = await background(context);
  await worker.evaluate(async ({ local: l, sync: s }) => {
    await chrome.storage.local.set(l);
    await chrome.storage.sync.set(s);
  }, { local, sync });
}

/** Read extension storage back out for assertions. */
export async function readStorage(context, area, keys) {
  const worker = await background(context);
  return worker.evaluate(
    ({ area: a, keys: k }) => chrome.storage[a].get(k),
    { area, keys }
  );
}

export const SAMPLE_REPO = {
  name: "Core",
  owner: "acme",
  repo: "core",
  workflow: "run-tests.yml",
  branch: "main",
  pathBase: "tests/",
  inputs: [
    { key: "test_path", label: "Test path", type: "text", options: [], default: "", isTestPath: true },
    { key: "environment", label: "Environment", type: "select", options: ["DEV", "QA"], default: "DEV", isTestPath: false },
    { key: "threads", label: "Threads", type: "number", options: [], default: "2", isTestPath: false },
    { key: "upload_report", label: "Upload report", type: "checkbox", options: [], default: false, isTestPath: false }
  ]
};

const jsonBody = (body) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify(body)
});

/**
 * Intercept every api.github.com call. Anything not explicitly stubbed fails
 * loudly instead of reaching the real API.
 * @returns {{dispatches: object[], searchQueries: string[]}} recorded traffic
 */
export async function mockGitHub(context, overrides = {}) {
  const cfg = {
    user: { login: "octocat" },
    searchItems: [
      {
        path: "tests/test_login.py",
        html_url: "https://github.com/acme/core/blob/main/tests/test_login.py"
      }
    ],
    fileContent: "def test_login():\n    pass\n",
    dispatchStatus: 200,
    dispatchBody: { html_url: "https://github.com/acme/core/actions/runs/42" },
    ...overrides
  };
  const recorded = { dispatches: [], searchQueries: [] };

  await context.route(/api\.github\.com/, (route) =>
    route.fulfill({ status: 599, body: `Unmocked GitHub call: ${route.request().url()}` })
  );

  await context.route(/api\.github\.com\/user$/, (route) => route.fulfill(jsonBody(cfg.user)));

  await context.route(/\/search\/code\?/, (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    recorded.searchQueries.push(q);
    route.fulfill(jsonBody({ total_count: cfg.searchItems.length, items: cfg.searchItems }));
  });

  await context.route(/\/contents\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: cfg.fileContent })
  );

  await context.route(/\/dispatches$/, (route) => {
    recorded.dispatches.push(JSON.parse(route.request().postData() || "{}"));
    route.fulfill({
      status: cfg.dispatchStatus,
      contentType: "application/json",
      body: JSON.stringify(cfg.dispatchBody)
    });
  });

  return recorded;
}
