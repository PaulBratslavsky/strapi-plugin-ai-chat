import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Include only test files under specific directories to avoid running
    // the standalone scripts in tests/ (ai-sdk.test.ts, test-chat.mjs,
    // test-stream.mjs, test-guardrails.ts) which call process.exit() and
    // should not be run under vitest.
    include: ['tests/{helpers,lib,mcp}/**/*.test.ts'],
    testTimeout: 10_000,
  },
});
