module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    sourceType: "module",
    ecmaVersion: 2021,
  },
  plugins: ["@typescript-eslint/eslint-plugin"],
  extends: [
    "plugin:@typescript-eslint/recommended",
    "plugin:prettier/recommended",
  ],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: [
    ".eslintrc.js",
    "dist/",
    "node_modules/",
    "coverage/",
    "src/migrations/",
    "src/seed/",
    "src/seeders/",
  ],
  rules: {
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    // Surfaced (not blocking) while the existing `any`s are burned down.
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "warn",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
    ],
  },
  overrides: [
    {
      // e2e specs use `import request = require("supertest")` — the idiomatic
      // CommonJS-interop form (a plain default import would break at runtime
      // without esModuleInterop). Allow it here only.
      files: ["test/**/*.ts", "**/*.e2e-spec.ts"],
      rules: {
        "@typescript-eslint/no-require-imports": "off",
        // Test harness/utilities build partial fakes — `any` is expected here.
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
    {
      // Unit tests build partial mock objects and cast them with `as any` /
      // typed fakes — requiring full types there fights the test, not the
      // product code. Relax `no-explicit-any` for specs only.
      files: ["**/*.spec.ts"],
      rules: {
        "@typescript-eslint/no-explicit-any": "off",
      },
    },
  ],
};
