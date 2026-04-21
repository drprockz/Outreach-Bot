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
  },
});
