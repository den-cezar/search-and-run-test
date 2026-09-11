/**
 * HTML escaping for values interpolated into innerHTML.
 *
 * `&` must be escaped first: without it a stored value like "&lt;img&gt;" is
 * decoded by the parser back into a live element.
 */
export function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
