/**
 * Pure validation helpers (no chrome / network deps) — unit-testable in Node.
 * Each validator returns { ok: boolean, value?, error? }.
 */

/** Test name: must look like a pytest function (optionally parametrized). */
export function validateTestName(raw) {
  const name = (raw || "").trim();
  if (!name) {
    return { ok: false, error: "Enter a test name to search." };
  }
  if (!/^[A-Za-z_]/.test(name)) {
    return { ok: false, error: "Test name must start with a letter or underscore." };
  }
  // Allow word chars plus an optional [param] segment with spaces/hyphens.
  if (!/^\w+(\[[^\]]*\])?$/.test(name)) {
    return {
      ok: false,
      error: "Use a function name like test_example or test_example[param]."
    };
  }
  return { ok: true, value: name };
}

/** Threads: positive integer within a sane bound. */
export function validateThreads(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || String(raw).trim() === "") {
    return { ok: false, error: "Threads must be a number." };
  }
  if (n < 1) {
    return { ok: false, error: "Threads must be at least 1." };
  }
  if (n > 50) {
    return { ok: false, error: "Threads must be 50 or fewer." };
  }
  return { ok: true, value: n };
}

/** Branch / git ref: non-empty, no spaces or illegal ref characters. */
export function validateBranch(raw) {
  const branch = (raw || "").trim();
  if (!branch) {
    return { ok: false, error: "Branch is required." };
  }
  // Disallow whitespace and characters git refuses in ref names.
  if (/[\s~^:?*[\\]/.test(branch) || branch.includes("..") || branch.endsWith("/")) {
    return { ok: false, error: "Branch contains invalid characters." };
  }
  return { ok: true, value: branch };
}

/** Environment: must be one of the configured options. */
export function validateEnvironment(raw, allowed) {
  const env = (raw || "").trim().toUpperCase();
  if (!allowed.includes(env)) {
    return { ok: false, error: `Environment must be one of: ${allowed.join(", ")}.` };
  }
  return { ok: true, value: env };
}

/** A single repository config row. */
export function validateRepoConfig(cfg) {
  const errors = [];
  if (!cfg.owner || !cfg.owner.trim()) errors.push("owner is required");
  if (!cfg.repo || !cfg.repo.trim()) errors.push("repo is required");
  if (!cfg.workflow || !cfg.workflow.trim()) {
    errors.push("workflow file is required");
  } else if (!/\.ya?ml$/.test(cfg.workflow.trim())) {
    errors.push("workflow must be a .yml/.yaml file");
  }
  return { ok: errors.length === 0, error: errors.join(", ") };
}
