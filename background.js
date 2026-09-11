/**
 * Background service worker (Manifest V3, module).
 * - Registers the right-click "Search & Run Test" context menu.
 * - Hands the selected text to the runner popup window.
 */

import { storage } from "./api/storage-service.js";
import { getBrowserApi } from "./lib/browser-api.js";

const api = getBrowserApi();
const MENU_ID = "search-and-run-test";

api.runtime.onInstalled.addListener((details) => {
  api.contextMenus.create({
    id: MENU_ID,
    title: 'Search and Run Test: "%s"',
    contexts: ["selection"]
  });

  if (details.reason === "install") {
    api.runtime.openOptionsPage();
  }
});

api.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;

  const selection = (info.selectionText || "").trim();
  if (!selection) return;

  await storage.setPendingSelection(selection);

  api.windows.create({
    url: api.runtime.getURL("ui/popup.html?source=context"),
    type: "popup",
    width: 460,
    height: 640
  });
});

