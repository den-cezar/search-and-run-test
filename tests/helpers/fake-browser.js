/**
 * In-memory stand-in for the WebExtension APIs the extension touches.
 * Everything is promise-based, which is how Firefox's `browser` namespace and
 * Chrome's MV3 `chrome` namespace both behave.
 */

export class FakeStorageArea {
  constructor(initial = {}) {
    this.data = { ...initial };
  }

  async get(keys) {
    if (keys === null || keys === undefined) return { ...this.data };
    if (typeof keys === "string") {
      return keys in this.data ? { [keys]: this.data[keys] } : {};
    }
    if (Array.isArray(keys)) {
      const out = {};
      for (const k of keys) {
        if (k in this.data) out[k] = this.data[k];
      }
      return out;
    }
    const out = { ...keys };
    for (const k of Object.keys(keys)) {
      if (k in this.data) out[k] = this.data[k];
    }
    return out;
  }

  async set(items) {
    Object.assign(this.data, items);
  }

  async remove(keys) {
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      delete this.data[k];
    }
  }

  async clear() {
    this.data = {};
  }
}

/** Minimal event emitter matching the `addListener` shape. */
export function fakeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener(fn) {
      listeners.push(fn);
    },
    async emit(...args) {
      const results = [];
      for (const fn of listeners) {
        results.push(await fn(...args));
      }
      return results;
    }
  };
}

/**
 * @param {{local?: object, sync?: object}} [initial] seed data per storage area
 */
export function createFakeBrowser(initial = {}) {
  const calls = { contextMenusCreated: [], windowsCreated: [], optionsOpened: 0, messages: [] };

  return {
    calls,
    storage: {
      local: new FakeStorageArea(initial.local),
      sync: new FakeStorageArea(initial.sync)
    },
    runtime: {
      onInstalled: fakeEvent(),
      onMessage: fakeEvent(),
      getURL: (path) => `chrome-extension://fake-id/${path.replace(/^\//, "")}`,
      openOptionsPage: () => {
        calls.optionsOpened++;
      }
    },
    contextMenus: {
      onClicked: fakeEvent(),
      create: (def) => {
        calls.contextMenusCreated.push(def);
      }
    },
    windows: {
      create: (def) => {
        calls.windowsCreated.push(def);
        return Promise.resolve({ id: calls.windowsCreated.length });
      }
    },
    tabs: {
      query: async () => [{ id: 1, url: "https://example.atlassian.net/browse/AB-1" }],
      sendMessage: async (_id, message) => {
        calls.messages.push(message);
        return { selection: "" };
      }
    },
    permissions: {
      contains: async () => true,
      request: async () => true
    }
  };
}

/**
 * Install a fake namespace on `globalThis.chrome` (and `browser`) for the
 * duration of a test. Returns the fake plus a restore function.
 */
export function installFakeBrowser(initial = {}) {
  const previousChrome = globalThis.chrome;
  const previousBrowser = globalThis.browser;
  const api = createFakeBrowser(initial);
  globalThis.chrome = api;
  globalThis.browser = api;
  return {
    api,
    restore() {
      globalThis.chrome = previousChrome;
      globalThis.browser = previousBrowser;
    }
  };
}
