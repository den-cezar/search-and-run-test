import { test } from "node:test";
import assert from "node:assert/strict";

import { esc } from "../lib/html.js";

const CASES = [
  ["plain text", "plain text"],
  ["", ""],
  ["<script>", "&lt;script&gt;"],
  ['"quoted"', "&quot;quoted&quot;"],
  ["it's", "it&#39;s"],
  ["a & b", "a &amp; b"],
  ["tests/a.py::test_x[QA]", "tests/a.py::test_x[QA]"]
];

for (const [input, expected] of CASES) {
  test(`esc: ${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
    assert.equal(esc(input), expected);
  });
}

test("esc: escapes ampersands first so entities cannot be re-decoded", () => {
  // Without the & pass the parser would turn this back into a live <img>.
  assert.equal(esc("&lt;img src=x onerror=1&gt;"), "&amp;lt;img src=x onerror=1&amp;gt;");
});

test("esc: neutralises an attribute break-out", () => {
  assert.equal(
    esc('"><img src=x onerror="boom">'),
    "&quot;&gt;&lt;img src=x onerror=&quot;boom&quot;&gt;"
  );
});

test("esc: renders null and undefined as empty", () => {
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("esc: keeps falsy values that are not nullish", () => {
  assert.equal(esc(0), "0");
  assert.equal(esc(false), "false");
});

test("esc: stringifies non-strings", () => {
  assert.equal(esc(42), "42");
  assert.equal(esc(["a", "b"]), "a,b");
});
