/**
 * Configuration & defaults for the Search & Run Test extension.
 *
 * NOTE: The GitHub OAuth client_id is NOT a secret. Device Flow does not use a
 * client secret, so it is safe to ship the client_id in the extension.
 * Register an OAuth App with "Device flow" enabled and put its client_id here
 * (it can also be overridden from the Options page).
 */

/** Empty by design: each user registers their own OAuth App and sets it in Options. */
export const OAUTH_CLIENT_ID = "";

export const OAUTH_SCOPES = "repo workflow";

export const GITHUB = {
  apiBase: "https://api.github.com",
  deviceCodeUrl: "https://github.com/login/device/code",
  tokenUrl: "https://github.com/login/oauth/access_token",
  apiVersion: "2022-11-28"
};

export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";

/**
 * Template used when adding a new repository on the Options page. All
 * identifying fields are blank so no organization/customer data ships with the
 * extension — users fill these in for their own repos.
 * - name:      display name
 * - owner/repo: GitHub owner/repo
 * - workflow:  workflow file that accepts the dispatch inputs
 * - pathBase:  prefix to strip from a code-search hit to build the pytest file path
 * - branch:    git ref the workflow is dispatched on
 * - inputs:    user-defined list of workflow_dispatch inputs (see lib/inputs.js).
 *              Starts empty — each repo defines the inputs its own workflow expects.
 */
export const NEW_REPO_TEMPLATE = {
  name: "",
  owner: "",
  repo: "",
  workflow: "",
  pathBase: "",
  branch: "main",
  inputs: []
};

/** Storage keys used across the extension. */
export const KEYS = {
  token: "gh_access_token",
  clientId: "oauth_client_id",
  repos: "repos_config",
  pendingSelection: "pending_selection"
};
