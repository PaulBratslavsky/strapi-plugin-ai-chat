import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    // The live pipeline mutates shared state; never run those files in parallel.
    fileParallelism: false,
  },
});
