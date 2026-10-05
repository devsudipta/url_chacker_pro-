import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.e2e.ts",
  timeout: 60000,
  workers: 1,
  reporter: "list",
  outputDir: "test-artifacts/playwright",
});
