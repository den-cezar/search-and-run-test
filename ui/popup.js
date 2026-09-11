/**
 * Popup controller — search a test, pick a result, set params, dispatch.
 */

import { githubClient } from "../api/github-client.js";
import { storage } from "../api/storage-service.js";
import { validateTestName, validateBranch } from "../lib/validation.js";
import { buildDispatchInputs, defaultValueFor } from "../lib/inputs.js";
import { createLogger, initLogLevelFromStorage } from "../lib/logger.js";
import { esc } from "../lib/html.js";

const log = createLogger("popup");
const el = (id) => document.getElementById(id);

// Opened as a standalone popup window from the context menu (vs. the toolbar
// popup, which closes itself when focus moves to a new tab).
const isContextWindow = new URLSearchParams(location.search).get("source") === "context";

let currentResults = [];
let selectedHit = null;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await initLogLevelFromStorage();
  attachListeners();
  setStep("search");
  const connected = await checkConnection();
  if (!connected) return;
  await prefillTestName();
}

function attachListeners() {
  el("openOptionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  el("setupOptionsBtn").addEventListener("click", () => chrome.runtime.openOptionsPage());
  el("connStatus").addEventListener("click", () => chrome.runtime.openOptionsPage());
  el("searchBtn").addEventListener("click", onSearch);
  el("testName").addEventListener("keydown", (e) => {
    if (e.key === "Enter") onSearch();
  });
  el("testName").addEventListener("input", () => hideFieldError("testNameError", "testName"));
  el("newSearchBtn").addEventListener("click", goToSearch);
  el("runAnotherBtn").addEventListener("click", goToSearch);
  el("backBtn").addEventListener("click", showResults);
  el("runBtn").addEventListener("click", onRun);
  el("resultsFilter").addEventListener("input", renderResults);

  el("runBranch").addEventListener("input", () => {
    const r = validateBranch(el("runBranch").value);
    r.ok ? hideFieldError("runBranchError", "runBranch") : showFieldError("runBranchError", "runBranch", r.error);
  });
}

/**
 * Render the run form for the selected hit from its user-defined workflow
 * inputs. If the repo has no inputs configured, show the "setup not done"
 * notice and disable Run.
 */
function populateParamsForHit() {
  const defs = selectedHit && Array.isArray(selectedHit.inputs) ? selectedHit.inputs : [];
  el("runBranch").value = (selectedHit && selectedHit.branch) || "main";
  hideFieldError("runBranchError", "runBranch");

  const form = el("inputsForm");
  form.innerHTML = "";

  const notSetUp = defs.length === 0;
  el("setupNotice").classList.toggle("hidden", !notSetUp);
  el("runBtn").disabled = notSetUp;
  el("runBranch").disabled = notSetUp;
  if (notSetUp) return;

  defs.forEach((def, i) => {
    if (def.isTestPath) {
      // Auto-filled with the computed pytest node ID; shown read-only.
      const wrap = document.createElement("div");
      wrap.className = "input-field";
      wrap.innerHTML =
        `<label>${esc(def.label || def.key)} <span class="muted">(test path)</span></label>` +
        `<input type="text" value="${esc(selectedHit.testPath)}" readonly />`;
      form.appendChild(wrap);
      return;
    }
    form.appendChild(renderInputControl(def, i));
  });
}

/** Build a labelled control for one input definition. */
function renderInputControl(def, i) {
  const wrap = document.createElement("div");
  const id = `inp-${i}`;
  const label = esc(def.label || def.key);

  if (def.type === "checkbox") {
    wrap.className = "input-field";
    const checked = defaultValueFor(def) ? "checked" : "";
    wrap.innerHTML =
      `<label class="checkbox"><input type="checkbox" id="${id}" data-key="${esc(def.key)}" data-type="checkbox" ${checked} /> ${label}</label>`;
    return wrap;
  }

  wrap.className = "input-field";
  let control;
  if (def.type === "select") {
    const opts = def.options
      .map((o) => `<option value="${esc(o)}" ${o === def.default ? "selected" : ""}>${esc(o)}</option>`)
      .join("");
    control = `<select id="${id}" data-key="${esc(def.key)}" data-type="select">${opts}</select>`;
  } else if (def.type === "number") {
    control = `<input id="${id}" type="number" data-key="${esc(def.key)}" data-type="number" value="${esc(def.default)}" />`;
  } else {
    control = `<input id="${id}" type="text" data-key="${esc(def.key)}" data-type="text" value="${esc(def.default)}" />`;
  }
  wrap.innerHTML = `<label for="${id}">${label}</label>${control}`;
  return wrap;
}

/** Collect entered values keyed by the workflow input name. */
function collectInputValues() {
  const values = {};
  el("inputsForm")
    .querySelectorAll("[data-key]")
    .forEach((node) => {
      const key = node.dataset.key;
      values[key] = node.dataset.type === "checkbox" ? node.checked : node.value;
    });
  return values;
}

async function checkConnection() {
  const token = await storage.getToken();
  if (!token) {
    setConnPill("Disconnected", "pill-bad");
    showNotConnected();
    return false;
  }
  try {
    const user = await githubClient.getUser();
    setConnPill(`@${user.login}`, "pill-good");
    return true;
  } catch (e) {
    log.warn("connection check failed", e.message);
    setConnPill("Disconnected", "pill-bad");
    showNotConnected();
    return false;
  }
}

function setConnPill(text, cls) {
  const status = el("connStatus");
  status.textContent = text;
  status.className = `pill ${cls}`;
}

function showNotConnected() {
  hideAllSections();
  el("steps").classList.add("hidden");
  el("notConnected").classList.remove("hidden");
}

async function prefillTestName() {
  // 1) Selection handed off from the context menu.
  const pending = await storage.takePendingSelection();
  if (pending) {
    el("testName").value = pending;
    onSearch();
    return;
  }
  // 2) Live selection from the active tab.
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      const resp = await chrome.tabs.sendMessage(tab.id, { action: "getSelection" }).catch(() => null);
      if (resp && resp.selection) {
        el("testName").value = resp.selection;
      }
    }
  } catch (_) {
    /* content script not present on this page — ignore */
  }
}

async function onSearch() {
  clearMessage();
  const valid = validateTestName(el("testName").value);
  if (!valid.ok) {
    showFieldError("testNameError", "testName", valid.error);
    return;
  }
  hideFieldError("testNameError", "testName");

  setBtnLoading("searchBtn", true);
  log.info("searching", valid.value);
  try {
    const { results } = await githubClient.searchTest(valid.value);
    currentResults = results;
    if (!results.length) {
      showMessage(`No test matching “${valid.value}” was found in the configured repos.`, "error");
      return;
    }
    showResults();
  } catch (e) {
    log.error("search failed", e);
    showMessage(e.message, "error");
  } finally {
    setBtnLoading("searchBtn", false);
  }
}

function showResults() {
  hideAllSections();
  setStep("results");
  el("resultsCount").textContent =
    `${currentResults.length} ${currentResults.length === 1 ? "test" : "tests"}`;
  el("resultsFilter").classList.toggle("hidden", currentResults.length <= 5);
  el("resultsFilter").value = "";
  renderResults();
  el("resultsSection").classList.remove("hidden");
}

function renderResults() {
  const filter = el("resultsFilter").value.trim().toLowerCase();
  const list = el("resultsList");
  list.innerHTML = "";

  const shown = filter
    ? currentResults.filter(
        (h) => h.funcName.toLowerCase().includes(filter) || h.testPath.toLowerCase().includes(filter)
      )
    : currentResults;

  if (!shown.length) {
    list.innerHTML = `<p class="muted">No results match “${esc(filter)}”.</p>`;
    return;
  }

  const byRepo = shown.reduce((acc, hit) => {
    (acc[hit.repoName] = acc[hit.repoName] || []).push(hit);
    return acc;
  }, {});

  for (const [repoName, hits] of Object.entries(byRepo)) {
    const group = document.createElement("div");
    group.className = "result-group";
    const title = document.createElement("div");
    title.className = "result-group-title";
    title.textContent = `${repoName} · ${hits[0].owner}/${hits[0].repo}`;
    group.appendChild(title);

    hits.forEach((hit) => {
      const btn = document.createElement("button");
      btn.className = "result-item";
      btn.innerHTML =
        `<span class="result-name">${esc(hit.funcName)}</span>` +
        `<span class="result-path">${esc(hit.testPath)}</span>`;
      btn.addEventListener("click", () => selectHit(hit));
      group.appendChild(btn);
    });
    list.appendChild(group);
  }
}

function selectHit(hit) {
  selectedHit = hit;
  hideAllSections();
  setStep("params");
  populateParamsForHit();
  el("selectedHit").innerHTML =
    `<div class="hit-repo"><strong>${esc(hit.repoName)}</strong> · ${esc(hit.workflow)}</div>` +
    `<code>${esc(hit.testPath)}</code>`;
  el("paramsSection").classList.remove("hidden");
}

async function onRun() {
  if (!selectedHit) return;
  clearMessage();

  const defs = Array.isArray(selectedHit.inputs) ? selectedHit.inputs : [];
  if (!defs.length) {
    showMessage("This repository has no workflow inputs configured. Open Options to set it up.", "error");
    return;
  }

  const branch = validateBranch(el("runBranch").value);
  if (!branch.ok) {
    showFieldError("runBranchError", "runBranch", branch.error);
    return;
  }

  const values = collectInputValues();
  const inputs = buildDispatchInputs(defs, values, { testPath: selectedHit.testPath });

  setBtnLoading("runBtn", true);
  log.info("dispatching", { test: selectedHit.testPath, ref: branch.value, inputs });
  try {
    const { html_url } = await githubClient.dispatchWorkflow(selectedHit, {
      ref: branch.value,
      inputs
    });
    showRunResult(html_url);
  } catch (e) {
    log.error("dispatch failed", e);
    showMessage(e.message, "error");
  } finally {
    setBtnLoading("runBtn", false);
  }
}

function showRunResult(htmlUrl) {
  hideAllSections();
  setStep("output");
  const body = el("outputBody");
  const head =
    `<p class="success">✓ Test dispatched.</p>` +
    `<p class="muted result-path">${esc(selectedHit.testPath)}</p>`;
  if (htmlUrl) {
    body.innerHTML =
      head +
      `<a id="openRunLink" href="${esc(htmlUrl)}" target="_blank" rel="noopener" class="btn btn-primary btn-block">Open workflow run ↗</a>`;
    if (isContextWindow) {
      el("openRunLink").addEventListener("click", () => {
        // Let the new tab open first, then close this standalone window.
        setTimeout(() => window.close(), 0);
      });
    }
  } else {
    body.innerHTML =
      head +
      `<p class="muted">GitHub did not return a run link. Check the Actions tab of the repo.</p>`;
  }
  el("outputSection").classList.remove("hidden");
}

function goToSearch() {
  hideAllSections();
  clearMessage();
  setStep("search");
  el("searchSection").classList.remove("hidden");
  el("testName").focus();
  el("testName").select();
}

// --- UI helpers ---
function setStep(active) {
  const order = ["search", "results", "params", "output"];
  const activeIdx = order.indexOf(active);
  el("steps").classList.remove("hidden");
  document.querySelectorAll(".step").forEach((s) => {
    const idx = order.indexOf(s.dataset.step);
    s.classList.toggle("step-active", idx === activeIdx);
    s.classList.toggle("step-done", idx < activeIdx);
  });
}

function hideAllSections() {
  ["notConnected", "searchSection", "resultsSection", "paramsSection", "outputSection"].forEach((id) =>
    el(id).classList.add("hidden")
  );
}

function setBtnLoading(btnId, on) {
  const btn = el(btnId);
  btn.disabled = on;
  btn.querySelector(".btn-label").classList.toggle("hidden", on);
  btn.querySelector(".btn-spinner").classList.toggle("hidden", !on);
}

function showFieldError(errId, inputId, text) {
  const e = el(errId);
  e.textContent = text;
  e.classList.remove("hidden");
  el(inputId).classList.add("invalid");
}

function hideFieldError(errId, inputId) {
  el(errId).classList.add("hidden");
  el(inputId).classList.remove("invalid");
}

function showMessage(text, type) {
  const m = el("message");
  m.textContent = text;
  m.className = `message ${type}`;
  m.classList.remove("hidden");
}

function clearMessage() {
  el("message").classList.add("hidden");
}
