/**
 * Content script — captures the current text selection on Jira/Confluence
 * pages so the popup can pre-fill the test name when opened from the toolbar.
 */

// Content scripts are not modules, so the API namespace is resolved inline.
const api = globalThis.browser ?? globalThis.chrome;

api.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request && request.action === "getSelection") {
    const selection = (window.getSelection ? window.getSelection().toString() : "").trim();
    sendResponse({ selection });
    return true;
  }
  return false;
});
