/**
 * Storage service — thin wrapper over chrome.storage for the extension.
 */

import { KEYS, OAUTH_CLIENT_ID } from "../config/config.js";

class StorageService {
  constructor() {
    this.local = chrome.storage.local;
    this.sync = chrome.storage.sync;
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
