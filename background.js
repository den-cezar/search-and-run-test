/**
 * Background service worker (Manifest V3, module).
 * - Registers the right-click "Search & Run Test" context menu.
 * - Hands the selected text to the runner popup window.
 */

import { storage } from "./api/storage-service.js";

const MENU_ID = "search-and-run-test";

chrome.runtime.onInstalled.addListener((details) => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Search and Run Test: "%s"',
    contexts: ["selection"]
  });

  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;

  const selection = (info.selectionText || "").trim();
  if (!selection) return;

  await storage.setPendingSelection(selection);

  chrome.windows.create({
    url: chrome.runtime.getURL("ui/popup.html?source=context"),
    type: "popup",
    width: 460,
    height: 640
  });
});

