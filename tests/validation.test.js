import { test } from "node:test";
import assert from "node:assert/strict";

import {
  validateTestName,
  validateThreads,
  validateBranch,
  validateEnvironment,
  validateRepoConfig
} from "../lib/validation.js";

// --- validateTestName --------------------------------------------------------

test("validateTestName: accepts a plain test function name", () => {
  const r = validateTestName("test_example");
  assert.equal(r.ok, true);
  assert.equal(r.value, "test_example");
});

test("validateTestName: accepts a parametrized name", () => {
  const r = validateTestName("test_example[AP]");
  assert.equal(r.ok, true);
});

test("validateTestName: trims surrounding whitespace", () => {
  const r = validateTestName("  test_trim  ");
  assert.equal(r.ok, true);
  assert.equal(r.value, "test_trim");
});

test("validateTestName: rejects empty input", () => {
  assert.equal(validateTestName("").ok, false);
  assert.equal(validateTestName("   ").ok, false);
});

test("validateTestName: rejects a name starting with a digit", () => {
  assert.equal(validateTestName("1test").ok, false);
});

test("validateTestName: rejects spaces in the base name", () => {
  assert.equal(validateTestName("test name").ok, false);
});

// --- validateThreads ---------------------------------------------------------

test("validateThreads: accepts valid integers", () => {
  assert.deepEqual(validateThreads("1"), { ok: true, value: 1 });
  assert.deepEqual(validateThreads(10), { ok: true, value: 10 });
  assert.deepEqual(validateThreads("50"), { ok: true, value: 50 });
});

test("validateThreads: rejects below 1, above 50, and non-numbers", () => {
  assert.equal(validateThreads("0").ok, false);
  assert.equal(validateThreads("51").ok, false);
  assert.equal(validateThreads("abc").ok, false);
  assert.equal(validateThreads("").ok, false);
});

// --- validateBranch ----------------------------------------------------------

test("validateBranch: accepts normal branch names", () => {
  assert.deepEqual(validateBranch("main"), { ok: true, value: "main" });
  assert.equal(validateBranch("feature/login-fix").ok, true);
});

test("validateBranch: rejects empty and invalid characters", () => {
  assert.equal(validateBranch("").ok, false);
  assert.equal(validateBranch("has space").ok, false);
  assert.equal(validateBranch("bad..ref").ok, false);
  assert.equal(validateBranch("ends/").ok, false);
  assert.equal(validateBranch("star*").ok, false);
});

// --- validateEnvironment -----------------------------------------------------

test("validateEnvironment: case-insensitive match against allowed list", () => {
  const allowed = ["DEV", "QA", "STAGE"];
  assert.deepEqual(validateEnvironment("qa", allowed), { ok: true, value: "QA" });
  assert.equal(validateEnvironment("prod", allowed).ok, false);
});

// --- validateRepoConfig ------------------------------------------------------

test("validateRepoConfig: accepts a complete config", () => {
  const r = validateRepoConfig({
    owner: "your-org",
    repo: "your-test-repo",
    workflow: "run-tests.yml"
  });
  assert.equal(r.ok, true);
});

test("validateRepoConfig: reports missing fields", () => {
  const r = validateRepoConfig({ owner: "", repo: "", workflow: "" });
  assert.equal(r.ok, false);
  assert.match(r.error, /owner is required/);
  assert.match(r.error, /repo is required/);
  assert.match(r.error, /workflow file is required/);
});

test("validateRepoConfig: rejects non-yaml workflow", () => {
  const r = validateRepoConfig({
    owner: "o",
    repo: "r",
    workflow: "run.txt"
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /\.yml\/\.yaml/);
});
