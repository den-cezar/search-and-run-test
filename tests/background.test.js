import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { KEYS } from "../config/config.js";
import { installFakeBrowser } from "./helpers/fake-browser.js";

const MENU_ID = "search-and-run-test";

let fake;

// The fake namespace must exist before background.js registers its listeners.
before(async () => {
  fake = installFakeBrowser();
  await import("../background.js");
});

beforeEach(async () => {
  await fake.api.storage.local.clear();
  fake.api.calls.windowsCreated.length = 0;
  fake.api.calls.contextMenusCreated.length = 0;
  fake.api.calls.optionsOpened = 0;
});

test("onInstalled: registers the selection context menu", async () => {
  await fake.api.runtime.onInstalled.emit({ reason: "update" });
  const [menu] = fake.api.calls.contextMenusCreated;
  assert.equal(menu.id, MENU_ID);
  assert.deepEqual(menu.contexts, ["selection"]);
});

test("onInstalled: opens Options on first install only", async () => {
  await fake.api.runtime.onInstalled.emit({ reason: "update" });
  assert.equal(fake.api.calls.optionsOpened, 0);

  await fake.api.runtime.onInstalled.emit({ reason: "install" });
  assert.equal(fake.api.calls.optionsOpened, 1);
});

test("onClicked: ignores clicks from other menu items", async () => {
  await fake.api.contextMenus.onClicked.emit({ menuItemId: "other", selectionText: "test_x" });
  assert.equal(fake.api.calls.windowsCreated.length, 0);
  assert.equal(KEYS.pendingSelection in fake.api.storage.local.data, false);
});

test("onClicked: ignores a blank selection", async () => {
  await fake.api.contextMenus.onClicked.emit({ menuItemId: MENU_ID, selectionText: "   " });
  assert.equal(fake.api.calls.windowsCreated.length, 0);
  assert.equal(KEYS.pendingSelection in fake.api.storage.local.data, false);
});

test("onClicked: ignores a click with no selection text at all", async () => {
  await fake.api.contextMenus.onClicked.emit({ menuItemId: MENU_ID });
  assert.equal(fake.api.calls.windowsCreated.length, 0);
  assert.equal(KEYS.pendingSelection in fake.api.storage.local.data, false);
});

test("onClicked: stores the trimmed selection and opens the runner popup", async () => {
  await fake.api.contextMenus.onClicked.emit({
    menuItemId: MENU_ID,
    selectionText: "  test_login[chrome]  "
  });

  assert.equal(fake.api.storage.local.data[KEYS.pendingSelection].text, "test_login[chrome]");

  const [win] = fake.api.calls.windowsCreated;
  assert.equal(win.type, "popup");
  assert.match(win.url, /ui\/popup\.html\?source=context$/);
});

test("onClicked: stores the selection before opening the window", async () => {
  const seen = [];
  const originalCreate = fake.api.windows.create;
  fake.api.windows.create = (def) => {
    seen.push(KEYS.pendingSelection in fake.api.storage.local.data);
    return originalCreate(def);
  };
  try {
    await fake.api.contextMenus.onClicked.emit({
      menuItemId: MENU_ID,
      selectionText: "test_order"
    });
    assert.deepEqual(seen, [true]);
  } finally {
    fake.api.windows.create = originalCreate;
  }
});
