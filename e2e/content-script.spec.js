import { test, expect, background } from "./fixtures.js";

const PAGE_URL = "https://example.atlassian.net/browse/AB-123";

const PAGE_HTML = `<!doctype html>
<html><body>
  <p id="target">test_login_with_valid_credentials[chrome]</p>
  <p id="other">not selected</p>
</body></html>`;

/** Ask every tab for its selection; the content script is the only responder. */
async function askTabsForSelection(context) {
  const worker = await background(context);
  return worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      const resp = await chrome.tabs
        .sendMessage(tab.id, { action: "getSelection" })
        .catch(() => null);
      if (resp) return resp;
    }
    return null;
  });
}

test("content script returns the current selection on an Atlassian page", async ({ context }) => {
  await context.route("https://example.atlassian.net/**", (route) =>
    route.fulfill({ contentType: "text/html", body: PAGE_HTML })
  );

  const page = await context.newPage();
  await page.goto(PAGE_URL);
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById("target"));
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  });

  const resp = await askTabsForSelection(context);
  expect(resp).toEqual({ selection: "test_login_with_valid_credentials[chrome]" });
});

test("content script reports an empty selection when nothing is highlighted", async ({ context }) => {
  await context.route("https://example.atlassian.net/**", (route) =>
    route.fulfill({ contentType: "text/html", body: PAGE_HTML })
  );

  const page = await context.newPage();
  await page.goto(PAGE_URL);

  const resp = await askTabsForSelection(context);
  expect(resp).toEqual({ selection: "" });
});

test("content script is not injected outside the configured hosts", async ({ context }) => {
  await context.route("https://example.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: PAGE_HTML })
  );

  const page = await context.newPage();
  await page.goto("https://example.com/");

  const resp = await askTabsForSelection(context);
  expect(resp).toBeNull();
});
