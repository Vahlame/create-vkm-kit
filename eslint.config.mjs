import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

// Files covered by tsconfig.checkjs.json — only these can run type-aware rules.
const typeAwareJs = ["*.mjs", "packages/**/*.{js,mjs}", "scripts/**/*.mjs", "evals/**/*.{mjs,cjs}"];

// The entry-point guard that silently never fires on Windows.
//
// `import.meta.url` is a percent-encoded URL with a `/C:/`-style drive prefix; `process.argv[1]`
// is a native path with backslashes. Comparing the first to a template literal or a concatenation
// built from the second therefore NEVER matches on Windows — `main()` is skipped, the script exits
// 0 with no output, and a green CI step is indistinguishable from a real pass. The correct
// comparison is `pathToFileURL(process.argv[1]).href`, which does the encoding.
//
// A comment saying so is debt, not documentation: this repo shipped the broken form 12 times
// AFTER the failure was written down. An AST rule is the version that cannot be ignored — it
// matches the shape regardless of formatting, and cannot false-positive on prose describing it.
const ENTRY_POINT_GUARD_MESSAGE =
  "Broken entry-point guard: import.meta.url never equals a raw `file://` + process.argv[1] on " +
  "Windows (backslashes, no /C:/ prefix), so main() silently never runs. Use " +
  "`process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href`.";

/** `import.meta.url === <template literal | concatenation>` on either side, `===` or `!==`. */
const noBrokenEntryPointGuard = ["TemplateLiteral", "BinaryExpression"].flatMap((rhs) =>
  [
    ["left", "right"],
    ["right", "left"]
  ].map(([meta, other]) => ({
    selector:
      `BinaryExpression[operator=/^(===|!==)$/]` +
      `[${meta}.type="MemberExpression"][${meta}.object.type="MetaProperty"][${meta}.property.name="url"]` +
      `[${other}.type="${rhs}"]`,
    message: ENTRY_POINT_GUARD_MESSAGE
  }))
);

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
    // `.claude/` is machine-local agent state (gitignored) and, crucially, holds
    // `.claude/worktrees/*` — full nested checkouts of this same repo. Without this
    // ignore, every file gets linted once per live worktree and `npm run lint` fails
    // on half-written code from an unrelated branch.
    ignores: ["**/node_modules/**", "bin/**", ".claude/**", "packages/obsidian-memory-rag/**"]
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
      "no-shadow": "error",
      "no-restricted-syntax": ["error", ...noBrokenEntryPointGuard]
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
