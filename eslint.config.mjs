// @ts-check Let TS check this config file

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "build/**",
      "dist/**",
      ".scaffold/**",
      "node_modules/**",
      "release/**",
    ],
  },
  {
    ignores: ["src/library/**", "src/ui/library/**", "tests/library/**"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      "no-restricted-globals": [
        "error",
        { message: "Use `Zotero.getMainWindow()` instead.", name: "window" },
        {
          message: "Use `Zotero.getMainWindow().document` instead.",
          name: "document",
        },
        {
          message: "Use `Zotero.getActiveZoteroPane()` instead.",
          name: "ZoteroPane",
        },
        "Zotero_Tabs",
      ],

      "@typescript-eslint/ban-ts-comment": [
        "warn",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": "allow-with-description",
          "ts-nocheck": "allow-with-description",
          "ts-check": "allow-with-description",
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": [
        "off",
        {
          ignoreRestArgs: true,
        },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    // Chrome page scripts run in their own window context
    files: ["addon/content/**/*.js", "src/ui/**/*.{js,ts}"],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        Services: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        Array: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": "off",
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      globals: {
        URL: "readonly",
        IOUtils: "readonly",
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setImmediate: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
      },
    },
    rules: {
      "no-restricted-globals": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    ...eslint.configs.recommended,
    files: [
      "src/library/**/*.js",
      "src/ui/library/**/*.js",
      "tests/library/**/*.js",
    ],
  },
  {
    files: [
      "src/library/**/*.js",
      "src/ui/library/**/*.js",
      "tests/library/**/*.js",
    ],
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          args: "none",
          caughtErrors: "none",
          varsIgnorePattern:
            "^(SW|sw|startup|shutdown|install|uninstall|onMainWindow)",
        },
      ],
    },
  },
  {
    files: ["src/library/runtime.js", "src/library/**/*.js"],
    rules: { "no-redeclare": ["error", { builtinGlobals: false }] },
    languageOptions: {
      sourceType: "script",
      globals: Object.fromEntries(
        [
          "Zotero",
          "APP_SHUTDOWN",
          "Services",
          "Components",
          "ChromeUtils",
          "IOUtils",
          "PathUtils",
          "TextDecoder",
          "TextEncoder",
          "Ci",
          "setTimeout",
          "clearTimeout",
          "pref",
          "module",
          "SWSearch",
          "SWSearchCache",
          "SWCorpus",
          "SWIndexer",
          "SWTokenizer",
          "SWSection",
          "SWTags",
          "SWTagSuggestions",
          "SWEvidence",
          "swTagAliasKey",
          "swTagKey",
          "SWSemantic",
          "SWStorage",
          "SWPlugin",
          "SWHost",
          "SWPref",
          "SWResultLimit",
          "SW_MAX_TOKENS",
          "URL",
          "swPorterStem",
          "swYield",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: ["tests/library/**/*.js"],
    languageOptions: {
      sourceType: "commonjs",
      globals: Object.fromEntries(
        [
          "__dirname",
          "global",
          "console",
          "process",
          "TextEncoder",
          "TextDecoder",
          "TextEncoder",
          "Ci",
          "setTimeout",
          "clearTimeout",
          "setImmediate",
          "URL",
          "swPorterStem",
        ].map((name) => [name, "readonly"]),
      ),
    },
  },
  {
    files: ["src/ui/library/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: {
        self: "readonly",
        Response: "readonly",
        performance: "readonly",
      },
    },
  },
  {
    files: ["addon/content/library/**/*.js"],
    languageOptions: { globals: { console: "readonly" } },
  },
);
