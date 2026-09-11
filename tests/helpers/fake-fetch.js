/**
 * URL-routed `fetch` stub. Routes are matched in order; the first match wins
 * and an unmatched URL fails loudly.
 */

/** Build a JSON response factory (a fresh Response per call). */
export function json(status, body, headers = {}) {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...headers }
    });
}

/** Build a plain-text response factory. */
export function text(status, body, headers = {}) {
  return () => new Response(body, { status, headers: { "Content-Type": "text/plain", ...headers } });
}

/** Build a factory that rejects, simulating a transport failure. */
export function networkError(message = "Failed to fetch") {
  return () => {
    throw new TypeError(message);
  };
}

/**
 * @param {Array<[string|RegExp, Function]>} routes substring or pattern → response factory
 * @returns {Array<{url: string, options: object}>} live list of recorded calls
 */
export function routeFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    for (const [match, respond] of routes) {
      const hit = typeof match === "string" ? url.includes(match) : match.test(url);
      if (hit) return respond(url, options, calls);
    }
    throw new Error(`No fetch route matched ${url}`);
  };
  return calls;
}

/** Count recorded calls whose URL contains `fragment`. */
export function callsTo(calls, fragment) {
  return calls.filter((c) => c.url.includes(fragment));
}
