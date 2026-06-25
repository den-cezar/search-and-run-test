/**
 * GitHub client — OAuth Device Flow auth, code search, and workflow dispatch.
 * No client secret is used or stored (Device Flow is client-side safe).
 */

import { GITHUB, OAUTH_SCOPES, DEVICE_GRANT_TYPE } from "../config/config.js";
import { storage } from "./storage-service.js";
import { createLogger } from "../lib/logger.js";
import {
  parseTestName,
  extractTestFunctions,
  buildRelativePath,
  buildNodeId
} from "../lib/parsing.js";

const log = createLogger("github");

/** Error carrying extra context about a failed GitHub request. */
class GitHubError extends Error {
  constructor(message, { status, kind } = {}) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.kind = kind; // "auth" | "sso" | "rate-limit" | "not-found" | "http" | "network"
  }
}

class GitHubClient {
  /** Headers for authenticated REST calls. */
  async _authHeaders() {
    const token = await storage.getToken();
    if (!token) {
      throw new GitHubError("Not connected to GitHub. Open Options and connect first.", {
        kind: "auth"
      });
    }
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": GITHUB.apiVersion
    };
  }

  /**
   * Authenticated fetch with retry + friendly error mapping.
   * Returns the Response on success (any 2xx). Throws GitHubError otherwise.
   */
  async _request(url, options = {}, { retries = 2 } = {}) {
    const headers = { ...(await this._authHeaders()), ...(options.headers || {}) };
    let attempt = 0;

    while (true) {
      let res;
      try {
        res = await fetch(url, { ...options, headers });
      } catch (networkErr) {
        if (attempt < retries) {
          await this._sleep(this._backoff(attempt));
          attempt++;
          continue;
        }
        throw new GitHubError(
          "Network error reaching GitHub. Check your connection and try again.",
          { kind: "network" }
        );
      }

      if (res.ok) return res;

      // Secondary rate limit / transient server errors → retry with backoff.
      const retryAfter = parseInt(res.headers.get("retry-after") || "", 10);
      const isTransient = res.status >= 500 || res.status === 429;
      if ((isTransient || retryAfter) && attempt < retries) {
        await this._sleep(retryAfter ? retryAfter * 1000 : this._backoff(attempt));
        attempt++;
        continue;
      }

      throw await this._explainError(res);
    }
  }

  /** Turn a failed Response into a user-friendly GitHubError. */
  async _explainError(res) {
    const ssoHeader = res.headers.get("x-github-sso");
    const remaining = res.headers.get("x-ratelimit-remaining");

    if (res.status === 401) {
      return new GitHubError("GitHub token is invalid or expired. Reconnect in Options.", {
        status: 401,
        kind: "auth"
      });
    }
    if (ssoHeader) {
      return new GitHubError(
        "SSO authorization required. Open the GitHub authorization prompt and authorize this app for the organization.",
        { status: res.status, kind: "sso" }
      );
    }
    if (res.status === 403 && remaining === "0") {
      const reset = parseInt(res.headers.get("x-ratelimit-reset") || "", 10);
      const when = reset ? new Date(reset * 1000).toLocaleTimeString() : "later";
      return new GitHubError(`GitHub API rate limit exceeded. Try again after ${when}.`, {
        status: 403,
        kind: "rate-limit"
      });
    }
    if (res.status === 403) {
      return new GitHubError(
        "Access forbidden (403). The token may lack the required scopes or org access.",
        { status: 403, kind: "auth" }
      );
    }
    if (res.status === 404) {
      return new GitHubError("Not found (404).", { status: 404, kind: "not-found" });
    }

    let detail = "";
    try {
      const data = await res.json();
      detail = data.message || "";
    } catch (_) {
      detail = await res.text().catch(() => "");
    }
    return new GitHubError(
      `GitHub request failed (${res.status})${detail ? `: ${detail}` : ""}`,
      { status: res.status, kind: "http" }
    );
  }

  _backoff(attempt) {
    return Math.min(1000 * 2 ** attempt, 8000);
  }

  // ---------------------------------------------------------------------------
  // OAuth Device Flow
  // ---------------------------------------------------------------------------

  /**
   * Step 1: request a device + user code.
   * @returns {Promise<{device_code, user_code, verification_uri, expires_in, interval}>}
   */
  async startDeviceFlow() {
    const clientId = await storage.getClientId();
    if (!clientId || clientId.startsWith("REPLACE_WITH")) {
      throw new GitHubError(
        "No OAuth client ID configured. Set it on the Options page first.",
        { kind: "auth" }
      );
    }
    let res;
    try {
      res = await fetch(GITHUB.deviceCodeUrl, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, scope: OAUTH_SCOPES })
      });
    } catch (_) {
      throw new GitHubError("Network error reaching GitHub.", { kind: "network" });
    }
    if (res.status === 404) {
      throw new GitHubError(
        "Device flow rejected the client ID (404). Verify the OAuth App client ID and that Device Flow is enabled.",
        { status: 404, kind: "auth" }
      );
    }
    if (!res.ok) {
      throw new GitHubError(`Failed to start device flow (${res.status}).`, {
        status: res.status,
        kind: "http"
      });
    }
    const data = await res.json();
    if (data.error) {
      throw new GitHubError(data.error_description || data.error, { kind: "auth" });
    }
    return data;
  }

  /**
   * Step 2: poll until the user authorizes (or it expires).
   * @param {string} deviceCode
   * @param {number} intervalSeconds
   * @param {number} expiresIn
   * @param {(status: string) => void} [onStatus]
   * @returns {Promise<string>} access token
   */
  async pollForToken(deviceCode, intervalSeconds, expiresIn, onStatus) {
    const clientId = await storage.getClientId();
    let interval = Math.max(intervalSeconds || 5, 1);
    const deadline = Date.now() + (expiresIn || 900) * 1000;

    while (Date.now() < deadline) {
      await this._sleep(interval * 1000);

      let data;
      try {
        const res = await fetch(GITHUB.tokenUrl, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: clientId,
            device_code: deviceCode,
            grant_type: DEVICE_GRANT_TYPE
          })
        });
        data = await res.json();
      } catch (_) {
        onStatus && onStatus("Network hiccup, retrying…");
        continue;
      }

      if (data.access_token) {
        await storage.setToken(data.access_token);
        return data.access_token;
      }

      switch (data.error) {
        case "authorization_pending":
          onStatus && onStatus("Waiting for authorization…");
          break;
        case "slow_down":
          interval += 5;
          onStatus && onStatus("Slowing down…");
          break;
        case "expired_token":
          throw new GitHubError("Device code expired. Please try again.", { kind: "auth" });
        case "access_denied":
          throw new GitHubError("Authorization was denied.", { kind: "auth" });
        default:
          if (data.error) {
            throw new GitHubError(data.error_description || data.error, { kind: "auth" });
          }
      }
    }
    throw new GitHubError("Timed out waiting for GitHub authorization.", { kind: "auth" });
  }

  /** Validate the stored token and return the user login. */
  async getUser() {
    const res = await this._request(`${GITHUB.apiBase}/user`, {}, { retries: 1 });
    return res.json();
  }

  /** Check that a repo and its workflow are reachable. */
  async checkRepo(repoCfg) {
    try {
      await this._request(
        `${GITHUB.apiBase}/repos/${repoCfg.owner}/${repoCfg.repo}`,
        {},
        { retries: 1 }
      );
    } catch (e) {
      return { ok: false, message: e.message };
    }
    try {
      await this._request(
        `${GITHUB.apiBase}/repos/${repoCfg.owner}/${repoCfg.repo}/actions/workflows/${repoCfg.workflow}`,
        {},
        { retries: 1 }
      );
    } catch (e) {
      return { ok: false, message: `workflow: ${e.message}` };
    }
    return { ok: true, message: "ok" };
  }

  // ---------------------------------------------------------------------------
  // Test search
  // ---------------------------------------------------------------------------


  /**
   * Split a selected test name into its parts.
   * e.g. "test_x[AP]" -> { searchTerm: "test_x", paramSuffix: "[AP]", fullName: "test_x[AP]" }
   */
  static parseTestName(raw) {
    return parseTestName(raw);
  }

  /**
   * Search all configured repos in parallel for the test definition.
   * @returns {Promise<Array>} repo-grouped hits with computed Test_Path node IDs.
   */
  async searchTest(rawName) {
    const { searchTerm, paramSuffix } = parseTestName(rawName);
    if (!searchTerm) {
      throw new GitHubError("No test name to search.", { kind: "input" });
    }
    const repos = await storage.getRepos();
    if (!repos.length) {
      throw new GitHubError("No repositories configured. Add one in Options.", { kind: "input" });
    }

    const perRepo = await Promise.allSettled(
      repos.map((cfg) => this._searchInRepo(cfg, searchTerm, paramSuffix))
    );

    // Surface auth / rate-limit failures; tolerate per-repo "not found".
    const fatal = perRepo.find(
      (r) =>
        r.status === "rejected" &&
        ["auth", "sso", "rate-limit", "network"].includes(r.reason?.kind)
    );
    if (fatal) {
      throw fatal.reason;
    }

    const results = perRepo
      .filter((r) => r.status === "fulfilled")
      .flatMap((r) => r.value);
    return { searchTerm, results };
  }

  async _searchInRepo(cfg, searchTerm, paramSuffix) {
    const pathBase = (cfg.pathBase || "").replace(/\/+$/, "");
    const qualifiers = [searchTerm, "in:file", "language:python", `repo:${cfg.owner}/${cfg.repo}`];
    if (pathBase) {
      qualifiers.push(`path:${pathBase}`);
    }
    const q = qualifiers.join(" ");

    let data;
    try {
      const res = await this._request(
        `${GITHUB.apiBase}/search/code?q=${encodeURIComponent(q)}`,
        {},
        { retries: 2 }
      );
      data = await res.json();
    } catch (e) {
      // Let fatal errors (auth/rate-limit/network) bubble up; treat the rest
      // as "no results for this repo".
      if (["auth", "sso", "rate-limit", "network"].includes(e.kind)) {
        throw e;
      }
      log.warn(`search failed for ${cfg.owner}/${cfg.repo}`, e.message);
      return [];
    }

    const items = data.items || [];
    const perFile = await Promise.all(
      items.map((item) => this._buildHitsForFile(cfg, item, searchTerm, paramSuffix))
    );
    return perFile.flat();
  }

  /** Read one file and build a hit per matching test function. */
  async _buildHitsForFile(cfg, item, searchTerm, paramSuffix) {
    const filePath = item.path;
    const relative = buildRelativePath(filePath, cfg.pathBase || "");

    const funcNames = await this._fetchTestFunctions(cfg, filePath, searchTerm);

    // Fall back to the bare search term if we could not read the file.
    const names = funcNames.length ? funcNames : [searchTerm];

    return names.map((name) => {
      // Keep the [param] suffix only when the selected name matched exactly.
      const suffix = name === searchTerm && paramSuffix ? paramSuffix : "";
      return {
        repoName: cfg.name,
        owner: cfg.owner,
        repo: cfg.repo,
        workflow: cfg.workflow,
        branch: cfg.branch || "main",
        inputs: Array.isArray(cfg.inputs) ? cfg.inputs : [],
        filePath,
        funcName: `${name}${suffix}`,
        testPath: buildNodeId(relative, name, suffix),
        htmlUrl: item.html_url
      };
    });
  }

  /**
   * Fetch a file's raw content and return the `def test_*` names that contain
   * the search term (sorted, de-duplicated).
   */
  async _fetchTestFunctions(cfg, filePath, searchTerm) {
    try {
      const url =
        `${GITHUB.apiBase}/repos/${cfg.owner}/${cfg.repo}/contents/` +
        `${filePath.split("/").map(encodeURIComponent).join("/")}` +
        `?ref=${encodeURIComponent(cfg.branch || "main")}`;
      const res = await this._request(
        url,
        { headers: { Accept: "application/vnd.github.raw+json" } },
        { retries: 1 }
      );
      const text = await res.text();
      return extractTestFunctions(text, searchTerm);
    } catch (e) {
      log.warn(`failed to read ${filePath}`, e.message);
      return [];
    }
  }


  // ---------------------------------------------------------------------------
  // Workflow dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch the workflow for a selected hit.
   * @param {object} hit    the selected search result (carries owner/repo/workflow/branch)
   * @param {object} params { ref, inputs } — git ref and the already-built inputs object
   * Uses return_run_details so GitHub responds 200 with the run URL.
   * @returns {Promise<{html_url: string|null}>}
   */
  async dispatchWorkflow(hit, params) {
    const url =
      `${GITHUB.apiBase}/repos/${hit.owner}/${hit.repo}` +
      `/actions/workflows/${hit.workflow}/dispatches`;

    const ref = params.ref || hit.branch || "main";
    const body = {
      ref,
      inputs: params.inputs || {},
      return_run_details: true
    };

    let res;
    try {
      res = await this._request(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        },
        { retries: 1 }
      );
    } catch (e) {
      // 422 usually means the branch/ref or inputs are wrong.
      if (e.status === 422) {
        throw new GitHubError(
          `Dispatch rejected (422). Check that branch “${ref}” exists and the workflow accepts these input names and values.`,
          { status: 422, kind: "input" }
        );
      }
      throw e;
    }

    // 200 (with run details) or 204 (no details) both mean success.
    if (res.status === 200) {
      const data = await res.json().catch(() => ({}));
      return { html_url: data.html_url || data.run_url || null };
    }
    return { html_url: null };
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const githubClient = new GitHubClient();
export { GitHubClient, GitHubError };
