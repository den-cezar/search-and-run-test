/**
 * Lightweight leveled logger.
 *
 * Usage:
 *   import { createLogger } from "../lib/logger.js";
 *   const log = createLogger("popup");
 *   log.info("searching", { term });
 *
 * The active level is read from extension sync storage ("log_level") when
 * available and defaults to "info". Set "debug" from the Options page to see
 * verbose logs.
 */

import { getBrowserApi, hasStorage } from "./browser-api.js";

export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

let activeLevel = LEVELS.info;

/** Update the active level (called once at startup from stored settings). */
export function setLogLevel(level) {
  if (typeof level === "string" && level in LEVELS) {
    activeLevel = LEVELS[level];
  } else if (typeof level === "number") {
    activeLevel = level;
  }
}

/** Load the log level from extension sync storage, if running in an extension. */
export async function initLogLevelFromStorage() {
  try {
    if (hasStorage()) {
      const r = await getBrowserApi().storage.sync.get("log_level");
      setLogLevel((r && r.log_level) || "info");
    }
  } catch (_) {
    /* ignore — keep default */
  }
}

export function createLogger(scope) {
  const prefix = `[S&R:${scope}]`;
  const emit = (levelName, consoleFn, args) => {
    if (LEVELS[levelName] < activeLevel) return;
    const ts = new Date().toISOString().slice(11, 23);
    consoleFn(`${ts} ${prefix}`, ...args);
  };
  return {
    debug: (...args) => emit("debug", console.debug, args),
    info: (...args) => emit("info", console.info, args),
    warn: (...args) => emit("warn", console.warn, args),
    error: (...args) => emit("error", console.error, args)
  };
}
