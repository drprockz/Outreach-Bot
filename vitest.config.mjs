import { defineConfig } from 'vitest/config';

// Tests share a single Postgres test DB (truncated per test via tests/helpers/testDb.js).
// fileParallelism=false serializes test files so concurrent truncates don't clobber
// each other's in-flight data.
export default defineConfig({
  test: {
    fileParallelism: false,
    // Backend suite only. Web frontend tests (web/**) run via `cd web && npm test`
    // with their own jsdom-backed vitest config.
    include: ['tests/**/*.{test,spec}.{js,jsx,mjs,cjs}'],
    // Default 5s is too tight for findLeads end-to-end (Stage 10 now generates
    // two hook variants in parallel) when Postgres tests share a remote DB.
    testTimeout: 15000,
  },
});
