import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Files covered by tsconfig.checkjs.json — only these can run type-aware rules.
const typeAwareJs = ["*.mjs", "packages/**/*.{js,mjs}", "scripts/**/*.mjs", "evals/**/*.{mjs,cjs}"];

const typeAwareRules = {
  "@typescript-eslint/no-floating-promises": [
    "error",
    {
      // node:test runners collect the returned promise themselves; a bare
      // `test(...)` call at top level is the documented usage, not a leak.
      allowForKnownSafeCalls: [
        {
          from: "package",
          package: "node:test",
          name: ["test", "it", "describe", "suite", "before", "beforeEach", "after", "afterEach"]
        }
      ]
    }
  ],
  "@typescript-eslint/await-thenable": "error",
  "@typescript-eslint/no-misused-promises": "error"
};

export default [
  {
    ignores: ["**/node_modules/**", "bin/**", "packages/obsidian-memory-rag/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: "latest",
      globals: { ...globals.node }
    },
    rules: {
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      "no-shadow": "error"
    }
  },
  {
    files: typeAwareJs,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: "./tsconfig.eslint.json", tsconfigRootDir: import.meta.dirname }
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: typeAwareRules
  },
  {
    files: ["scripts/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { project: "./tsconfig.json", tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.node }
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }
      ],
      "no-shadow": "off",
      "@typescript-eslint/no-shadow": "error",
      ...typeAwareRules
    }
  }
];
