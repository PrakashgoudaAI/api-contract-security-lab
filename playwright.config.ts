import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.api.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 20_000,
  reporter: [
    ["list"],
    ["junit", { outputFile: "reports/api-junit.xml" }],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: { trace: "off" },
});
