/**
 * Storage service — thin wrapper over the extension storage API.
 */

import { KEYS, OAUTH_CLIENT_ID } from "../config/config.js";
import { getBrowserApi } from "../lib/browser-api.js";

export class StorageService {
  /** @param {object} [api] WebExtension namespace; resolved lazily when omitted. */
  constructor(api) {
    this._api = api || null;
  }

  get _storage() {
    const api = this._api || getBrowserApi();
    if (!api || !api.storage) {
      throw new Error("Extension storage API is unavailable.");
    }
    return api.storage;
  }

  get local() {
    return this._storage.local;
  }

  get sync() {
    return this._storage.sync;
  }

  // --- GitHub access token (local only) ---
  async getToken() {
    const r = await this.local.get(KEYS.token);
    return r[KEYS.token] || null;
  }

  async setToken(token) {
    await this.local.set({ [KEYS.token]: token });
  }

  async clearToken() {
    await this.local.remove(KEYS.token);
  }

  // --- OAuth client id (sync, falls back to config default) ---
  async getClientId() {
    const r = await this.sync.get(KEYS.clientId);
    return r[KEYS.clientId] || OAUTH_CLIENT_ID;
  }

  async setClientId(clientId) {
    await this.sync.set({ [KEYS.clientId]: clientId });
  }

  // --- Repositories config (sync) ---
  async getRepos() {
    const r = await this.sync.get(KEYS.repos);
    return r[KEYS.repos] || [];
  }

  async setRepos(repos) {
    await this.sync.set({ [KEYS.repos]: repos });
  }

  // --- Pending selection handed off from context menu (local) ---
  async setPendingSelection(text) {
    await this.local.set({ [KEYS.pendingSelection]: { text, ts: Date.now() } });
  }

  async takePendingSelection() {
    const r = await this.local.get(KEYS.pendingSelection);
    const item = r[KEYS.pendingSelection];
    if (item) {
      await this.local.remove(KEYS.pendingSelection);
    }
    return item ? item.text : null;
  }
}

export const storage = new StorageService();
