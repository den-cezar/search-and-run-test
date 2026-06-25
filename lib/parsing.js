/**
 * Pure parsing helpers (no chrome / network deps) — unit-testable in Node.
 */

/**
 * Split a selected test name into its parts.
 * e.g. "test_x[AP]" -> { searchTerm: "test_x", paramSuffix: "[AP]", fullName: "test_x[AP]" }
 */
export function parseTestName(raw) {
  const fullName = (raw || "").trim();
  const paramMatch = fullName.match(/\[.*\]$/s);
  const paramSuffix = paramMatch ? paramMatch[0] : "";
  const searchTerm = fullName.replace(/\[.*$/s, "").trim();
  return { searchTerm, paramSuffix, fullName };
}

/**
 * Extract `def test_*` function names from Python source that contain the term.
 * Returns a sorted, de-duplicated array.
 */
export function extractTestFunctions(source, searchTerm) {
  const names = new Set();
  const re = /def\s+(test_\w+)\s*\(/g;
  let m;
  while ((m = re.exec(source || "")) !== null) {
    if (!searchTerm || m[1].includes(searchTerm)) {
      names.add(m[1]);
    }
  }
  return Array.from(names).sort();
}

/**
 * Strip a repo's path base prefix from a code-search hit path to get the
 * workflow-relative file path.
 */
export function buildRelativePath(filePath, pathBase) {
  const base = pathBase || "";
  return filePath.startsWith(base) ? filePath.slice(base.length) : filePath;
}

/**
 * Build the pytest node ID: "<relativePath>::<funcName><suffix>".
 */
export function buildNodeId(relativePath, funcName, paramSuffix = "") {
  return `${relativePath}::${funcName}${paramSuffix}`;
}
