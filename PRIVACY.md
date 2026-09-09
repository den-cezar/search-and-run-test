# Privacy Policy — Search & Run Test

**Last updated:** 2026-09-09

Search & Run Test is a free, open-source browser extension published under the
MIT license. Its source code is available at
<https://github.com/den-cezar/search-and-run-test>.

## Summary

The developer collects nothing. The extension has no backend, no analytics, and
no third-party services. It communicates only with GitHub, using credentials the
user supplies, and only when the user asks it to.

## What the extension stores

All data stays in the browser's own extension storage on the user's device.

Stored in `chrome.storage.local`:

- The GitHub OAuth access token obtained when the user connects their account.
- The text selection handed from the right-click menu to the popup. It is deleted
  as soon as the popup reads it.

Stored in `chrome.storage.sync`:

- The list of GitHub repositories the user configures, including owner, repository
  name, workflow file, branch, path base, and workflow input definitions.
- The GitHub OAuth App client ID the user provides.
- The console log-level preference.

Data in `chrome.storage.sync` is replicated by the browser itself across the
user's signed-in profiles. That synchronisation is performed by Chrome or Edge
under their own privacy policies, not by this extension or its developer.

## What the extension transmits

Network requests are made only to the following endpoints, and only in response
to a user action:

- `https://api.github.com/*` — to search the user's configured repositories for a
  test name, and to dispatch the selected GitHub Actions workflow.
- `https://github.com/login/device/code` and
  `https://github.com/login/oauth/access_token` — to complete GitHub OAuth Device
  Flow sign-in.

Nothing is sent to the developer or to any other party. There are no analytics,
telemetry, crash reporting, advertising, or tracking of any kind.

## Page access

A content script runs on `*.atlassian.net` pages. It does one thing: when the
extension explicitly asks, it returns the text the user has currently selected,
so the popup can pre-fill the test name field. It does not read, store, or
transmit page content, and it takes no action on its own.

## Authentication

Sign-in uses GitHub OAuth Device Flow. The user registers their own GitHub OAuth
App and provides its client ID; the extension ships with none. No client secret
is used or stored. The resulting access token is scoped to the user's own GitHub
account and never leaves the device except in requests to GitHub.

## User control

- **Disconnect** on the Options page deletes the stored access token.
- Access can be revoked at any time at
  <https://github.com/settings/applications>.
- Removing the extension deletes all of its stored data.
- **Export** and **Import** on the Options page let the user move their own
  configuration between machines as a JSON file.

## Remote code

The extension executes no remotely hosted code. All JavaScript is contained in
the published package. There are no external script tags, no remotely loaded
modules, and no use of `eval()`.

## Children

The extension is a developer tool and is not directed at children.

## Changes

Material changes to this policy will be published in this file, and its revision
history is public in the repository.

## Contact

Questions and reports: <https://github.com/den-cezar/search-and-run-test/issues>
