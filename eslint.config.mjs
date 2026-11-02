import tseslint from "typescript-eslint";
export default [
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "reports/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: { "@typescript-eslint/no-floating-promises": "error" },
  },
];
