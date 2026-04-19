import { defineConfig } from 'vitest/config';

// Tests share a single Postgres test DB (truncated per test via tests/helpers/testDb.js).
// fileParallelism=false serializes test files so concurrent truncates don't clobber
// each other's in-flight data.
export default defineConfig({
  test: {
    fileParallelism: false,
  },
});
