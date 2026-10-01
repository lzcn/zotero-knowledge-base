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
);
