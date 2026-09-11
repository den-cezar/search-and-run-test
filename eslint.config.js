import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: ["node_modules/**", "icons/**"]
  },
  js.configs.recommended,
  {
    // Extension code runs in the browser / web-extension context.
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions
      }
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrors: "none"
        }
      ],
      "no-console": "off"
    }
  },
  {
    // Unit tests run under Node's built-in test runner.
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },
  {
    // Playwright specs run in Node; page.evaluate bodies run in the browser.
    files: ["e2e/**/*.js", "playwright.config.js"],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.webextensions
      }
    }
  },
  {
    // Build tooling runs in Node.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  }
];
