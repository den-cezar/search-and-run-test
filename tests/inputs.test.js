import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseOptions,
  normalizeInput,
  validateInput,
  validateInputs,
  defaultValueFor,
  coerceInputValue,
  buildDispatchInputs
} from "../lib/inputs.js";

// --- parseOptions ------------------------------------------------------------

test("parseOptions: splits on commas and newlines and trims", () => {
  assert.deepEqual(parseOptions("DEV, QA\nSTAGE"), ["DEV", "QA", "STAGE"]);
});

test("parseOptions: passes through arrays", () => {
  assert.deepEqual(parseOptions([" DEV ", "QA", ""]), ["DEV", "QA"]);
});

test("parseOptions: empty input yields empty array", () => {
  assert.deepEqual(parseOptions(""), []);
  assert.deepEqual(parseOptions(null), []);
});

// --- normalizeInput ----------------------------------------------------------

test("normalizeInput: fills defaults and trims", () => {
  const def = normalizeInput({ key: " env ", label: " Env " });
  assert.equal(def.key, "env");
  assert.equal(def.label, "Env");
  assert.equal(def.type, "text");
  assert.deepEqual(def.options, []);
  assert.equal(def.default, "");
  assert.equal(def.isTestPath, false);
});

test("normalizeInput: checkbox default is boolean", () => {
  assert.equal(normalizeInput({ key: "x", type: "checkbox", default: "true" }).default, true);
  assert.equal(normalizeInput({ key: "x", type: "checkbox", default: false }).default, false);
});

test("normalizeInput: invalid type falls back to text", () => {
  assert.equal(normalizeInput({ key: "x", type: "bogus" }).type, "text");
});

// --- validateInput -----------------------------------------------------------

test("validateInput: key required", () => {
  assert.equal(validateInput({ key: "", type: "text" }).ok, false);
});

test("validateInput: invalid key chars rejected", () => {
  assert.equal(validateInput({ key: "1bad", type: "text" }).ok, false);
  assert.equal(validateInput({ key: "good_Key-1", type: "text" }).ok, true);
});

test("validateInput: select needs options unless isTestPath", () => {
  assert.equal(validateInput({ key: "e", type: "select", options: [] }).ok, false);
  assert.equal(validateInput({ key: "e", type: "select", options: ["DEV"] }).ok, true);
  assert.equal(validateInput({ key: "e", type: "select", options: [], isTestPath: true }).ok, true);
});

// --- validateInputs ----------------------------------------------------------

test("validateInputs: rejects empty list", () => {
  assert.equal(validateInputs([]).ok, false);
});

test("validateInputs: rejects duplicate keys", () => {
  const r = validateInputs([
    { key: "a", type: "text", options: [] },
    { key: "a", type: "text", options: [] }
  ]);
  assert.equal(r.ok, false);
});

test("validateInputs: rejects more than one test path", () => {
  const r = validateInputs([
    { key: "a", type: "text", options: [], isTestPath: true },
    { key: "b", type: "text", options: [], isTestPath: true }
  ]);
  assert.equal(r.ok, false);
});

test("validateInputs: accepts a valid list", () => {
  const r = validateInputs([
    { key: "Test_Environment", type: "select", options: ["DEV"], isTestPath: false },
    { key: "Test_Path", type: "text", options: [], isTestPath: true }
  ]);
  assert.equal(r.ok, true);
});

// --- defaultValueFor / coerceInputValue --------------------------------------

test("defaultValueFor: checkbox returns boolean", () => {
  assert.equal(defaultValueFor({ type: "checkbox", default: true }), true);
  assert.equal(defaultValueFor({ type: "text", default: "x" }), "x");
});

test("coerceInputValue: checkbox -> 'true'/'false' string", () => {
  assert.equal(coerceInputValue({ type: "checkbox" }, true), "true");
  assert.equal(coerceInputValue({ type: "checkbox" }, false), "false");
});

test("coerceInputValue: number -> integer string", () => {
  assert.equal(coerceInputValue({ type: "number" }, "4.9"), "4");
  assert.equal(coerceInputValue({ type: "number" }, "abc"), "0");
});

test("coerceInputValue: text -> string", () => {
  assert.equal(coerceInputValue({ type: "text" }, "hello"), "hello");
});

// --- buildDispatchInputs -----------------------------------------------------

test("buildDispatchInputs: fills test path and coerces values", () => {
  const defs = [
    { key: "Test_Environment", type: "select", options: ["DEV", "QA"], default: "QA" },
    { key: "Threads", type: "number", default: "1" },
    { key: "Upload_Xray", type: "checkbox", default: false },
    { key: "Test_Path", type: "text", isTestPath: true }
  ];
  const values = { Test_Environment: "DEV", Threads: "3", Upload_Xray: true };
  const out = buildDispatchInputs(defs, values, { testPath: "tests/test_a.py::test_x" });
  assert.deepEqual(out, {
    Test_Environment: "DEV",
    Threads: "3",
    Upload_Xray: "true",
    Test_Path: "tests/test_a.py::test_x"
  });
});

test("buildDispatchInputs: falls back to defaults when value missing", () => {
  const defs = [{ key: "Env", type: "select", options: ["DEV"], default: "DEV" }];
  const out = buildDispatchInputs(defs, {}, {});
  assert.deepEqual(out, { Env: "DEV" });
});

test("buildDispatchInputs: skips definitions with no key", () => {
  const out = buildDispatchInputs([{ key: "", type: "text" }], {}, {});
  assert.deepEqual(out, {});
});
