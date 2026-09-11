/**
 * WebExtension API accessor.
 *
 * Firefox exposes the promise-based `browser` namespace; Chrome and Edge expose
 * `chrome`. Resolved on every call rather than at import time so modules can be
 * loaded (and tested) outside an extension context.
 */
export function getBrowserApi() {
  return globalThis.browser ?? globalThis.chrome ?? null;
}

/** True when running inside an extension with the storage API available. */
export function hasStorage() {
  const api = getBrowserApi();
  return Boolean(api && api.storage && api.storage.sync && api.storage.local);
}
