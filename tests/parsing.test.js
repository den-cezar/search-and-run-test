import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseTestName,
  extractTestFunctions,
  buildRelativePath,
  buildNodeId
} from "../lib/parsing.js";

test("parseTestName: bare name", () => {
  const r = parseTestName("test_example");
  assert.equal(r.searchTerm, "test_example");
  assert.equal(r.paramSuffix, "");
  assert.equal(r.fullName, "test_example");
});

test("parseTestName: parametrized name keeps suffix, strips for search", () => {
  const r = parseTestName("test_login_with_valid_credentials[chrome]");
  assert.equal(r.searchTerm, "test_login_with_valid_credentials");
  assert.equal(r.paramSuffix, "[chrome]");
});

test("parseTestName: param with spaces and hyphens", () => {
  const r = parseTestName("test_x[delete item by id-chrome]");
  assert.equal(r.searchTerm, "test_x");
  assert.equal(r.paramSuffix, "[delete item by id-chrome]");
});

test("parseTestName: trims whitespace", () => {
  const r = parseTestName("   test_trim  ");
  assert.equal(r.searchTerm, "test_trim");
});

test("parseTestName: empty input", () => {
  const r = parseTestName("");
  assert.equal(r.searchTerm, "");
  assert.equal(r.fullName, "");
});

test("extractTestFunctions: finds matching defs, sorted + unique", () => {
  const src = `
@pytest.mark.parametrize("x", [1])
def test_user_create_with_valid_data(api):
    pass

def test_user_delete_by_id():
    pass

def helper_not_a_test():
    pass

def test_user_create_with_valid_data_extra():
    pass
`;
  const names = extractTestFunctions(src, "test_user");
  assert.deepEqual(names, [
    "test_user_create_with_valid_data",
    "test_user_create_with_valid_data_extra",
    "test_user_delete_by_id"
  ]);
});

test("extractTestFunctions: term filter excludes non-matching tests", () => {
  const src = "def test_alpha():\n  pass\ndef test_beta():\n  pass\n";
  assert.deepEqual(extractTestFunctions(src, "alpha"), ["test_alpha"]);
});

test("extractTestFunctions: no term returns all test functions", () => {
  const src = "def test_a():\n  pass\ndef test_b():\n  pass\n";
  assert.deepEqual(extractTestFunctions(src, ""), ["test_a", "test_b"]);
});

test("extractTestFunctions: empty source returns []", () => {
  assert.deepEqual(extractTestFunctions("", "test"), []);
});

test("buildRelativePath: strips configured base", () => {
  const rel = buildRelativePath(
    "src/tests/regression/Notification/test_x.py",
    "src/tests/regression/"
  );
  assert.equal(rel, "Notification/test_x.py");
});

test("buildRelativePath: leaves path when base not a prefix", () => {
  const rel = buildRelativePath("other/path/test_x.py", "src/tests/");
  assert.equal(rel, "other/path/test_x.py");
});

test("buildNodeId: with and without param suffix", () => {
  assert.equal(buildNodeId("Notification/test_x.py", "test_x"), "Notification/test_x.py::test_x");
  assert.equal(
    buildNodeId("Notification/test_x.py", "test_x", "[AP]"),
    "Notification/test_x.py::test_x[AP]"
  );
});
