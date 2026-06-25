/**
 * Pure helpers for user-defined workflow inputs (no chrome / network deps).
 *
 * Each repository defines its own list of `workflow_dispatch` inputs so the
 * extension ships with NO project-specific field names. An input definition:
 *   {
 *     key:        "Test_Environment",   // the workflow_dispatch input name
 *     label:      "Environment",        // shown in the popup (defaults to key)
 *     type:       "select",             // select | text | number | checkbox
 *     options:    ["DEV", "QA"],        // choices for "select"
 *     default:    "QA",                 // default value
 *     isTestPath: false                 // auto-fill with the pytest node ID
 *   }
 */

export const INPUT_TYPES = ["select", "text", "number", "checkbox"];

/** Blank input row used when adding a new input on the Options page. */
export const NEW_INPUT_TEMPLATE = {
  key: "",
  label: "",
  type: "text",
  options: [],
  default: "",
  isTestPath: false
};

/** Split a comma/newline separated option list into a clean array. */
export function parseOptions(raw) {
  if (Array.isArray(raw)) {
    return raw.map((s) => String(s).trim()).filter(Boolean);
  }
  return String(raw || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalize an arbitrary object into a clean input definition. */
export function normalizeInput(raw) {
  const type = INPUT_TYPES.includes(raw?.type) ? raw.type : "text";
  let def = raw?.default;
  if (type === "checkbox") {
    def = def === true || def === "true";
  } else {
    def = def == null ? "" : String(def);
  }
  return {
    key: String(raw?.key || "").trim(),
    label: String(raw?.label || "").trim(),
    type,
    options: parseOptions(raw?.options),
    default: def,
    isTestPath: !!raw?.isTestPath
  };
}

/** Validate a single input definition. Returns { ok, error? }. */
export function validateInput(def) {
  if (!def.key) {
    return { ok: false, error: "input key is required" };
  }
  if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(def.key)) {
    return { ok: false, error: `invalid input key "${def.key}"` };
  }
  if (!INPUT_TYPES.includes(def.type)) {
    return { ok: false, error: `invalid type for "${def.key}"` };
  }
  if (def.type === "select" && !def.isTestPath && !def.options.length) {
    return { ok: false, error: `select "${def.key}" needs at least one option` };
  }
  return { ok: true };
}

/** Validate the whole inputs list for a repository. Returns { ok, error? }. */
export function validateInputs(list) {
  if (!Array.isArray(list) || !list.length) {
    return { ok: false, error: "Add at least one workflow input." };
  }
  const keys = new Set();
  let testPathCount = 0;
  for (const def of list) {
    const v = validateInput(def);
    if (!v.ok) return v;
    if (keys.has(def.key)) {
      return { ok: false, error: `duplicate input key "${def.key}"` };
    }
    keys.add(def.key);
    if (def.isTestPath) testPathCount++;
  }
  if (testPathCount > 1) {
    return { ok: false, error: "Only one input can be the Test Path target." };
  }
  return { ok: true };
}

/** The default value for an input definition (typed). */
export function defaultValueFor(def) {
  if (def.type === "checkbox") return !!def.default;
  return def.default == null ? "" : def.default;
}

/** Coerce a raw control value into the string GitHub expects. */
export function coerceInputValue(def, value) {
  if (def.type === "checkbox") {
    return String(value === true || value === "true");
  }
  if (def.type === "number") {
    const n = parseInt(value, 10);
    return String(Number.isFinite(n) ? n : 0);
  }
  return String(value == null ? "" : value);
}

/**
 * Build the `inputs` object for a workflow dispatch from the definitions and
 * the user-entered values. The input flagged `isTestPath` is filled with the
 * computed pytest node ID.
 */
export function buildDispatchInputs(defs, values, { testPath } = {}) {
  const out = {};
  for (const def of defs || []) {
    if (!def.key) continue;
    let raw;
    if (def.isTestPath) {
      raw = testPath;
    } else if (values && Object.prototype.hasOwnProperty.call(values, def.key)) {
      raw = values[def.key];
    } else {
      raw = defaultValueFor(def);
    }
    out[def.key] = coerceInputValue(def, raw);
  }
  return out;
}
