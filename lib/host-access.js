/**
 * Host access helpers.
 *
 * Firefox treats `host_permissions` as optional in Manifest V3: they are not
 * granted at install, so the content script does not inject and GitHub calls
 * fail until the user grants them. Chromium grants them at install, so these
 * checks are a no-op there.
 */

import { getBrowserApi } from "./browser-api.js";

/** Origins the extension cannot work without, read from the manifest. */
export function requiredOrigins(api = getBrowserApi()) {
  const manifest = api && api.runtime && api.runtime.getManifest
    ? api.runtime.getManifest()
    : null;
  if (!manifest) return [];

  const fromContentScripts = (manifest.content_scripts || []).flatMap(
    (cs) => cs.matches || []
  );
  return [...new Set([...(manifest.host_permissions || []), ...fromContentScripts])];
}

/**
 * @returns {Promise<boolean>} true when every required origin is granted, or
 * when the browser does not expose the permissions API.
 */
export async function hasHostAccess(api = getBrowserApi()) {
  if (!api || !api.permissions || !api.permissions.contains) return true;
  const origins = requiredOrigins(api);
  if (!origins.length) return true;
  try {
    return Boolean(await api.permissions.contains({ origins }));
  } catch (_) {
    return true; // an unsupported query must not block the UI
  }
}

/**
 * Ask for the missing origins. Must be called from a user gesture.
 * @returns {Promise<boolean>} whether access is granted afterwards
 */
export async function requestHostAccess(api = getBrowserApi()) {
  if (!api || !api.permissions || !api.permissions.request) return true;
  const origins = requiredOrigins(api);
  if (!origins.length) return true;
  try {
    return Boolean(await api.permissions.request({ origins }));
  } catch (_) {
    return false;
  }
}
