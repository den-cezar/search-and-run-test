# Manual test plan

Release checklist for the cases automation cannot reach: real store builds, real
GitHub OAuth, real workflow runs, browser permission prompts and the toolbar
popup.

## Do not re-test manually

These are covered by `npm test` (unit) and `npm run e2e` (Chromium). Re-running
them by hand adds no signal:

| Area | Covered by |
| --- | --- |
| Test-name parsing, node ID building, param suffixes | `tests/parsing.test.js` |
| Input definitions, defaults, coercion, dispatch payload building | `tests/inputs.test.js` |
| Input type × test-path × value-source combinations, coercion tables | `tests/inputs-combinations.test.js` |
| Field validation (test name, branch, threads, repo config) | `tests/validation.test.js` |
| Token/repo/selection storage round-trips | `tests/storage-service.test.js` |
| GitHub error mapping (401 / 403 / SSO / rate limit / 404 / 422), retries | `tests/github-client.test.js` |
| OAuth device flow, polling, `checkRepo` | `tests/github-device-flow.test.js` |
| Code search, hit building, multi-repo aggregation, fatal vs tolerated failures | `tests/github-search.test.js` |
| Context-menu handler: stores selection, opens runner window | `tests/background.test.js` |
| Log level filtering and persistence | `tests/logger.test.js` |
| HTML escaping of repo and GitHub-supplied values | `tests/html.test.js` |
| Host permission detection and request logic | `tests/host-access.test.js` |
| Manifest shape, version parity, packaged-file list | `tests/manifest.test.js` |
| Popup: disconnected state, search → select → configure → dispatch, error surfacing | `e2e/popup.spec.js` |
| Options: save/remove repos, validation, log level, disconnect | `e2e/options.spec.js` |
| Repo config import, export and round-trip, including hostile values | `e2e/options.spec.js` |
| Log level applied at runtime in the popup and Options pages | `e2e/logging.spec.js` |
| Content script: selection capture, host scoping | `e2e/content-script.spec.js` |

## Coverage policy

`npm run coverage` fails the build below 90% lines, 85% branches and 80%
functions across product code; the floor for any individual module is 75% on all
three. Test helpers are excluded from the report. `ui/popup.js`, `ui/options.js`
and `content.js` are deliberately not unit-covered — they are DOM controllers
verified by the Playwright suite, which runs against Chromium and Edge and fails
on any uncaught page error.

## Preconditions

- A GitHub OAuth App with **Device flow** enabled; its client ID at hand.
- A test repository with a `workflow_dispatch` workflow that accepts at least:
  a test-path input, one `choice` input, one `number` input.
- A pytest file in that repo containing two functions whose names share a prefix
  (for example `test_login` and `test_login_invalid`), one of them parametrized.
- A Jira or Confluence page containing the test name as selectable text.
- A second browser profile or machine to verify settings sync.

Record the build under test: `version`, `commit`, `browser + version`, `date`.

## Scenarios

### A. Install and first run

| ID | Steps | Expected |
| --- | --- | --- |
| A1 | Install the packaged zip as an unpacked/dev extension in a clean profile | Options page opens automatically once; no console errors |
| A2 | Inspect the service worker console | No errors; `[S&R:*]` logs only at info or above by default |
| A3 | Open the toolbar popup before configuring anything | "Not connected to GitHub" card with a working **Open Options** button |
| A4 | Right-click a selection before configuring anything | Context menu entry reads `Search and Run Test: "<selection>"` |

### B. GitHub connection (device flow)

| ID | Steps | Expected |
| --- | --- | --- |
| B1 | Enter the OAuth client ID, click **Connect GitHub** | A user code and an activation link appear |
| B2 | Authorize on GitHub, return to Options | Status becomes `Connected as @<login>` without a manual refresh |
| B3 | Click **Check connection** | Same connected status, no error message |
| B4 | Click **Connect** with an invalid client ID | Clear error naming the client ID / device flow, not a raw 404 |
| B5 | Start the flow and let the code expire without authorizing | "Device code expired" message, UI returns to an idle state |
| B6 | Click **Disconnect**, reopen the popup | Options shows "Not connected"; popup shows the disconnected card |
| B7 | Reconnect, then revoke the token from GitHub settings and reopen the popup | Popup falls back to Disconnected instead of hanging |

### C. Repository configuration

| ID | Steps | Expected |
| --- | --- | --- |
| C1 | Add a repo, fill every field, define the workflow inputs, mark one as **Test path**, save | Success message; button disables again |
| C2 | Reload Options | All values, including input definitions, are restored |
| C3 | Mark two inputs as **Test path** and save | Rejected with an explanatory message; nothing is written |
| C4 | Define a `select` input with no options and save | Rejected with an explanatory message |
| C5 | **Export**, then edit the JSON, then **Import** | Imported rows appear unsaved; saving persists them |
| C6 | Import a config exported from an older extension version | Rows render and save without breaking the page |
| C7 | Sign into the same browser profile on a second device | The repo config arrives via sync storage; the GitHub token does **not** |

### D. Selection capture

| ID | Steps | Expected |
| --- | --- | --- |
| D1 | Select a test name on a Jira issue, right-click → **Search & Run Test** | A standalone popup window opens with the name pre-filled and the search already running |
| D2 | Same on a Confluence page | As D1 |
| D3 | Select a name, then open the popup from the toolbar instead | The name is pre-filled from the live selection |
| D4 | Open the toolbar popup on a non-Atlassian page with text selected | Popup opens empty, no error |
| D5 | Select a parametrized name `test_x[QA-chrome]` and use the context menu | Search runs on `test_x`; the result keeps the `[QA-chrome]` suffix in the node ID |
| D6 | Trigger the context menu twice in a row | The second window searches the second selection, not a stale one |

### E. Search and dispatch against real GitHub

| ID | Steps | Expected |
| --- | --- | --- |
| E1 | Search a name that exists in one repo | One group per repo; every matching `def test_*` in the file is listed |
| E2 | Search a prefix shared by two functions | Both functions listed as separate, selectable results |
| E3 | Search a name that does not exist | "No test matching …" message, no results list |
| E4 | Search with more than five results | The filter box appears and narrows the list |
| E5 | Select a result and check the read-only test path | Matches the real pytest node ID (`relative/path.py::test_name`) with `pathBase` stripped |
| E6 | Run it, then open the returned link | The GitHub Actions run exists and was started with the values shown in the form |
| E7 | Change the branch to a non-existent ref and run | 422 explained in terms of the branch/inputs, not a raw API error |
| E8 | Run against a repo whose inputs are not configured | Setup notice shown and **Run Test** disabled |
| E9 | Run against an org repo behind SAML SSO without authorizing the token | SSO message telling the user to authorize the app for the org |
| E10 | Exhaust the search rate limit (repeat searches rapidly) | Rate-limit message including the reset time; the popup stays usable |
| E11 | Disconnect the network mid-search | Network error message; retrying after reconnect succeeds |

### F. Runner window behaviour

| ID | Steps | Expected |
| --- | --- | --- |
| F1 | In a context-menu window, dispatch and click **Open workflow run** | The run opens in a new tab and the runner window closes |
| F2 | In the toolbar popup, dispatch and click **Open workflow run** | The run opens in a new tab; no window-closing side effect |
| F3 | Click **Run another test** after a run | Returns to step 1 with a cleared form |
| F4 | Click **← Back** from the parameters step | Returns to the same result list, selection preserved |

### G. Store builds

| ID | Steps | Expected |
| --- | --- | --- |
| G1 | Install the Chrome Web Store build in a clean profile and run D1 → E6 | Identical behaviour to the unpacked build |
| G2 | Install the Edge Add-ons build in a clean profile and run D1 → E6 | Identical behaviour |
| G3 | Install the addons.mozilla.org build in a clean profile and run H2 → H5 | Identical behaviour |
| G4 | Upgrade from the previous published version over an existing profile | Repos, client ID and token survive; no duplicate context-menu entry |
| G5 | Review the permission prompt shown at install | Only storage, context menus, activeTab and the declared hosts |

### H. Firefox

The grant flow cannot be automated: Chromium refuses to remove declared host
permissions, so the prompt is unreachable in the Playwright suite. The logic
behind it is unit-covered in `tests/host-access.test.js`; these steps verify the
wiring in a real Firefox.

| ID | Steps | Expected |
| --- | --- | --- |
| H1 | Load the release zip via `about:debugging` → Load Temporary Add-on | Options opens; no errors in the extension console |
| H2 | Open the popup before granting site access | "Grant access" card shown; search hidden; the step bar is hidden |
| H3 | Click **Grant access** and accept the Firefox prompt | Card disappears, connection state is checked, search becomes usable |
| H4 | Click **Grant access** and dismiss the prompt | An error message appears; the card stays; no unhandled rejection |
| H5 | Grant access, then run D1 → E6 | Identical behaviour to Chrome |
| H6 | Revoke site access from `about:addons`, reopen the popup | The grant card returns |
| H7 | Restart the browser and reopen the popup | The event page restarts cleanly; the context menu still works |
| H8 | Right-click a selection on Jira → **Search and Run Test** | The runner window opens with the selection pre-filled |
| H9 | Check the add-on on Firefox 120 or older | Refuses to install (`strict_min_version` is 121.0) |

## Result log

| ID | Result | Browser / version | Notes |
| --- | --- | --- | --- |
| | | | |
