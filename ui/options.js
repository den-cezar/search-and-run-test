/**
 * Options controller — connect to GitHub (device flow), manage repos & log level.
 */

import { githubClient } from "../api/github-client.js";
import { storage } from "../api/storage-service.js";
import { NEW_REPO_TEMPLATE } from "../config/config.js";
import { validateBranch, validateRepoConfig } from "../lib/validation.js";
import {
  INPUT_TYPES,
  NEW_INPUT_TEMPLATE,
  normalizeInput,
  validateInputs,
  parseOptions
} from "../lib/inputs.js";
import { createLogger, initLogLevelFromStorage, setLogLevel } from "../lib/logger.js";
import { esc } from "../lib/html.js";

const log = createLogger("options");
const el = (id) => document.getElementById(id);
let repos = [];

// Per-section "unsaved changes" tracking. Save buttons stay disabled until the
// matching section is edited, and disable again right after a successful save.
const SAVE_BTNS = {
  repos: "saveReposBtn",
  logLevel: "saveLogLevelBtn"
};

function setDirty(section, isDirty) {
  el(SAVE_BTNS[section]).disabled = !isDirty;
}

document.addEventListener("DOMContentLoaded", init);

async function init() {
  await initLogLevelFromStorage();
  await loadClientId();
  await loadRepos();
  await loadLogLevel();
  attachListeners();
  await refreshConnStatus();
}

function attachListeners() {
  el("connectBtn").addEventListener("click", onConnect);
  el("checkBtn").addEventListener("click", onCheckConnection);
  el("disconnectBtn").addEventListener("click", onDisconnect);
  el("saveLogLevelBtn").addEventListener("click", saveLogLevel);
  el("addRepoBtn").addEventListener("click", () => {
    repos.push(structuredClone(NEW_REPO_TEMPLATE));
    renderRepos();
    setDirty("repos", true);
  });
  el("exportReposBtn").addEventListener("click", onExportRepos);
  el("importReposBtn").addEventListener("click", () => el("importReposFile").click());
  el("importReposFile").addEventListener("change", onImportRepos);
  el("saveReposBtn").addEventListener("click", saveRepos);
  el("clientId").addEventListener("change", async () => {
    await storage.setClientId(el("clientId").value.trim());
  });
  el("logLevel").addEventListener("change", () => setDirty("logLevel", true));
}

async function loadClientId() {
  el("clientId").value = await storage.getClientId();
}

async function loadLogLevel() {
  const r = await chrome.storage.sync.get("log_level");
  el("logLevel").value = r.log_level || "info";
}

async function saveLogLevel() {
  const level = el("logLevel").value;
  await chrome.storage.sync.set({ log_level: level });
  setLogLevel(level);
  setDirty("logLevel", false);
  log.info("log level set to", level);
  showMessage(`Log level set to ${level}.`, "success");
}

async function loadRepos() {
  // Normalize on read: stored configs may predate the current shape.
  repos = (await storage.getRepos()).map(normalizeRepo);
  renderRepos();
}

function renderRepos() {
  const container = el("reposList");
  container.innerHTML = "";

  if (!repos.length) {
    const empty = document.createElement("p");
    empty.className = "muted repos-empty";
    empty.textContent =
      "No repositories yet. Add one or import a config.";
    container.appendChild(empty);
    return;
  }

  const FIELDS = [
    { f: "name", label: "Name", placeholder: "my-tests" },
    { f: "owner", label: "Owner", placeholder: "your-org" },
    { f: "repo", label: "Repo", placeholder: "your-test-repo" },
    { f: "workflow", label: "Workflow file", placeholder: "run-tests.yml" },
    { f: "branch", label: "Branch", placeholder: "main" },
    { f: "pathBase", label: "Path base to strip", placeholder: "path/to/tests/" }
  ];

  repos.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "repo-row";
    const title = r.name || r.repo || `Repository ${i + 1}`;
    const lines = FIELDS.map((fld) => {
      const raw = r[fld.f];
      return `
        <div class="field-line">
          <label for="repo-${i}-${fld.f}">${esc(fld.label)}</label>
          <input id="repo-${i}-${fld.f}" data-f="${fld.f}" data-i="${i}"
                 value="${esc(raw)}" placeholder="${esc(fld.placeholder)}" />
        </div>`;
    }).join("");
    row.innerHTML = `
      <div class="repo-head">
        <span class="repo-row-title">${esc(title)}</span>
        <button class="btn btn-danger btn-sm remove-repo" data-i="${i}">Remove</button>
      </div>
      <div class="repo-fields">${lines}</div>
      <div class="inputs-editor" data-repo="${i}">
        <div class="inputs-editor-head">
          <span class="inputs-title">Workflow inputs</span>
          <button class="btn btn-sm add-input" data-i="${i}">Add input</button>
        </div>
        <div class="inputs-rows">${renderInputRows(r.inputs || [], i)}</div>
        <p class="muted inputs-hint">These map to your workflow's <code>workflow_dispatch</code> inputs. Mark one as <strong>Test path</strong> to auto-fill it with the selected test's node ID.</p>
      </div>
    `;
    container.appendChild(row);
  });

  wireRepoEvents(container);
}

/** Build the HTML for a repo's list of input-definition rows. */
function renderInputRows(inputs, ri) {
  if (!inputs.length) {
    return `<p class="muted no-inputs">No inputs yet. Add the ones your workflow expects.</p>`;
  }
  return inputs
    .map((inp, j) => {
      const typeOpts = INPUT_TYPES.map(
        (t) => `<option value="${t}" ${t === inp.type ? "selected" : ""}>${t}</option>`
      ).join("");
      const optionsLine =
        inp.type === "select"
          ? `<div class="field-line">
               <label>Options</label>
               <input data-ri="${ri}" data-ij="${j}" data-if="options"
                      value="${esc((inp.options || []).join(", "))}" placeholder="DEV, QA, STAGE" />
             </div>`
          : "";
      const defaultLine = inp.isTestPath
        ? `<div class="field-line"><label>Default</label><input value="(auto: test path)" disabled /></div>`
        : inp.type === "checkbox"
        ? `<label class="checkbox"><input type="checkbox" data-ri="${ri}" data-ij="${j}" data-if="default" ${inp.default ? "checked" : ""} /> Default on</label>`
        : `<div class="field-line">
             <label>Default</label>
             <input data-ri="${ri}" data-ij="${j}" data-if="default" value="${esc(inp.default)}" placeholder="" />
           </div>`;
      return `
        <div class="input-def">
          <div class="input-def-head">
            <span class="input-def-title">${esc(inp.label || inp.key || `Input ${j + 1}`)}</span>
            <button class="btn btn-danger btn-sm remove-input" data-ri="${ri}" data-ij="${j}">Remove</button>
          </div>
          <div class="field-line">
            <label>Input key</label>
            <input data-ri="${ri}" data-ij="${j}" data-if="key" value="${esc(inp.key)}" placeholder="Test_Environment" />
          </div>
          <div class="field-line">
            <label>Label</label>
            <input data-ri="${ri}" data-ij="${j}" data-if="label" value="${esc(inp.label)}" placeholder="Environment" />
          </div>
          <div class="field-line">
            <label>Type</label>
            <select data-ri="${ri}" data-ij="${j}" data-if="type">${typeOpts}</select>
          </div>
          ${optionsLine}
          ${defaultLine}
          <label class="checkbox">
            <input type="checkbox" data-ri="${ri}" data-ij="${j}" data-if="isTestPath" ${inp.isTestPath ? "checked" : ""} />
            Use as Test path (auto-filled with the selected test's node ID)
          </label>
        </div>`;
    })
    .join("");
}

/** Wire up all change handlers for the repos editor. */
function wireRepoEvents(container) {
  container.querySelectorAll("input[data-f]").forEach((input) => {
    input.addEventListener("input", () => {
      const i = parseInt(input.dataset.i, 10);
      repos[i][input.dataset.f] = input.value;
      setDirty("repos", true);
      if (input.dataset.f === "name" || input.dataset.f === "repo") {
        const head = input.closest(".repo-row").querySelector(".repo-row-title");
        if (head) head.textContent = repos[i].name || repos[i].repo || `Repository ${i + 1}`;
      }
    });
  });

  // Per-input definition fields.
  container.querySelectorAll("[data-if]").forEach((node) => {
    const evt = node.matches('input[type="checkbox"]') || node.tagName === "SELECT" ? "change" : "input";
    node.addEventListener(evt, () => {
      const ri = parseInt(node.dataset.ri, 10);
      const ij = parseInt(node.dataset.ij, 10);
      const field = node.dataset.if;
      const inp = repos[ri].inputs[ij];
      if (field === "options") {
        inp.options = parseOptions(node.value);
      } else if (field === "isTestPath") {
        inp.isTestPath = node.checked;
      } else if (field === "default" && inp.type === "checkbox") {
        inp.default = node.checked;
      } else if (field === "type") {
        inp.type = node.value;
        renderRepos(); // re-render so type-specific fields appear/disappear
      } else {
        inp[field] = node.value;
      }
      setDirty("repos", true);
      if (field === "key" || field === "label") {
        const head = node.closest(".input-def")?.querySelector(".input-def-title");
        if (head) head.textContent = inp.label || inp.key || `Input ${ij + 1}`;
      }
    });
  });

  container.querySelectorAll(".add-input").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = parseInt(btn.dataset.i, 10);
      repos[i].inputs = repos[i].inputs || [];
      repos[i].inputs.push({ ...NEW_INPUT_TEMPLATE, options: [] });
      renderRepos();
      setDirty("repos", true);
    });
  });
  container.querySelectorAll(".remove-input").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ri = parseInt(btn.dataset.ri, 10);
      const ij = parseInt(btn.dataset.ij, 10);
      repos[ri].inputs.splice(ij, 1);
      renderRepos();
      setDirty("repos", true);
    });
  });
  container.querySelectorAll(".remove-repo").forEach((btn) => {
    btn.addEventListener("click", () => {
      repos.splice(parseInt(btn.dataset.i, 10), 1);
      renderRepos();
      setDirty("repos", true);
    });
  });
}

/** Normalize an arbitrary object into a repo config row. */
function normalizeRepo(r) {
  const inputs = Array.isArray(r?.inputs) ? r.inputs.map(normalizeInput) : [];
  return {
    name: String(r?.name || "").trim(),
    owner: String(r?.owner || "").trim(),
    repo: String(r?.repo || "").trim(),
    workflow: String(r?.workflow || "").trim(),
    pathBase: String(r?.pathBase || "").trim(),
    branch: String(r?.branch || "main").trim(),
    inputs
  };
}

function onExportRepos() {
  const data = JSON.stringify(repos, null, 2);
  const blob = new Blob([data], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "search-and-run-repos.json";
  a.click();
  URL.revokeObjectURL(url);
  log.info("exported repos", repos.length);
}

async function onImportRepos(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const list = Array.isArray(parsed) ? parsed : parsed.repos;
    if (!Array.isArray(list)) {
      throw new Error("Expected a JSON array of repositories.");
    }
    repos = list.map(normalizeRepo);
    renderRepos();
    setDirty("repos", true);
    showMessage(`Imported ${repos.length} repository(ies). Review and Save.`, "success");
  } catch (err) {
    showMessage(`Import failed: ${err.message}`, "error");
  } finally {
    e.target.value = "";
  }
}

async function saveRepos() {
  const cleaned = repos.map(normalizeRepo);

  // Validate every non-empty row; skip fully-empty rows.
  const nonEmpty = cleaned.filter((r) => r.owner || r.repo || r.workflow || r.name);
  for (const r of nonEmpty) {
    const label = r.name || r.repo || "(unnamed)";
    const v = validateRepoConfig(r);
    if (!v.ok) {
      showMessage(`Repository "${label}": ${v.error}`, "error");
      return;
    }
    const branch = validateBranch(r.branch);
    if (!branch.ok) {
      showMessage(`Repository "${label}": ${branch.error}`, "error");
      return;
    }
    // Inputs are optional to save (the popup blocks running until configured),
    // but if any are defined they must be valid.
    if (r.inputs.length) {
      const inputs = validateInputs(r.inputs);
      if (!inputs.ok) {
        showMessage(`Repository "${label}" inputs: ${inputs.error}`, "error");
        return;
      }
    }
  }

  await storage.setRepos(nonEmpty);
  repos = nonEmpty;
  renderRepos();
  setDirty("repos", false);
  log.info("repos saved", nonEmpty.length);
  showMessage(`Saved ${nonEmpty.length} repository(ies).`, "success");
}

// --- GitHub device flow ---
async function onConnect() {
  clearMessage();
  await storage.setClientId(el("clientId").value.trim());
  const box = el("deviceBox");
  const status = el("deviceStatus");
  try {
    const device = await githubClient.startDeviceFlow();
    el("userCode").textContent = device.user_code;
    el("verifyLink").href = device.verification_uri;
    box.classList.remove("hidden");
    status.textContent = "Waiting for authorization…";

    // Open the verification page for convenience.
    window.open(device.verification_uri, "_blank", "noopener");

    await githubClient.pollForToken(
      device.device_code,
      device.interval,
      device.expires_in,
      (s) => (status.textContent = s)
    );

    status.textContent = "Connected!";
    box.classList.add("hidden");
    showMessage("Connected to GitHub.", "success");
    await refreshConnStatus();
  } catch (e) {
    status.textContent = "";
    box.classList.add("hidden");
    showMessage(`Connection failed: ${e.message}`, "error");
  }
}

async function onCheckConnection() {
  clearMessage();
  const status = el("connStatus");
  status.textContent = "Checking…";
  try {
    const user = await githubClient.getUser();
    let html = `<div class="status-ok">Connected as <strong>@${user.login}</strong></div>`;
    for (const cfg of repos) {
      if (!cfg.owner || !cfg.repo || !cfg.workflow) continue;
      const res = await githubClient.checkRepo(cfg);
      const cls = res.ok ? "status-ok" : "status-bad";
      html += `<div class="${cls}">${cfg.owner}/${cfg.repo} → ${cfg.workflow}: ${res.message}</div>`;
    }
    status.innerHTML = html;
  } catch (e) {
    status.innerHTML = `<div class="status-bad">${e.message}</div>`;
  }
}

async function onDisconnect() {
  await storage.clearToken();
  await refreshConnStatus();
  showMessage("Disconnected.", "success");
}

async function refreshConnStatus() {
  const status = el("connStatus");
  const token = await storage.getToken();
  if (!token) {
    status.innerHTML = `<div class="status-bad">Not connected.</div>`;
    return;
  }
  try {
    const user = await githubClient.getUser();
    status.innerHTML = `<div class="status-ok">Connected as <strong>@${user.login}</strong></div>`;
  } catch (e) {
    status.innerHTML = `<div class="status-bad">Token invalid — reconnect.</div>`;
  }
}

// --- helpers ---
function showMessage(text, type) {
  const m = el("message");
  m.textContent = text;
  m.className = `message ${type}`;
  m.classList.remove("hidden");
}

function clearMessage() {
  el("message").classList.add("hidden");
}
