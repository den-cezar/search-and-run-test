# Search & Run Test — Browser Extension

[![CI](https://github.com/den-cezar/search-and-run-test/actions/workflows/test.yml/badge.svg)](https://github.com/den-cezar/search-and-run-test/actions/workflows/test.yml)
[![Release](https://github.com/den-cezar/search-and-run-test/actions/workflows/release-please.yml/badge.svg)](https://github.com/den-cezar/search-and-run-test/actions/workflows/release-please.yml)
[![Latest release](https://img.shields.io/github/v/release/den-cezar/search-and-run-test?sort=semver)](https://github.com/den-cezar/search-and-run-test/releases/latest)
[![Tests](https://img.shields.io/badge/tests-46%20passing-brightgreen)](#tests)
[![Core coverage](https://img.shields.io/badge/core%20coverage-~99%25-brightgreen)](#test-coverage)
[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/mphnpjnmjdmoabgcabfgpbmieamgihof?logo=googlechrome&logoColor=white&label=Chrome%20Web%20Store)](https://chromewebstore.google.com/detail/search-run-test/mphnpjnmjdmoabgcabfgpbmieamgihof)
[![Edge Add-ons](https://img.shields.io/badge/Edge%20Add--ons-in%20review-0078d7?logo=microsoftedge&logoColor=white)](#3-install-the-extension)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-5a5a5a)](manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Select a test name on a Jira/Confluence page, find it across configured GitHub
repos, and dispatch the matching GitHub Actions workflow — without leaving the
browser. Manifest V3, works in Chrome and Edge.

**[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/search-run-test/mphnpjnmjdmoabgcabfgpbmieamgihof)**

## How it works

1. **Select** a test function name on a page (e.g. `test_login_with_valid_credentials[chrome]`).
2. **Right-click → "Search & Run Test"** (or click the toolbar icon and type a name).
3. The extension code-searches every configured repo **in parallel** for the test
   definition, strips the repo's `pathBase` from the hit to build the pytest node
   ID (`relative/path.py::test_name[param]`), and shows repo-grouped results.
4. **Pick** a result, fill in the workflow inputs you configured for that repo,
   and **Run**. GitHub responds with a direct link to the workflow run.

## Authentication

Uses **GitHub OAuth Device Flow** — no PAT to paste, no client secret stored.

## Setup

### 1. Register a GitHub OAuth App (one-time)

The extension needs an OAuth App **client ID**. The client ID is **not a secret** —
Device Flow uses no client secret, so it is safe to ship in the extension.

1. Go to **https://github.com/settings/developers** → **OAuth Apps** → **New OAuth App**.
2. Fill in (values are not important for device flow):
   - **Application name**: e.g. `Search & Run Test`
   - **Homepage URL**: e.g. `https://github.com/<your-username>`
   - **Authorization callback URL**: e.g. `https://github.com/<your-username>`
     (device flow ignores it, but the field is required)
3. Click **Register application**.
4. On the app page, tick **Enable Device Flow** and **Update application**.
   > ⚠️ If Device Flow is **not** enabled, the connect step fails with
   > `404 {"error":"Not Found"}`.
5. Copy the **Client ID** (looks like `Iv1.xxxxxxxxxxxx` or `Ov23li...`).

The scopes requested at connect time are `repo` and `workflow`.

### 2. Provide the client ID

Either option works (the Options page value overrides the config default):

- **Options page** (recommended): paste it into **OAuth App client ID**, or
- **In code**: set `OAUTH_CLIENT_ID` in [`config/config.js`](config/config.js).

### 3. Install the extension

**Chrome — from the store (recommended)**

Install from the
[Chrome Web Store](https://chromewebstore.google.com/detail/search-run-test/mphnpjnmjdmoabgcabfgpbmieamgihof).
Updates arrive automatically.

**Microsoft Edge**

Under review at the Microsoft Edge Add-ons store. Until it is published, use the
unpacked install below — Edge loads Manifest V3 extensions the same way Chrome does.

**Unpacked — from a release**

1. Open the [latest release](https://github.com/den-cezar/search-and-run-test/releases/latest)
   and download `search-and-run-test-vX.Y.Z.zip`.
2. Unzip it somewhere permanent (the browser loads the extension from this folder).
3. Continue with the steps below, selecting the unzipped folder.

**Unpacked — from source (for development)**

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Open the extension **Options**, set the client ID, click **Connect GitHub**, and
   complete the device-code activation (enter the shown code on the GitHub page).
5. Add your **Repositories**, then **Check connection**.

### 4. Authorize for private org repos

- Personal repos work immediately after connecting.
- For private **organization** repos, the OAuth App must be **SSO-authorized** for the
  org. On the GitHub authorization screen, choose **Authorize** for your organization
  (an org admin may need to approve the app first).

## Configuration (Options page)

The extension ships with **no project-specific fields**. Each repository defines
its own list of `workflow_dispatch` inputs, so different workflows can expose
completely different parameters.

- **Repositories** (add/edit/remove). Each row:
  - `name` — label shown in the popup
  - `owner` / `repo` — the GitHub `owner/repo`
  - `workflow` — the `.yml`/`.yaml` file under `.github/workflows/`
  - `branch` — git ref the workflow is dispatched on
  - `pathBase` — folder prefix stripped from a search hit to build the node ID
  - `inputs` — the list of `workflow_dispatch` inputs the workflow accepts.
    Each input definition has:
    - `key` — the exact `workflow_dispatch` input name
    - `label` — what the popup shows (defaults to `key`)
    - `type` — `select` | `text` | `number` | `checkbox`
    - `options` — choices for `select` (comma/newline separated)
    - `default` — the prefilled value
    - `isTestPath` — mark **one** input as the test-path target; it is auto-filled
      with the selected test's node ID (`relative/path.py::test_name[param]`) and
      shown read-only in the popup

  Example `inputs` for a repo (JSON, as Export/Import stores it):

  ```json
  [
    { "key": "Test_Environment", "label": "Environment", "type": "select", "options": ["DEV", "QA", "STAGE"], "default": "QA" },
    { "key": "Test_Path", "label": "Test", "type": "text", "isTestPath": true },
    { "key": "Threads_Count", "label": "Threads", "type": "number", "default": "1" },
    { "key": "Uploading_to_Xray", "label": "Upload to Xray", "type": "checkbox", "default": false }
  ]
  ```

  > **Select tip:** list only the values the workflow's input accepts. An unknown
  > value makes GitHub reject the dispatch with `422`. The Options page has a
  > collapsible **"How to set up a repository"** guide.

  > A repo with **no inputs configured** can still be saved, but the popup shows a
  > "setup not done" notice and disables **Run** until you add at least one input.

- A fresh install starts with **no repositories** — add them manually, or use
  **Export** / **Import** to move a config between machines (JSON).
- **Advanced → Log level**: `debug` / `info` / `warn` / `error` / `silent`. Controls
  the verbosity of the extension's console logging (stored in `chrome.storage.sync`).

## Input validation

Inputs are validated before any network call (see [`lib/validation.js`](lib/validation.js)
and [`lib/inputs.js`](lib/inputs.js)):

- **Test name** must look like a pytest function (`test_example` or `test_example[param]`).
- **Branch** must be a valid git ref (no spaces, `..`, trailing `/`, or illegal chars).
- **Workflow input keys** must be valid identifiers, unique within a repo, with at
  most one marked as the test-path target; `select` inputs need at least one option.
- **Repository rows** require `owner`, `repo`, and a `.yml`/`.yaml` workflow file.

Invalid fields show an inline error and block the action.

## Error handling

The GitHub client ([`api/github-client.js`](api/github-client.js)) centralizes all
requests through a retry-aware helper that maps failures to friendly messages:

- **401 / invalid token** → prompts to reconnect.
- **SSO required** (`x-github-sso` header) → prompts to authorize the org.
- **Rate limit** (403 + `x-ratelimit-remaining: 0`) → reports the reset time.
- **404** → repo/workflow not found.
- **422** on dispatch → likely a missing branch or invalid workflow inputs
  (e.g. a `select` value the workflow doesn't accept).
- **Network / 5xx / secondary rate limit** → retried with exponential backoff.

During search, a single repo returning "not found" is tolerated; only fatal errors
(auth, SSO, rate limit, network) stop the whole search.

## Workflow inputs sent on dispatch

The `inputs` object sent to GitHub is built from the repo's configured input
definitions and the values entered in the popup. The input marked `isTestPath`
is filled with the computed pytest node ID; checkbox values become `"true"`/
`"false"` strings and numbers are sent as integer strings (see
[`lib/inputs.js`](lib/inputs.js)).

Dispatched with `return_run_details: true` so the response includes the run URL.

## File layout

```
manifest.json          MV3 manifest
background.js          service worker: context menu + selection hand-off
content.js            captures the page text selection
config/config.js       client ID, OAuth/GitHub endpoints, new-repo template, storage keys
api/storage-service.js chrome.storage wrapper
api/github-client.js   device flow, code search, workflow dispatch, error mapping
lib/parsing.js         pure parsing helpers (test name, node ID) — unit-tested
lib/validation.js      pure input validators — unit-tested
lib/inputs.js          pure helpers for user-defined workflow inputs — unit-tested
lib/logger.js          leveled console logger
ui/popup.{html,js}     search → results → params → run
ui/options.{html,js}   connect GitHub, manage repos & log level
ui/styles.css          shared styles (light + dark mode)
tests/                 node:test unit tests for lib/
icons/                 toolbar icons (placeholder)
```

## Tests

The pure logic in `lib/` is covered by unit tests using Node's built-in test
runner (no extra dependencies):

```bash
npm install   # one-time: installs ESLint dev dependencies
npm test      # node --test
npm run lint  # eslint .
```

**46 tests** currently pass across `lib/parsing.js`, `lib/validation.js`, and
`lib/inputs.js`.

### Test coverage

Coverage is measured on the pure, browser-independent core in `lib/`:

```bash
npm run coverage
# = node --test --experimental-test-coverage
```

| File              | Line % | Branch % | Func % |
|-------------------|:------:|:--------:|:------:|
| `lib/inputs.js`     | 98.5   | 88.3     | 100    |
| `lib/parsing.js`    | 100    | 93.3     | 100    |
| `lib/validation.js` | 100    | 97.3     | 100    |
| **lib (all)**       | **99.2** | **92.0** | **100** |

> **Scope:** the UI (`ui/`), GitHub client (`api/github-client.js`), storage
> wrapper, and the background/content scripts rely on browser/Chrome APIs and are
> validated manually by loading the unpacked extension — they are intentionally
> outside the unit-test coverage above.

## Continuous integration

Every push and pull request to `main` runs the [CI workflow](.github/workflows/test.yml):

1. **Lint** — `npm run lint` (ESLint).
2. **Test** — `npm test` and `npm run coverage`. This job **depends on Lint**, so
   tests only run once linting passes.

Pull-request titles are checked by the
[PR Lint workflow](.github/workflows/pr-lint.yml) and must follow
[Conventional Commits](https://www.conventionalcommits.org/) (e.g.
`feat: add dark mode`, `fix: handle 422 on dispatch`). The title becomes the
squash-merge commit subject that drives versioning.

## Dependencies

[Dependabot](.github/dependabot.yml) opens weekly pull requests to update:

- **npm** dev dependencies (ESLint and friends) — minor/patch bumps are grouped
  into a single PR.
- **GitHub Actions** used by the workflows.

These PRs go through the same CI (lint + test) before they can be merged.

## Releases & versioning

Releases are automated with
[Release Please](https://github.com/googleapis/release-please-action) via the
[Release workflow](.github/workflows/release-please.yml):

1. Merge Conventional-Commit PRs into `main`.
2. Release Please opens (and keeps updating) a **release PR** that bumps the version
   in `package.json` **and** `manifest.json`, and updates `CHANGELOG.md`.
   - `fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE` → major.
3. Merging that release PR tags the version, publishes a **GitHub Release**, and
   attaches `search-and-run-test-vX.Y.Z.zip` — the packaged extension end users
   download and load unpacked.

## Contributing

Issues and pull requests are welcome. Before opening a PR:

- Run `npm run lint` and `npm test`, and keep the pure logic in `lib/` covered by tests.
- Use a [Conventional Commit](https://www.conventionalcommits.org/) PR title so the
  release automation can pick up your change.

## License

[MIT](LICENSE) — free to use, modify, and distribute. Copyright © 2026 Denys Zatkhei.

## Notes / limitations

- Replace the placeholder icons in `icons/` before wider distribution.
- Whole-file runs, auto-detected path base, and PAT fallback remain on the backlog
  (see the plan doc).
