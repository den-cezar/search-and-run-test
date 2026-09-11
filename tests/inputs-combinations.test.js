/**
 * Combination coverage for user-defined workflow inputs: every input type
 * crossed with the test-path flag, the value sources the popup can produce,
 * and the Options → dispatch pipeline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  INPUT_TYPES,
  normalizeInput,
  validateInputs,
  defaultValueFor,
  coerceInputValue,
  buildDispatchInputs
} from "../lib/inputs.js";

const NODE_ID = "suite/test_login.py::test_login[QA]";

const def = (over = {}) => normalizeInput({ key: "field", type: "text", ...over });

// --- type × isTestPath -------------------------------------------------------

// Options lets any input be flagged as the test path, including types that
// cannot carry a node ID. These pin what each combination actually dispatches.
const TEST_PATH_MATRIX = [
  { type: "text", options: [], expected: NODE_ID },
  { type: "select", options: ["DEV", "QA"], expected: NODE_ID },
  { type: "number", options: [], expected: "0" },
  { type: "checkbox", options: [], expected: "false" }
];

for (const row of TEST_PATH_MATRIX) {
  test(`buildDispatchInputs: ${row.type} marked as test path yields "${row.expected}"`, () => {
    const defs = [def({ key: "Test_Path", type: row.type, options: row.options, isTestPath: true })];
    const out = buildDispatchInputs(defs, {}, { testPath: NODE_ID });
    assert.equal(out.Test_Path, row.expected);
  });
}

test("every declared input type is exercised by the test-path matrix", () => {
  assert.deepEqual([...INPUT_TYPES].sort(), TEST_PATH_MATRIX.map((r) => r.type).sort());
});

test("buildDispatchInputs: the test path overrides a user-entered value", () => {
  const defs = [def({ key: "Test_Path", isTestPath: true })];
  const out = buildDispatchInputs(defs, { Test_Path: "typed-by-hand" }, { testPath: NODE_ID });
  assert.equal(out.Test_Path, NODE_ID);
});

test("buildDispatchInputs: a test-path input with no node ID sends an empty string", () => {
  const defs = [def({ key: "Test_Path", isTestPath: true })];
  assert.equal(buildDispatchInputs(defs, {}, {}).Test_Path, "");
  assert.equal(buildDispatchInputs(defs, {}).Test_Path, "");
});

// --- value source: entered vs default vs missing -----------------------------

const VALUE_SOURCE_MATRIX = [
  { name: "entered value wins over the default", values: { field: "typed" }, expected: "typed" },
  { name: "missing key falls back to the default", values: {}, expected: "fallback" },
  { name: "present-but-undefined is treated as cleared", values: { field: undefined }, expected: "" },
  { name: "explicitly empty stays empty", values: { field: "" }, expected: "" }
];

for (const row of VALUE_SOURCE_MATRIX) {
  test(`buildDispatchInputs: ${row.name}`, () => {
    const defs = [def({ default: "fallback" })];
    assert.equal(buildDispatchInputs(defs, row.values, {}).field, row.expected);
  });
}

test("buildDispatchInputs: a null values object falls back to every default", () => {
  const defs = [
    def({ key: "a", default: "A" }),
    def({ key: "b", type: "number", default: "7" }),
    def({ key: "c", type: "checkbox", default: true })
  ];
  assert.deepEqual(buildDispatchInputs(defs, null, {}), { a: "A", b: "7", c: "true" });
});

test("buildDispatchInputs: values for unknown keys are dropped", () => {
  const defs = [def({ key: "kept" })];
  const out = buildDispatchInputs(defs, { kept: "yes", strayKey: "no" }, {});
  assert.deepEqual(out, { kept: "yes" });
});

test("buildDispatchInputs: no definitions yields an empty payload", () => {
  assert.deepEqual(buildDispatchInputs(null, { a: "1" }, {}), {});
  assert.deepEqual(buildDispatchInputs([], { a: "1" }, {}), {});
});

test("buildDispatchInputs: duplicate keys collapse to the last definition", () => {
  const defs = [def({ key: "dup", default: "first" }), def({ key: "dup", default: "second" })];
  assert.deepEqual(buildDispatchInputs(defs, {}, {}), { dup: "second" });
});

// --- select options ----------------------------------------------------------

test("select: a value outside the configured options is sent unchanged", () => {
  const defs = [def({ key: "Env", type: "select", options: ["DEV", "QA"], default: "DEV" })];
  assert.equal(buildDispatchInputs(defs, { Env: "PROD" }, {}).Env, "PROD");
});

test("select: a default outside the configured options is still used", () => {
  const defs = [def({ key: "Env", type: "select", options: ["DEV", "QA"], default: "STAGE" })];
  assert.equal(buildDispatchInputs(defs, {}, {}).Env, "STAGE");
});

test("select: no default sends an empty string", () => {
  const defs = [def({ key: "Env", type: "select", options: ["DEV", "QA"] })];
  assert.equal(buildDispatchInputs(defs, {}, {}).Env, "");
});

test("select: options are trimmed, de-blanked and order-preserving", () => {
  assert.deepEqual(normalizeInput({ key: "e", type: "select", options: " QA , ,DEV\n\nSTAGE " }).options, [
    "QA",
    "DEV",
    "STAGE"
  ]);
});

// --- number coercion ---------------------------------------------------------

const NUMBER_MATRIX = [
  ["4", "4"],
  ["4.9", "4"],
  ["-3", "-3"],
  ["  7  ", "7"],
  ["012", "12"],
  ["12abc", "12"],
  ["1e3", "1"],
  ["", "0"],
  ["abc", "0"],
  [null, "0"],
  [undefined, "0"],
  [true, "0"],
  [0, "0"],
  [5, "5"]
];

for (const [input, expected] of NUMBER_MATRIX) {
  test(`coerceInputValue: number ${JSON.stringify(input)} → "${expected}"`, () => {
    assert.equal(coerceInputValue({ type: "number" }, input), expected);
  });
}

// --- checkbox coercion -------------------------------------------------------

const CHECKBOX_MATRIX = [
  [true, "true"],
  ["true", "true"],
  [false, "false"],
  ["false", "false"],
  ["TRUE", "false"],
  ["on", "false"],
  [1, "false"],
  [0, "false"],
  [null, "false"],
  [undefined, "false"]
];

for (const [input, expected] of CHECKBOX_MATRIX) {
  test(`coerceInputValue: checkbox ${JSON.stringify(input)} → "${expected}"`, () => {
    assert.equal(coerceInputValue({ type: "checkbox" }, input), expected);
  });
}

// --- text coercion -----------------------------------------------------------

const TEXT_MATRIX = [
  ["plain", "plain"],
  ["", ""],
  [null, ""],
  [undefined, ""],
  [0, "0"],
  [false, "false"],
  ["  keeps spacing  ", "  keeps spacing  "]
];

for (const [input, expected] of TEXT_MATRIX) {
  test(`coerceInputValue: text ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
    assert.equal(coerceInputValue({ type: "text" }, input), expected);
  });
}

// --- defaults per type -------------------------------------------------------

test("defaultValueFor: every type returns the value the control expects", () => {
  assert.equal(defaultValueFor(def({ type: "text" })), "");
  assert.equal(defaultValueFor(def({ type: "select", options: ["DEV"] })), "");
  assert.equal(defaultValueFor(def({ type: "number" })), "");
  assert.equal(defaultValueFor(def({ type: "checkbox" })), false);
  assert.equal(defaultValueFor(def({ type: "checkbox", default: "true" })), true);
  assert.equal(defaultValueFor(def({ type: "number", default: 3 })), "3");
});

test("defaultValueFor: a definition with no default at all yields an empty string", () => {
  assert.equal(defaultValueFor({ type: "text" }), "");
  assert.equal(defaultValueFor({ type: "select", default: null }), "");
});

// --- normalize → validate → dispatch pipeline --------------------------------

test("pipeline: a realistic Options config normalizes, validates and dispatches", () => {
  const raw = [
    { key: " Test_Path ", label: " Test path ", type: "text", isTestPath: "yes" },
    { key: "Test_Environment", label: "Environment", type: "select", options: "DEV, QA\nSTAGE", default: "QA" },
    { key: "Threads", label: "Threads", type: "number", default: 2 },
    { key: "Upload_Report", label: "Upload report", type: "checkbox", default: "true" },
    { key: "Extra_Args", label: "Extra args", type: "bogus" }
  ];

  const defs = raw.map(normalizeInput);
  assert.equal(validateInputs(defs).ok, true);
  assert.equal(defs[0].key, "Test_Path");
  assert.equal(defs[0].isTestPath, true);
  assert.equal(defs[4].type, "text");

  assert.deepEqual(
    buildDispatchInputs(defs, { Test_Environment: "STAGE", Threads: "8" }, { testPath: NODE_ID }),
    {
      Test_Path: NODE_ID,
      Test_Environment: "STAGE",
      Threads: "8",
      Upload_Report: "true",
      Extra_Args: ""
    }
  );
});

test("pipeline: every dispatched value is a string, as workflow_dispatch requires", () => {
  const defs = INPUT_TYPES.map((type) =>
    normalizeInput({ key: `k_${type}`, type, options: ["DEV"], default: type === "checkbox" ? true : "1" })
  );
  const out = buildDispatchInputs(defs, {}, { testPath: NODE_ID });
  for (const [key, value] of Object.entries(out)) {
    assert.equal(typeof value, "string", `${key} should be a string`);
  }
});

// --- list-level validation ---------------------------------------------------

const INVALID_LISTS = [
  ["null", null],
  ["undefined", undefined],
  ["a non-array object", { key: "a" }],
  ["an empty list", []]
];

for (const [name, list] of INVALID_LISTS) {
  test(`validateInputs: rejects ${name}`, () => {
    assert.equal(validateInputs(list).ok, false);
  });
}

test("validateInputs: a normalized select with no options is rejected", () => {
  const defs = [normalizeInput({ key: "Env", type: "select", options: "" })];
  const r = validateInputs(defs);
  assert.equal(r.ok, false);
  assert.match(r.error, /needs at least one option/);
});

test("validateInputs: a type outside the supported list is rejected", () => {
  const r = validateInputs([{ key: "Env", type: "radio", options: [] }]);
  assert.equal(r.ok, false);
  assert.match(r.error, /invalid type/);
});

test("validateInputs: a select test path may omit options", () => {
  const defs = [normalizeInput({ key: "Test_Path", type: "select", options: "", isTestPath: true })];
  assert.equal(validateInputs(defs).ok, true);
});

test("validateInputs: exactly one test path is allowed", () => {
  const one = [
    normalizeInput({ key: "Test_Path", isTestPath: true }),
    normalizeInput({ key: "Env", type: "select", options: "DEV" })
  ];
  assert.equal(validateInputs(one).ok, true);

  const none = [normalizeInput({ key: "Env", type: "select", options: "DEV" })];
  assert.equal(validateInputs(none).ok, true);
});

const INVALID_KEYS = ["1lead", "has space", "has.dot", "has/slash", "", "-lead"];
for (const key of INVALID_KEYS) {
  test(`validateInputs: rejects the key ${JSON.stringify(key)}`, () => {
    assert.equal(validateInputs([normalizeInput({ key })]).ok, false);
  });
}

const VALID_KEYS = ["Test_Path", "_private", "a", "camelCase", "with-dash", "UPPER_1"];
for (const key of VALID_KEYS) {
  test(`validateInputs: accepts the key ${JSON.stringify(key)}`, () => {
    assert.equal(validateInputs([normalizeInput({ key })]).ok, true);
  });
}
